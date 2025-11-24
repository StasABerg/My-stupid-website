use std::sync::Arc;

use serde::Serialize;
use tokio::sync::Semaphore;

#[cfg(feature = "gstreamer")]
use {
    bytes::Bytes, gstreamer as gst, gstreamer::prelude::*, gstreamer_app as gst_app,
    serde_json::json, tokio::sync::mpsc, tokio_stream::wrappers::ReceiverStream,
    tokio_stream::StreamExt,
};

use crate::config::StreamPipelineConfig;
use crate::logging::logger;

#[allow(dead_code)]
#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    #[error("pipeline disabled")]
    Disabled,
    #[error("pipeline engine unavailable")]
    Unavailable,
    #[error("pipeline error: {0}")]
    Generic(String),
}

#[allow(dead_code)]
#[derive(Clone, Serialize)]
pub struct PipelineAttemptMetadata {
    pub engine: &'static str,
    pub enabled: bool,
}

#[allow(dead_code)]
pub enum PipelineDecision {
    Skip,
    Stream {
        body: axum::body::Body,
        content_type: Option<String>,
    },
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct StreamPipeline {
    config: StreamPipelineConfig,
    semaphore: Arc<Semaphore>,
    engine: PipelineEngine,
}

#[derive(Clone)]
enum PipelineEngine {
    #[cfg(feature = "gstreamer")]
    GStreamer(GStreamerEngine),
    Disabled,
}

#[cfg(feature = "gstreamer")]
#[derive(Clone)]
struct GStreamerEngine;

impl StreamPipeline {
    pub fn new(config: StreamPipelineConfig) -> Self {
        if !config.enabled {
            return Self {
                semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                config,
                engine: PipelineEngine::Disabled,
            };
        }

        #[cfg(feature = "gstreamer")]
        {
            if let Err(error) = gst::init() {
                logger().warn(
                    "stream.pipeline.init_failed",
                    serde_json::json!({
                        "error": format!("{:?}", error),
                        "engine": "gstreamer",
                    }),
                );
                return Self {
                    semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                    config,
                    engine: PipelineEngine::Disabled,
                };
            }
            let instance = Self {
                semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                config,
                engine: PipelineEngine::GStreamer(GStreamerEngine),
            };
            logger().info(
                "stream.pipeline.enabled",
                serde_json::json!({
                    "engine": "gstreamer",
                    "maxConcurrency": instance.config.max_concurrency,
                    "bufferSeconds": instance.config.buffer_seconds,
                }),
            );
            instance
        }

        #[cfg(not(feature = "gstreamer"))]
        {
            logger().info(
                "stream.pipeline.disabled",
                serde_json::json!({
                    "reason": "gstreamer feature not built",
                    "engine": "gstreamer",
                }),
            );
            Self {
                semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                config,
                engine: PipelineEngine::Disabled,
            }
        }
    }

    pub fn is_enabled(&self) -> bool {
        !matches!(self.engine, PipelineEngine::Disabled)
    }

    pub async fn attempt(&self, _url: &str) -> Result<PipelineDecision, PipelineError> {
        if !self.is_enabled() {
            return Err(PipelineError::Disabled);
        }

        let permit = self
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| PipelineError::Unavailable)?;

        #[cfg(feature = "gstreamer")]
        {
            match &self.engine {
                PipelineEngine::GStreamer(engine) => {
                    logger().info(
                        "stream.pipeline.attempt",
                        serde_json::json!({
                            "engine": "gstreamer",
                            "url": _url,
                        }),
                    );
                    engine.start(_url, self.config.clone(), permit)
                }
                PipelineEngine::Disabled => Err(PipelineError::Unavailable),
            }
        }

        #[cfg(not(feature = "gstreamer"))]
        {
            let _ = permit;
            Err(PipelineError::Unavailable)
        }
    }
}

#[cfg(feature = "gstreamer")]
impl GStreamerEngine {
    fn build_pipeline(
        &self,
        url: &str,
        config: &StreamPipelineConfig,
    ) -> Result<(gst::Pipeline, gst_app::AppSink), PipelineError> {
        let timeout_seconds = std::cmp::max(1, (config.timeout_ms / 1000).max(1));
        let pipeline = gst::parse::launch(&format!(
            "souphttpsrc name=source location=\"{url}\" user-agent=\"{ua}\" timeout={timeout} iradio-mode=true is-live=true do-timestamp=true ! queue name=buffer ! appsink name=outsink emit-signals=true sync=false",
            ua = config.user_agent,
            timeout = timeout_seconds,
        ))
        .map_err(|err| PipelineError::Generic(format!("parse pipeline: {:?}", err)))?;

        let pipeline = pipeline
            .downcast::<gst::Pipeline>()
            .map_err(|_| PipelineError::Generic("failed to downcast pipeline".into()))?;

        let appsink = pipeline
            .by_name("outsink")
            .ok_or_else(|| PipelineError::Generic("appsink not found".into()))?
            .downcast::<gst_app::AppSink>()
            .map_err(|_| PipelineError::Generic("failed to cast appsink".into()))?;

        // Configure source settings if present.
        if let Some(src) = pipeline.by_name("source") {
            src.set_property("timeout", timeout_seconds as u32);
            src.set_property("user-agent", &config.user_agent);
        }

        if let Some(queue) = pipeline.by_name("buffer") {
            let buffer_ns = gst::ClockTime::SECOND
                .saturating_mul(config.buffer_seconds)
                .nseconds();
            queue.set_property("max-size-time", buffer_ns);
            queue.set_property("max-size-bytes", 0u32);
            queue.set_property("max-size-buffers", 0u32);
        }

        Ok((pipeline, appsink))
    }

    fn start(
        &self,
        url: &str,
        config: StreamPipelineConfig,
        permit: tokio::sync::OwnedSemaphorePermit,
    ) -> Result<PipelineDecision, PipelineError> {
        let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(64);
        let url = url.to_string();
        let (pipeline, appsink) = Self
            .build_pipeline(&url, &config)
            .map_err(|err| PipelineError::Generic(format!("pipeline build failed: {:?}", err)))?;

        pipeline.set_state(gst::State::Playing).map_err(|err| {
            PipelineError::Generic(format!("failed to start pipeline: {:?}", err))
        })?;

        logger().info(
            "stream.pipeline.started",
            json!({
                "url": url,
            }),
        );

        // Pull first sample synchronously; if it fails, fall back so we don't leave the client hanging.
        match appsink.pull_sample() {
            Ok(sample) => {
                if let Some(buffer) = sample.buffer() {
                    if let Ok(map) = buffer.map_readable() {
                        if tx
                            .blocking_send(Ok(Bytes::copy_from_slice(map.as_ref())))
                            .is_err()
                        {
                            logger()
                                .info("stream.pipeline.downstream_closed", json!({ "url": url }));
                            let _ = pipeline.set_state(gst::State::Null);
                            drop(permit);
                            return Err(PipelineError::Generic(
                                "downstream closed before first sample".into(),
                            ));
                        }
                    }
                }
            }
            Err(err) => {
                logger().warn(
                    "stream.pipeline.sample_error",
                    json!({
                        "url": url,
                        "error": format!("{err:?}"),
                    }),
                );
                let _ = pipeline.set_state(gst::State::Null);
                drop(permit);
                return Err(PipelineError::Generic(format!(
                    "first sample failed: {err:?}"
                )));
            }
        }

        let bus = pipeline.bus();
        let url_clone = url.clone();
        std::thread::spawn(move || {
            while !tx.is_closed() {
                match appsink.pull_sample() {
                    Ok(sample) => {
                        if let Some(buffer) = sample.buffer() {
                            if let Ok(map) = buffer.map_readable() {
                                if tx
                                    .blocking_send(Ok(Bytes::copy_from_slice(map.as_ref())))
                                    .is_err()
                                {
                                    logger().info(
                                        "stream.pipeline.downstream_closed",
                                        json!({ "url": url_clone }),
                                    );
                                    break;
                                }
                            }
                        }
                    }
                    Err(err) => {
                        let _ = tx.blocking_send(Err(std::io::Error::other(format!(
                            "sample pull error: {err:?}"
                        ))));
                        logger().warn(
                            "stream.pipeline.sample_error",
                            json!({
                                "url": url_clone,
                                "error": format!("{err:?}"),
                            }),
                        );
                        break;
                    }
                }

                if let Some(ref bus) = bus {
                    if let Some(msg) = bus.timed_pop(gst::ClockTime::from_seconds(0)) {
                        match msg.view() {
                            gst::MessageView::Eos(..) => break,
                            gst::MessageView::Error(err) => {
                                let _ = tx.blocking_send(Err(std::io::Error::other(format!(
                                    "pipeline error: {:?}",
                                    err.error()
                                ))));
                                logger().warn(
                                    "stream.pipeline.bus_error",
                                    json!({
                                        "url": url_clone,
                                        "error": format!("{:?}", err.error()),
                                    }),
                                );
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }

            let _ = pipeline.set_state(gst::State::Null);
            drop(permit);
        });

        let stream = ReceiverStream::new(rx).map(|result| result.map_err(std::io::Error::other));
        let body = axum::body::Body::from_stream(stream);
        Ok(PipelineDecision::Stream {
            body,
            content_type: None,
        })
    }
}
