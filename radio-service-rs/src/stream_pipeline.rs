use std::collections::HashMap;
#[cfg(feature = "gstreamer")]
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use bytes::Bytes;
use deadpool_redis::Pool as RedisPool;
use serde::Serialize;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{Mutex as AsyncMutex, Semaphore};

#[cfg(feature = "gstreamer")]
use {
    gstreamer as gst,
    gstreamer::prelude::*,
    gstreamer_app as gst_app,
    std::sync::atomic::AtomicBool,
    std::sync::mpsc as std_mpsc,
    std::time::Duration,
    tokio::sync::{mpsc as tokio_mpsc, OwnedSemaphorePermit},
    tokio_stream::wrappers::ReceiverStream,
    tokio_stream::StreamExt,
};

use crate::config::{StreamPipelineConfig, StreamPipelineHlsConfig};
#[cfg(feature = "gstreamer")]
use crate::hls::SegmentPayload;
use crate::hls::{HlsSegmentStore, PlaylistSnapshot};
use crate::logging::logger;
use crate::stream_format::StreamFormat;

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
    pub format: StreamFormat,
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
    metrics: Arc<PipelineMetrics>,
    hls_manager: Option<Arc<HlsManager>>,
}

#[allow(dead_code)]
#[derive(Clone)]
struct HlsManager {
    store: HlsSegmentStore,
    config: StreamPipelineHlsConfig,
    active: Arc<AsyncMutex<HashMap<String, Arc<HlsHandle>>>>,
}

#[allow(dead_code)]
struct HlsHandle {
    last_access: Mutex<Instant>,
}

#[allow(dead_code)]
impl HlsManager {
    fn new(store: HlsSegmentStore, config: StreamPipelineHlsConfig) -> Self {
        Self {
            store,
            config,
            active: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }

    async fn register(&self, station_id: &str) -> bool {
        let mut guard = self.active.lock().await;
        if guard.contains_key(station_id) {
            return false;
        }
        guard.insert(
            station_id.to_string(),
            Arc::new(HlsHandle {
                last_access: Mutex::new(Instant::now()),
            }),
        );
        true
    }

    async fn unregister(&self, station_id: &str) {
        let mut guard = self.active.lock().await;
        guard.remove(station_id);
    }

    async fn touch(&self, station_id: &str) {
        let guard = self.active.lock().await;
        if let Some(handle) = guard.get(station_id) {
            if let Ok(mut last) = handle.last_access.lock() {
                *last = Instant::now();
            }
        }
    }

    fn store(&self) -> HlsSegmentStore {
        self.store.clone()
    }

    fn config(&self) -> StreamPipelineHlsConfig {
        self.config.clone()
    }
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

#[cfg(feature = "gstreamer")]
struct EncoderSpec {
    encoder: gst::Element,
    extra_elements: Vec<gst::Element>,
    caps: gst::Caps,
    content_type: &'static str,
    use_icydemux: bool,
}

#[allow(dead_code)]
#[derive(Default)]
struct PipelineMetrics {
    attempts: AtomicU64,
    successes: AtomicU64,
    failures: Mutex<HashMap<&'static str, u64>>,
}

#[allow(dead_code)]
impl PipelineMetrics {
    fn record_attempt(&self, station_id: &str, url: &str) {
        self.attempts.fetch_add(1, Ordering::Relaxed);
        logger().debug(
            "stream.pipeline.metrics.attempt",
            json!({
                "stationId": station_id,
                "url": url,
                "attempts": self.attempts.load(Ordering::Relaxed),
            }),
        );
    }

    fn record_success(&self, engine: &str, station_id: &str, url: &str) {
        self.successes.fetch_add(1, Ordering::Relaxed);
        logger().info(
            "stream.pipeline.metrics.success",
            json!({
                "engine": engine,
                "stationId": station_id,
                "url": url,
                "attempts": self.attempts.load(Ordering::Relaxed),
                "successes": self.successes.load(Ordering::Relaxed),
            }),
        );
    }

    fn record_failure(&self, reason: &'static str, station_id: &str, url: &str) {
        let mut guard = self.failures.lock().unwrap();
        *guard.entry(reason).or_insert(0) += 1;
        let failure_counts: Vec<_> = guard
            .iter()
            .map(|(r, count)| json!({ "reason": r, "count": count }))
            .collect();
        drop(guard);
        logger().warn(
            "stream.pipeline.metrics.failure",
            json!({
                "reason": reason,
                "stationId": station_id,
                "url": url,
                "attempts": self.attempts.load(Ordering::Relaxed),
                "successes": self.successes.load(Ordering::Relaxed),
                "failures": failure_counts,
            }),
        );
    }
}

impl StreamPipeline {
    pub fn new(config: StreamPipelineConfig, redis: RedisPool) -> Self {
        let metrics = Arc::new(PipelineMetrics::default());
        let hls_manager = if config.hls.enabled {
            Some(Arc::new(HlsManager::new(
                HlsSegmentStore::new(redis, config.hls.clone()),
                config.hls.clone(),
            )))
        } else {
            None
        };
        if !config.enabled {
            return Self {
                semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                config,
                engine: PipelineEngine::Disabled,
                metrics,
                hls_manager,
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
                    metrics,
                    hls_manager: hls_manager.clone(),
                };
            }
            let instance = Self {
                semaphore: Arc::new(Semaphore::new(config.max_concurrency.max(1))),
                config,
                engine: PipelineEngine::GStreamer(GStreamerEngine),
                metrics,
                hls_manager,
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
                metrics,
                hls_manager,
            }
        }
    }

    pub fn is_enabled(&self) -> bool {
        !matches!(self.engine, PipelineEngine::Disabled)
    }

    pub async fn load_hls_segment(
        &self,
        station_id: &str,
        sequence: u64,
    ) -> Result<Option<(String, Bytes)>, PipelineError> {
        let Some(manager) = &self.hls_manager else {
            return Err(PipelineError::Unavailable);
        };
        match manager.store().load_segment(station_id, sequence).await {
            Ok(Some(segment)) => {
                manager.touch(station_id).await;
                Ok(Some((segment.content_type, segment.bytes)))
            }
            Ok(None) => Ok(None),
            Err(err) => {
                logger().warn(
                    "stream.pipeline.hls.segment_load_failed",
                    json!({
                        "stationId": station_id,
                        "sequence": sequence,
                        "error": format!("{:?}", err),
                    }),
                );
                Err(PipelineError::Generic(
                    "failed to load HLS segment from store".into(),
                ))
            }
        }
    }

    #[allow(dead_code)]
    pub async fn request_hls_playlist(
        &self,
        station_id: &str,
        url: &str,
        format: StreamFormat,
    ) -> Result<Option<PlaylistSnapshot>, PipelineError> {
        let Some(manager) = &self.hls_manager else {
            return Err(PipelineError::Unavailable);
        };

        #[cfg(not(feature = "gstreamer"))]
        let _ = format;

        match manager.store().load_playlist(station_id).await {
            Ok(Some(snapshot)) => {
                manager.touch(station_id).await;
                return Ok(Some(snapshot));
            }
            Ok(None) => {}
            Err(err) => {
                logger().warn(
                    "stream.pipeline.hls.playlist_load_failed",
                    json!({
                        "stationId": station_id,
                        "url": url,
                        "error": format!("{:?}", err),
                    }),
                );
            }
        }

        if !manager.register(station_id).await {
            manager.touch(station_id).await;
            return Ok(None);
        }

        let permit = self
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| PipelineError::Unavailable)?;

        #[cfg(not(feature = "gstreamer"))]
        {
            drop(permit);
        }

        #[cfg(feature = "gstreamer")]
        let result: Result<(), PipelineError> = match &self.engine {
            PipelineEngine::GStreamer(engine) => engine.start_hls(
                url,
                station_id,
                self.config.clone(),
                format,
                self.metrics.clone(),
                permit,
                manager.clone(),
            ),
            PipelineEngine::Disabled => Err(PipelineError::Unavailable),
        };

        #[cfg(not(feature = "gstreamer"))]
        let result: Result<(), PipelineError> = Err(PipelineError::Unavailable);

        if let Err(err) = result {
            manager.unregister(station_id).await;
            return Err(err);
        }

        Ok(None)
    }

    pub async fn attempt(
        &self,
        url: &str,
        format: StreamFormat,
        station_id: &str,
    ) -> Result<PipelineDecision, PipelineError> {
        if !self.is_enabled() {
            return Err(PipelineError::Disabled);
        }

        let permit = self
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| PipelineError::Unavailable)?;

        self.metrics.record_attempt(station_id, url);

        #[cfg(feature = "gstreamer")]
        {
            match &self.engine {
                PipelineEngine::GStreamer(engine) => {
                    logger().info(
                        "stream.pipeline.attempt",
                        serde_json::json!({
                            "engine": "gstreamer",
                            "stationId": station_id,
                            "url": url,
                            "format": format,
                        }),
                    );
                    let metrics = self.metrics.clone();
                    match engine.start(
                        url,
                        station_id,
                        self.config.clone(),
                        format,
                        metrics.clone(),
                        permit,
                    ) {
                        Ok(decision) => {
                            metrics.record_success("gstreamer", station_id, url);
                            Ok(decision)
                        }
                        Err(err) => {
                            metrics.record_failure("start_failed", station_id, url);
                            Err(err)
                        }
                    }
                }
                PipelineEngine::Disabled => Err(PipelineError::Unavailable),
            }
        }

        #[cfg(not(feature = "gstreamer"))]
        {
            let _ = permit;
            let _ = format;
            Err(PipelineError::Unavailable)
        }
    }
}

#[cfg(feature = "gstreamer")]
impl GStreamerEngine {
    fn build_pipeline(
        &self,
        url: &str,
        station_id: &str,
        config: &StreamPipelineConfig,
        format: StreamFormat,
    ) -> Result<(gst::Pipeline, gst_app::AppSink, String), PipelineError> {
        let timeout_seconds = std::cmp::max(1, (config.timeout_ms / 1000).max(1)) as u32;
        let pipeline = gst::Pipeline::new();
        let EncoderSpec {
            encoder,
            extra_elements,
            caps,
            content_type,
            use_icydemux,
        } = Self::encoder_spec(format)?;
        let pipeline_kind = content_type;
        logger().info(
            "stream.pipeline.builder",
            json!({
                "stationId": station_id,
                "url": url,
                "format": format,
                "kind": pipeline_kind,
            }),
        );

        let src = gst::ElementFactory::make("souphttpsrc")
            .name("source")
            .property("location", url)
            .property("user-agent", &config.user_agent)
            .property("timeout", timeout_seconds)
            .property("iradio-mode", true)
            .property("is-live", true)
            .build()
            .map_err(|err| PipelineError::Generic(format!("build source: {:?}", err)))?;

        let demux = if use_icydemux {
            Some(
                gst::ElementFactory::make("icydemux")
                    .name("icydemux")
                    .build()
                    .map_err(|err| PipelineError::Generic(format!("build icydemux: {:?}", err)))?,
            )
        } else {
            None
        };

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

        let sink = gst::ElementFactory::make("appsink")
            .name("outsink")
            .property("emit-signals", true)
            .property("sync", false)
            .property("caps", caps)
            .build()
            .map_err(|err| PipelineError::Generic(format!("build appsink: {:?}", err)))?;

        let sink: gst_app::AppSink = sink
            .downcast()
            .map_err(|_| PipelineError::Generic("failed to cast appsink".into()))?;

        let mut elements: Vec<&gst::Element> = vec![src.upcast_ref::<gst::Element>()];
        if let Some(demux) = demux.as_ref() {
            elements.push(demux.upcast_ref::<gst::Element>());
        }
        elements.push(decode.upcast_ref::<gst::Element>());
        elements.push(convert.upcast_ref::<gst::Element>());
        elements.push(resample.upcast_ref::<gst::Element>());
        elements.push(encoder.upcast_ref::<gst::Element>());
        for extra in extra_elements.iter() {
            elements.push(extra.upcast_ref::<gst::Element>());
        }
        elements.push(sink.upcast_ref::<gst::Element>());

        pipeline
            .add_many(elements.as_slice())
            .map_err(|err| PipelineError::Generic(format!("add elements: {:?}", err)))?;

        let mut convert_chain: Vec<&gst::Element> = vec![
            convert.upcast_ref::<gst::Element>(),
            resample.upcast_ref::<gst::Element>(),
            encoder.upcast_ref::<gst::Element>(),
        ];
        for extra in extra_elements.iter() {
            convert_chain.push(extra.upcast_ref::<gst::Element>());
        }
        convert_chain.push(sink.upcast_ref::<gst::Element>());
        gst::Element::link_many(convert_chain.as_slice())
            .map_err(|err| PipelineError::Generic(format!("link convert chain: {:?}", err)))?;

        if let Some(demux_element) = demux.as_ref() {
            let decode_weak = decode.downgrade();
            demux_element.connect_pad_added(move |_demux, src_pad| {
                let Some(decode) = decode_weak.upgrade() else {
                    return;
                };
                let Some(sink_pad) = decode.static_pad("sink") else {
                    return;
                };
                if sink_pad.is_linked() {
                    return;
                }
                if let Err(err) = src_pad.link(&sink_pad) {
                    logger().warn(
                        "stream.pipeline.demux_link_failed",
                        json!({ "error": format!("{:?}", err) }),
                    );
                }
            });

            src.link(demux_element).map_err(|err| {
                PipelineError::Generic(format!("link source->icydemux: {:?}", err))
            })?;
        } else {
            src.link(&decode)
                .map_err(|err| PipelineError::Generic(format!("link source->decode: {:?}", err)))?;
        }

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

        Ok((pipeline, sink, content_type.to_string()))
    }

    #[cfg(feature = "gstreamer")]
    fn encoder_spec(format: StreamFormat) -> Result<EncoderSpec, PipelineError> {
        match format {
            StreamFormat::Aac => {
                let encoder = gst::ElementFactory::make("avenc_aac")
                    .name("encoder")
                    .property("bitrate", 128_000i32)
                    .build()
                    .map_err(|err| PipelineError::Generic(format!("build avenc_aac: {:?}", err)))?;
                let caps = gst::Caps::builder("audio/mpeg")
                    .field("mpegversion", 4i32)
                    .field("stream-format", "adts")
                    .build();
                Ok(EncoderSpec {
                    encoder,
                    extra_elements: Vec::new(),
                    caps,
                    content_type: "audio/aac",
                    use_icydemux: false,
                })
            }
            StreamFormat::Ogg => {
                let encoder = gst::ElementFactory::make("vorbisenc")
                    .name("encoder")
                    .property("quality", 0.3f64)
                    .build()
                    .map_err(|err| PipelineError::Generic(format!("build vorbisenc: {:?}", err)))?;
                let mux = gst::ElementFactory::make("oggmux")
                    .name("oggmux")
                    .build()
                    .map_err(|err| PipelineError::Generic(format!("build oggmux: {:?}", err)))?;
                Ok(EncoderSpec {
                    encoder,
                    extra_elements: vec![mux],
                    caps: gst::Caps::builder("application/ogg").build(),
                    content_type: "audio/ogg",
                    use_icydemux: false,
                })
            }
            StreamFormat::Opus => {
                let encoder = gst::ElementFactory::make("opusenc")
                    .name("encoder")
                    .property("bitrate", 128_000i32)
                    .build()
                    .map_err(|err| PipelineError::Generic(format!("build opusenc: {:?}", err)))?;
                let mux = gst::ElementFactory::make("oggmux")
                    .name("oggmux")
                    .build()
                    .map_err(|err| PipelineError::Generic(format!("build oggmux: {:?}", err)))?;
                Ok(EncoderSpec {
                    encoder,
                    extra_elements: vec![mux],
                    caps: gst::Caps::builder("application/ogg").build(),
                    content_type: "audio/ogg; codecs=opus",
                    use_icydemux: false,
                })
            }
            StreamFormat::Flac => {
                let encoder = gst::ElementFactory::make("flacenc")
                    .name("encoder")
                    .build()
                    .map_err(|err| PipelineError::Generic(format!("build flacenc: {:?}", err)))?;
                Ok(EncoderSpec {
                    encoder,
                    extra_elements: Vec::new(),
                    caps: gst::Caps::builder("audio/x-flac").build(),
                    content_type: "audio/flac",
                    use_icydemux: false,
                })
            }
            StreamFormat::Wma => {
                let encoder = gst::ElementFactory::make("avenc_wmav2")
                    .name("encoder")
                    .build()
                    .map_err(|err| {
                        PipelineError::Generic(format!("build avenc_wmav2: {:?}", err))
                    })?;
                Ok(EncoderSpec {
                    encoder,
                    extra_elements: Vec::new(),
                    caps: gst::Caps::builder("audio/x-ms-wma").build(),
                    content_type: "audio/x-ms-wma",
                    use_icydemux: false,
                })
            }
            _ => {
                let encoder = gst::ElementFactory::make("lamemp3enc")
                    .name("encoder")
                    .property("bitrate", 128i32)
                    .build()
                    .map_err(|err| {
                        PipelineError::Generic(format!("build lamemp3enc: {:?}", err))
                    })?;
                let caps = gst::Caps::builder("audio/mpeg")
                    .field("mpegversion", 1i32)
                    .field("layer", 3i32)
                    .build();
                Ok(EncoderSpec {
                    encoder,
                    extra_elements: Vec::new(),
                    caps,
                    content_type: "audio/mpeg",
                    use_icydemux: true,
                })
            }
        }
    }

    fn start(
        &self,
        url: &str,
        station_id: &str,
        config: StreamPipelineConfig,
        format: StreamFormat,
        metrics: Arc<PipelineMetrics>,
        permit: tokio::sync::OwnedSemaphorePermit,
    ) -> Result<PipelineDecision, PipelineError> {
        let station_id_owned = station_id.to_string();
        let (tx_samples, rx_samples) = std_mpsc::channel::<Result<Bytes, std::io::Error>>();
        let (body_tx, body_rx) = tokio_mpsc::channel::<Result<Bytes, std::io::Error>>(512);
        let url = url.to_string();
        let (pipeline, appsink, content_type) = Self
            .build_pipeline(&url, &station_id_owned, &config, format)
            .map_err(|err| PipelineError::Generic(format!("pipeline build failed: {:?}", err)))?;

        // Use appsink callbacks to push samples without blocking the async runtime.
        let tx_samples_clone = tx_samples.clone();
        let metrics_samples = metrics.clone();
        let url_for_samples = url.clone();
        let station_for_samples = station_id_owned.clone();
        let downstream_logged = Arc::new(AtomicBool::new(false));
        let downstream_logged_samples = downstream_logged.clone();
        appsink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_sample(move |sink| match sink.pull_sample() {
                    Ok(sample) => {
                        if let Some(buffer) = sample.buffer() {
                            if let Ok(map) = buffer.map_readable() {
                                let chunk = Bytes::copy_from_slice(map.as_ref());
                                if tx_samples_clone.send(Ok(chunk)).is_err() {
                                    metrics_samples.record_failure(
                                        "downstream_closed",
                                        &station_for_samples,
                                        &url_for_samples,
                                    );
                                    if !downstream_logged_samples.swap(true, Ordering::Relaxed) {
                                        logger().info(
                                            "stream.pipeline.downstream_closed",
                                            json!({
                                                "stationId": station_for_samples,
                                                "url": url_for_samples
                                            }),
                                        );
                                    }
                                    return Err(gst::FlowError::Eos);
                                }
                            }
                        }
                        Ok(gst::FlowSuccess::Ok)
                    }
                    Err(err) => {
                        let _ = tx_samples_clone.send(Err(std::io::Error::other(format!(
                            "sample pull error: {err:?}"
                        ))));
                        metrics_samples.record_failure(
                            "sample_pull_error",
                            &station_for_samples,
                            &url_for_samples,
                        );
                        logger().warn(
                            "stream.pipeline.sample_error",
                            json!({
                                "stationId": station_for_samples,
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
                "stationId": station_id_owned,
                "url": url,
                "format": format,
            }),
        );

        if let Some(bus) = pipeline.bus() {
            let tx_bus = tx_samples.clone();
            let url_bus = url.clone();
            let metrics_bus = metrics.clone();
            let station_for_bus = station_id_owned.clone();
            let downstream_logged_bus = downstream_logged.clone();
            std::thread::spawn(move || {
                while let Some(msg) = bus.timed_pop(gst::ClockTime::from_seconds(1)) {
                    match msg.view() {
                        gst::MessageView::Eos(..) => {
                            let _ = tx_bus.send(Err(std::io::Error::other("pipeline eos")));
                            downstream_logged_bus.store(true, Ordering::Relaxed);
                            break;
                        }
                        gst::MessageView::Error(err) => {
                            let debug = err
                                .debug()
                                .map(|value| value.to_string())
                                .unwrap_or_else(|| "none".into());
                            let _ = tx_bus.send(Err(std::io::Error::other(format!(
                                "pipeline error: {:?}",
                                err.error()
                            ))));
                            metrics_bus.record_failure("bus_error", &station_for_bus, &url_bus);
                            logger().warn(
                                "stream.pipeline.bus_error",
                                json!({
                                    "stationId": station_for_bus,
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

        let pipeline_for_shutdown = pipeline.clone();
        let buffer_delay = std::time::Duration::from_secs(config.buffer_seconds);
        let body_tx_forward = body_tx.clone();
        let metrics_forward = metrics.clone();
        let url_forward = url.to_string();
        let station_forward = station_id_owned.clone();
        std::thread::spawn(move || {
            let start = std::time::Instant::now();
            while let Ok(item) = rx_samples.recv() {
                if !buffer_delay.is_zero() {
                    let elapsed = start.elapsed();
                    if elapsed < buffer_delay {
                        std::thread::sleep(buffer_delay - elapsed);
                    }
                }
                if body_tx_forward.blocking_send(item).is_err() {
                    metrics_forward.record_failure(
                        "body_channel_closed",
                        &station_forward,
                        &url_forward,
                    );
                    logger().debug(
                        "stream.pipeline.body_channel_closed",
                        json!({
                            "stationId": station_forward,
                            "url": url_forward,
                        }),
                    );
                    break;
                }
            }
            let _ = pipeline_for_shutdown.set_state(gst::State::Null);
            drop(permit);
        });

        let stream =
            ReceiverStream::new(body_rx).map(|result| result.map_err(std::io::Error::other));
        let body = axum::body::Body::from_stream(stream);
        Ok(PipelineDecision::Stream {
            body,
            content_type: Some(content_type),
        })
    }

    fn start_hls(
        &self,
        url: &str,
        station_id: &str,
        config: StreamPipelineConfig,
        format: StreamFormat,
        metrics: Arc<PipelineMetrics>,
        permit: OwnedSemaphorePermit,
        manager: Arc<HlsManager>,
    ) -> Result<(), PipelineError> {
        let station_id_owned = station_id.to_string();
        let (tx_samples, rx_samples) = std_mpsc::channel::<Result<Bytes, std::io::Error>>();
        let url = url.to_string();
        let (pipeline, appsink, content_type) = Self
            .build_pipeline(&url, &station_id_owned, &config, format)
            .map_err(|err| PipelineError::Generic(format!("pipeline build failed: {:?}", err)))?;

        let tx_samples_clone = tx_samples.clone();
        let metrics_samples = metrics.clone();
        let url_for_samples = url.clone();
        let station_for_samples = station_id_owned.clone();
        let downstream_logged = Arc::new(AtomicBool::new(false));
        let downstream_logged_samples = downstream_logged.clone();
        appsink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_sample(move |sink| match sink.pull_sample() {
                    Ok(sample) => {
                        if let Some(buffer) = sample.buffer() {
                            if let Ok(map) = buffer.map_readable() {
                                let chunk = Bytes::copy_from_slice(map.as_ref());
                                if tx_samples_clone.send(Ok(chunk)).is_err() {
                                    metrics_samples.record_failure(
                                        "downstream_closed",
                                        &station_for_samples,
                                        &url_for_samples,
                                    );
                                    if !downstream_logged_samples.swap(true, Ordering::Relaxed) {
                                        logger().info(
                                            "stream.pipeline.downstream_closed",
                                            json!({
                                                "stationId": station_for_samples,
                                                "url": url_for_samples
                                            }),
                                        );
                                    }
                                    return Err(gst::FlowError::Eos);
                                }
                            }
                        }
                        Ok(gst::FlowSuccess::Ok)
                    }
                    Err(err) => {
                        let _ = tx_samples_clone.send(Err(std::io::Error::other(format!(
                            "sample pull error: {err:?}"
                        ))));
                        metrics_samples.record_failure(
                            "sample_pull_error",
                            &station_for_samples,
                            &url_for_samples,
                        );
                        logger().warn(
                            "stream.pipeline.sample_error",
                            json!({
                                "stationId": station_for_samples,
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
            "stream.pipeline.hls_started",
            json!({
                "stationId": station_id_owned,
                "url": url,
                "format": format,
            }),
        );

        if let Some(bus) = pipeline.bus() {
            let tx_bus = tx_samples.clone();
            let url_bus = url.clone();
            let metrics_bus = metrics.clone();
            let station_for_bus = station_id_owned.clone();
            let downstream_logged_bus = downstream_logged.clone();
            std::thread::spawn(move || {
                while let Some(msg) = bus.timed_pop(gst::ClockTime::from_seconds(1)) {
                    match msg.view() {
                        gst::MessageView::Eos(..) => {
                            let _ = tx_bus.send(Err(std::io::Error::other("pipeline eos")));
                            downstream_logged_bus.store(true, Ordering::Relaxed);
                            break;
                        }
                        gst::MessageView::Error(err) => {
                            let debug = err
                                .debug()
                                .map(|value| value.to_string())
                                .unwrap_or_else(|| "none".into());
                            let _ = tx_bus.send(Err(std::io::Error::other(format!(
                                "pipeline error: {:?}",
                                err.error()
                            ))));
                            metrics_bus.record_failure("bus_error", &station_for_bus, &url_bus);
                            logger().warn(
                                "stream.pipeline.bus_error",
                                json!({
                                    "stationId": station_for_bus,
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

        let pipeline_for_shutdown = pipeline.clone();
        let hls_config = manager.config();
        let hls_store = manager.store();
        let manager_for_shutdown = manager.clone();
        let station_for_shutdown = station_id_owned.clone();
        let runtime = tokio::runtime::Handle::current();
        std::thread::spawn(move || {
            let segment_duration = Duration::from_secs(hls_config.segment_seconds.max(1));
            let mut segment_started = Instant::now();
            let mut buffer: Vec<u8> = Vec::new();
            let mut next_sequence: u64 = 0;
            let mut window: VecDeque<u64> = VecDeque::new();
            let max_segments = hls_config.segment_count.max(1);
            let content_type_owned = content_type.clone();

            let mut flush_segment = |data: Vec<u8>, sequence: u64| {
                if data.is_empty() {
                    return;
                }
                let payload = SegmentPayload {
                    sequence,
                    content_type: content_type_owned.clone(),
                    bytes: Bytes::from(data),
                };
                let store_clone = hls_store.clone();
                let station_clone = station_id_owned.clone();
                let target_duration = hls_config.segment_seconds.max(1);
                window.push_back(sequence);
                while window.len() > max_segments {
                    window.pop_front();
                }
                let playlist_body = build_playlist_body(&window, target_duration);
                let media_sequence = window.front().copied().unwrap_or(sequence);
                let store_future = async {
                    if let Err(err) = store_clone.store_segment(&station_clone, &payload).await {
                        logger().warn(
                            "stream.pipeline.hls.segment_store_failed",
                            json!({
                                "stationId": station_clone,
                                "sequence": sequence,
                                "error": format!("{:?}", err),
                            }),
                        );
                        return;
                    }
                    let snapshot =
                        store_clone.create_playlist_snapshot(playlist_body.clone(), media_sequence);
                    if let Err(err) = store_clone.store_playlist(&station_clone, &snapshot).await {
                        logger().warn(
                            "stream.pipeline.hls.playlist_store_failed",
                            json!({
                                "stationId": station_clone,
                                "sequence": sequence,
                                "error": format!("{:?}", err),
                            }),
                        );
                    }
                };
                runtime.block_on(store_future);
            };

            while let Ok(item) = rx_samples.recv() {
                match item {
                    Ok(chunk) => {
                        buffer.extend_from_slice(chunk.as_ref());
                        if segment_started.elapsed() >= segment_duration {
                            let data = std::mem::take(&mut buffer);
                            flush_segment(data, next_sequence);
                            next_sequence = next_sequence.wrapping_add(1);
                            segment_started = Instant::now();
                        }
                    }
                    Err(_) => break,
                }
            }

            if !buffer.is_empty() {
                let data = std::mem::take(&mut buffer);
                flush_segment(data, next_sequence);
            }

            let _ = pipeline_for_shutdown.set_state(gst::State::Null);
            runtime.block_on(async {
                manager_for_shutdown.unregister(&station_for_shutdown).await;
            });
            drop(permit);
        });

        Ok(())
    }
}
#[cfg(feature = "gstreamer")]
fn build_playlist_body(sequences: &VecDeque<u64>, target_duration: u64) -> String {
    let mut lines = Vec::new();
    lines.push("#EXTM3U".to_string());
    lines.push("#EXT-X-VERSION:3".to_string());
    lines.push(format!("#EXT-X-TARGETDURATION:{}", target_duration.max(1)));
    let media_sequence = sequences.front().copied().unwrap_or(0);
    lines.push(format!("#EXT-X-MEDIA-SEQUENCE:{}", media_sequence));
    for sequence in sequences.iter() {
        lines.push(format!("#EXTINF:{}.0,", target_duration.max(1)));
        lines.push(format!("segment?n={sequence}"));
    }
    lines.push(String::new());
    lines.join("\n")
}
