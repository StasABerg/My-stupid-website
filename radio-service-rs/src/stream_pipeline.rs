use std::sync::Arc;

use serde::Serialize;
#[cfg_attr(not(feature = "gstreamer"), allow(unused_imports))]
use tokio::sync::OwnedSemaphorePermit;
use tokio::sync::Semaphore;

#[cfg(feature = "gstreamer")]
use bytes::Bytes;
#[cfg(feature = "gstreamer")]
use gstreamer as gst;
#[cfg(feature = "gstreamer")]
use gstreamer_app as gst_app;
#[cfg(feature = "gstreamer")]
use std::io;
#[cfg(feature = "gstreamer")]
use tokio::sync::mpsc;
#[cfg(feature = "gstreamer")]
use tokio_stream::wrappers::ReceiverStream;
#[cfg(feature = "gstreamer")]
use tokio_stream::StreamExt;

use crate::config::StreamPipelineConfig;
use crate::logging::logger;

#[allow(dead_code)]
#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    #[error("pipeline disabled")]
    Disabled,
    #[error("pipeline engine unavailable")]
    Unavailable,
    #[error("pipeline not implemented for the selected engine")]
    NotImplemented,
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
    #[cfg_attr(feature = "gstreamer", derive(Clone))]
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
            if let Err(error) = gstreamer::init() {
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
            return Self {
                semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                config,
                engine: PipelineEngine::GStreamer(GStreamerEngine),
            };
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
            if let PipelineEngine::GStreamer(engine) = &self.engine {
                return engine.start(_url, self.config.clone(), permit);
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
        let pipeline = gst::Pipeline::new(None);
        let src = gst::ElementFactory::make("souphttpsrc")
            .build()
            .map_err(|err| PipelineError::Generic(format!("souphttpsrc: {:?}", err)))?;
        src.set_property("location", url)
            .map_err(|err| PipelineError::Generic(format!("set location: {:?}", err)))?;
        src.set_property_from_value(
            "user-agent",
            &gst::glib::Value::from(config.user_agent.as_str()),
        );
        src.set_property_from_value(
            "timeout",
            &gst::glib::Value::from(&(config.timeout_ms / 1000)),
        );

        let queue = gst::ElementFactory::make("queue")
            .build()
            .map_err(|err| PipelineError::Generic(format!("queue: {:?}", err)))?;
        queue.set_property("max-size-buffers", 0u32);
        queue.set_property("max-size-bytes", 0u32);
        queue.set_property(
            "max-size-time",
            gst::ClockTime::from_seconds(config.buffer_seconds)
                .nseconds()
                .unwrap_or(0),
        );

        let sink = gst::ElementFactory::make("appsink")
            .build()
            .map_err(|err| PipelineError::Generic(format!("appsink: {:?}", err)))?;
        let sink = sink
            .dynamic_cast::<gst_app::AppSink>()
            .map_err(|_| PipelineError::Generic("failed to cast appsink".into()))?;
        sink.set_property("emit-signals", true);
        sink.set_property("sync", false);
        sink.set_caps(Some(
            &gst::Caps::builder_any().field("format", &"time").build(),
        ));

        pipeline
            .add_many(&[&src, &queue, sink.upcast_ref()])
            .map_err(|err| PipelineError::Generic(format!("pipeline add: {:?}", err)))?;
        gst::Element::link_many(&[&src, &queue, sink.upcast_ref()])
            .map_err(|err| PipelineError::Generic(format!("pipeline link: {:?}", err)))?;

        Ok((pipeline, sink))
    }

    fn start(
        &self,
        url: &str,
        config: StreamPipelineConfig,
        permit: OwnedSemaphorePermit,
    ) -> Result<PipelineDecision, PipelineError> {
        let (tx, rx) = mpsc::channel::<Result<Bytes, io::Error>>(64);
        let url = url.to_string();
        std::thread::spawn(move || {
            let (pipeline, appsink) = match Self.build_pipeline(&Self, &url, &config) {
                Ok(result) => result,
                Err(err) => {
                    let _ = tx.blocking_send(Err(io::Error::new(
                        io::ErrorKind::Other,
                        format!("{err:?}"),
                    )));
                    drop(permit);
                    return;
                }
            };

            let bus = match pipeline.bus() {
                Some(bus) => bus,
                None => {
                    let _ = tx.blocking_send(Err(io::Error::new(
                        io::ErrorKind::Other,
                        "pipeline bus unavailable",
                    )));
                    drop(permit);
                    return;
                }
            };

            let tx_clone = tx.clone();
            let mut tx_for_cb = tx;
            let _ = appsink.set_callbacks(
                gst_app::AppSinkCallbacks::builder()
                    .new_sample(move |sink| {
                        let sample = match sink.pull_sample() {
                            Some(sample) => sample,
                            None => return Err(gst::FlowError::Eos),
                        };
                        let buffer = match sample.buffer() {
                            Some(buffer) => buffer,
                            None => return Err(gst::FlowError::Eos),
                        };
                        let map = match buffer.map_readable() {
                            Ok(map) => map,
                            Err(_) => return Err(gst::FlowError::Error),
                        };
                        match tx_for_cb.try_send(Ok(Bytes::copy_from_slice(map.as_ref()))) {
                            Ok(_) => Ok(gst::FlowSuccess::Ok),
                            Err(_) => Err(gst::FlowError::Eos),
                        }
                    })
                    .build(),
            );

            if let Err(err) = pipeline.set_state(gst::State::Playing) {
                let _ = tx_clone.blocking_send(Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("failed to start pipeline: {:?}", err),
                )));
                drop(permit);
                return;
            }

            loop {
                if tx_clone.is_closed() {
                    break;
                }
                match bus.timed_pop(gst::ClockTime::from_mseconds(100)) {
                    Some(msg) => match msg.view() {
                        gst::MessageView::Eos(..) => break,
                        gst::MessageView::Error(err) => {
                            let _ = tx_clone.blocking_send(Err(io::Error::new(
                                io::ErrorKind::Other,
                                format!("pipeline error: {:?}", err.error()),
                            )));
                            break;
                        }
                        _ => {}
                    },
                    None => continue,
                }
            }

            let _ = pipeline.set_state(gst::State::Null);
            drop(permit);
        });

        let stream = ReceiverStream::new(rx).map(|result| result.map_err(io::Error::other));
        let body = axum::body::Body::from_stream(stream);
        Ok(PipelineDecision::Stream {
            body,
            content_type: None,
        })
    }
}
