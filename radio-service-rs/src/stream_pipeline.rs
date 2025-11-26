use std::sync::Arc;

use serde::Serialize;
use tokio::sync::Semaphore;

#[cfg(feature = "gstreamer")]
use {
    bytes::Bytes,
    gstreamer as gst,
    gstreamer::prelude::*,
    gstreamer_app as gst_app,
    serde_json::json,
    std::sync::atomic::{AtomicBool, Ordering},
    tokio::sync::mpsc,
    tokio_stream::wrappers::ReceiverStream,
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
        let timeout_seconds = std::cmp::max(1, (config.timeout_ms / 1000).max(1)) as u32;
        let pipeline = gst::Pipeline::new();

        let src = gst::ElementFactory::make("souphttpsrc")
            .name("source")
            .property("location", url)
            .property("user-agent", &config.user_agent)
            .property("timeout", timeout_seconds)
            .property("iradio-mode", true)
            .property("is-live", true)
            .build()
            .map_err(|err| PipelineError::Generic(format!("build source: {:?}", err)))?;

        let decode = gst::ElementFactory::make("decodebin")
            .name("decode")
            .build()
            .map_err(|err| PipelineError::Generic(format!("build decodebin: {:?}", err)))?;

        let convert = gst::ElementFactory::make("audioconvert")
            .name("aconvert")
            .build()
            .map_err(|err| PipelineError::Generic(format!("build audioconvert: {:?}", err)))?;

        let resample = gst::ElementFactory::make("audioresample")
            .name("aresample")
            .build()
            .map_err(|err| PipelineError::Generic(format!("build audioresample: {:?}", err)))?;

        let encoder = gst::ElementFactory::make("lamemp3enc")
            .name("encoder")
            .property("bitrate", 128i32)
            .build()
            .map_err(|err| PipelineError::Generic(format!("build lamemp3enc: {:?}", err)))?;

        let sink_caps = gst::Caps::builder("audio/mpeg")
            .field("mpegversion", 1i32)
            .field("layer", 3i32)
            .build();

        let sink = gst::ElementFactory::make("appsink")
            .name("outsink")
            .property("emit-signals", true)
            .property("sync", false)
            .property("caps", sink_caps)
            .build()
            .map_err(|err| PipelineError::Generic(format!("build appsink: {:?}", err)))?;

        let sink: gst_app::AppSink = sink
            .downcast()
            .map_err(|_| PipelineError::Generic("failed to cast appsink".into()))?;

        pipeline
            .add_many([
                src.upcast_ref::<gst::Element>(),
                decode.upcast_ref::<gst::Element>(),
                convert.upcast_ref::<gst::Element>(),
                resample.upcast_ref::<gst::Element>(),
                encoder.upcast_ref::<gst::Element>(),
                sink.upcast_ref::<gst::Element>(),
            ])
            .map_err(|err| PipelineError::Generic(format!("add elements: {:?}", err)))?;

        gst::Element::link_many([
            convert.upcast_ref::<gst::Element>(),
            resample.upcast_ref::<gst::Element>(),
            encoder.upcast_ref::<gst::Element>(),
        ])
        .map_err(|err| PipelineError::Generic(format!("link convert chain: {:?}", err)))?;
        encoder
            .link(sink.upcast_ref::<gst::Element>())
            .map_err(|err| PipelineError::Generic(format!("link encoder->sink: {:?}", err)))?;

        // Link source -> decodebin (dynamic) in the pad-added handler.
        src.link(&decode)
            .map_err(|err| PipelineError::Generic(format!("link source->decode: {:?}", err)))?;

        let convert_weak = convert.downgrade();
        decode.connect_pad_added(move |_dbin, src_pad| {
            let Some(convert) = convert_weak.upgrade() else {
                return;
            };
            let Some(sink_pad) = convert.static_pad("sink") else {
                return;
            };
            if sink_pad.is_linked() {
                return;
            }

            let mut caps_name = None;
            if let Some(caps) = src_pad
                .current_caps()
                .or_else(|| Some(src_pad.query_caps(None)))
            {
                caps_name = caps
                    .structure(0)
                    .map(|structure| structure.name().as_str().to_string());
            }

            if caps_name.as_deref() != Some("audio/x-raw") {
                logger().debug(
                    "stream.pipeline.decode_pad_skipped",
                    json!({
                        "caps": caps_name,
                    }),
                );
                return;
            }

            if let Err(err) = src_pad.link(&sink_pad) {
                logger().warn(
                    "stream.pipeline.decode_link_failed",
                    json!({ "error": format!("{:?}", err) }),
                );
            }
        });

        Ok((pipeline, sink))
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

        // Use appsink callbacks to push samples without blocking the async runtime.
        let tx_samples = tx.clone();
        let url_for_samples = url.clone();
        let downstream_logged = Arc::new(AtomicBool::new(false));
        let downstream_logged_samples = downstream_logged.clone();
        appsink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_sample(move |sink| match sink.pull_sample() {
                    Ok(sample) => {
                        if let Some(buffer) = sample.buffer() {
                            if let Ok(map) = buffer.map_readable() {
                                let chunk = Bytes::copy_from_slice(map.as_ref());
                                if tx_samples.blocking_send(Ok(chunk)).is_err() {
                                    if !downstream_logged_samples.swap(true, Ordering::Relaxed) {
                                        logger().info(
                                            "stream.pipeline.downstream_closed",
                                            json!({ "url": url_for_samples }),
                                        );
                                    }
                                    return Err(gst::FlowError::Eos);
                                }
                            }
                        }
                        Ok(gst::FlowSuccess::Ok)
                    }
                    Err(err) => {
                        let _ = tx_samples.blocking_send(Err(std::io::Error::other(format!(
                            "sample pull error: {err:?}"
                        ))));
                        logger().warn(
                            "stream.pipeline.sample_error",
                            json!({
                                "url": url_for_samples,
                                "error": format!("{err:?}"),
                            }),
                        );
                        Err(gst::FlowError::Error)
                    }
                })
                .build(),
        );

        pipeline.set_state(gst::State::Playing).map_err(|err| {
            PipelineError::Generic(format!("failed to start pipeline: {:?}", err))
        })?;

        logger().info(
            "stream.pipeline.started",
            json!({
                "url": url,
            }),
        );

        if let Some(bus) = pipeline.bus() {
            let tx_bus = tx.clone();
            let url_bus = url.clone();
            let downstream_logged_bus = downstream_logged.clone();
            std::thread::spawn(move || {
                while let Some(msg) = bus.timed_pop(gst::ClockTime::from_seconds(1)) {
                    match msg.view() {
                        gst::MessageView::Eos(..) => {
                            let _ = tx_bus.try_send(Err(std::io::Error::other("pipeline eos")));
                            downstream_logged_bus.store(true, Ordering::Relaxed);
                            break;
                        }
                        gst::MessageView::Error(err) => {
                            let debug = err.debug().unwrap_or_else(|| "none".into());
                            let _ = tx_bus.try_send(Err(std::io::Error::other(format!(
                                "pipeline error: {:?}",
                                err.error()
                            ))));
                            logger().warn(
                                "stream.pipeline.bus_error",
                                json!({
                                    "url": url_bus,
                                    "error": format!("{:?}", err.error()),
                                    "debug": debug,
                                }),
                            );
                            downstream_logged_bus.store(true, Ordering::Relaxed);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }

        let tx_end = tx.clone();
        std::thread::spawn(move || {
            while !tx_end.is_closed() {
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            let _ = pipeline.set_state(gst::State::Null);
            drop(permit);
        });

        let buffer_delay = std::time::Duration::from_secs(config.buffer_seconds);
        let start_time = std::time::Instant::now();
        let stream = ReceiverStream::new(rx).then(move |result| {
            let delay = buffer_delay;
            let start = start_time;
            async move {
                match result {
                    Ok(bytes) => {
                        if !delay.is_zero() {
                            let elapsed =
                                std::time::Instant::now().saturating_duration_since(start);
                            if elapsed < delay {
                                tokio::time::sleep(delay - elapsed).await;
                            }
                        }
                        Ok::<Bytes, std::io::Error>(bytes)
                    }
                    Err(err) => Err(err),
                }
            }
        });
        let body = axum::body::Body::from_stream(stream);
        Ok(PipelineDecision::Stream {
            body,
            content_type: Some("audio/mpeg".to_string()),
        })
    }
}
