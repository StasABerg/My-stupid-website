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
            Self {
                semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                config,
                engine: PipelineEngine::GStreamer(GStreamerEngine),
            }
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
        let pipeline = gst::parse::launch(&format!(
            "urisrcbin uri={url} ! queue max-size-time={} ! appsink name=outsink emit-signals=true sync=false",
            gst::ClockTime::SECOND.saturating_mul(config.buffer_seconds)
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
            src.set_property("timeout", config.timeout_ms / 1000);
            src.set_property("user-agent", &config.user_agent);
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
        std::thread::spawn(move || {
            let (pipeline, appsink) = match Self.build_pipeline(&url, &config) {
                Ok(result) => result,
                Err(err) => {
                    let _ = tx.blocking_send(Err(std::io::Error::other(format!("{err:?}"))));
                    logger().warn(
                        "stream.pipeline.build_failed",
                        json!({
                            "url": url,
                            "error": format!("{err:?}"),
                        }),
                    );
                    drop(permit);
                    return;
                }
            };

            if let Err(err) = pipeline.set_state(gst::State::Playing) {
                let _ = tx.blocking_send(Err(std::io::Error::other(format!(
                    "failed to start pipeline: {:?}",
                    err
                ))));
                logger().warn(
                    "stream.pipeline.state_failed",
                    json!({
                        "url": url,
                        "error": format!("{err:?}"),
                    }),
                );
                let _ = pipeline.set_state(gst::State::Null);
                drop(permit);
                return;
            }

            logger().info(
                "stream.pipeline.started",
                json!({
                    "url": url,
                }),
            );

            let bus = match pipeline.bus() {
                Some(bus) => bus,
                None => {
                    let _ =
                        tx.blocking_send(Err(std::io::Error::other("pipeline bus unavailable")));
                    logger().warn("stream.pipeline.bus_unavailable", json!({ "url": url }));
                    let _ = pipeline.set_state(gst::State::Null);
                    drop(permit);
                    return;
                }
            };
            loop {
                if tx.is_closed() {
                    break;
                }

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
                                        json!({ "url": url }),
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
                                "url": url,
                                "error": format!("{err:?}"),
                            }),
                        );
                        break;
                    }
                }

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
                                    "url": url,
                                    "error": format!("{:?}", err.error()),
                                }),
                            );
                            break;
                        }
                        _ => {}
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
