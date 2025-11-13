use serde::Serialize;
use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const MONITOR_INTERVAL_MS: u64 = 500;

#[derive(Clone)]
pub struct GatewayMetrics {
    inner: Arc<MetricsInner>,
}

struct MetricsInner {
    start_time: Instant,
    event_loop_lag_ms: AtomicU64,
    active_requests: AtomicU64,
    total_requests: AtomicU64,
    overload_threshold_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct GatewayStatus {
    pub status: &'static str,
    pub uptime_ms: u64,
    pub event_loop_lag_ms: u64,
    pub active_requests: u64,
    pub total_requests: u64,
    pub rss_bytes: u64,
}

impl GatewayMetrics {
    pub fn new(overload_threshold_ms: u64) -> Self {
        let metrics = GatewayMetrics {
            inner: Arc::new(MetricsInner {
                start_time: Instant::now(),
                event_loop_lag_ms: AtomicU64::new(0),
                active_requests: AtomicU64::new(0),
                total_requests: AtomicU64::new(0),
                overload_threshold_ms,
            }),
        };
        metrics.spawn_monitor();
        metrics
    }

    pub fn start_request(&self) {
        self.inner.active_requests.fetch_add(1, Ordering::Relaxed);
        self.inner.total_requests.fetch_add(1, Ordering::Relaxed);
    }

    pub fn finish_request(&self) {
        self.inner.active_requests.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn is_overloaded(&self) -> bool {
        self.inner.event_loop_lag_ms.load(Ordering::Relaxed) > self.inner.overload_threshold_ms
    }

    pub fn snapshot(&self) -> GatewayStatus {
        GatewayStatus {
            status: "ok",
            uptime_ms: self.inner.start_time.elapsed().as_millis() as u64,
            event_loop_lag_ms: self.inner.event_loop_lag_ms.load(Ordering::Relaxed),
            active_requests: self.inner.active_requests.load(Ordering::Relaxed),
            total_requests: self.inner.total_requests.load(Ordering::Relaxed),
            rss_bytes: current_rss_bytes(),
        }
    }

    fn spawn_monitor(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(MONITOR_INTERVAL_MS));
            loop {
                let tick_started = Instant::now();
                interval.tick().await;
                let elapsed = tick_started.elapsed();
                let lag = elapsed
                    .saturating_sub(Duration::from_millis(MONITOR_INTERVAL_MS))
                    .as_millis() as u64;
                inner.event_loop_lag_ms.store(lag, Ordering::Relaxed);
            }
        });
    }
}

fn current_rss_bytes() -> u64 {
    // Linux-only best effort: read RSS pages from /proc/self/statm.
    if let Ok(contents) = fs::read_to_string("/proc/self/statm")
        && let Some(rss_pages_str) = contents.split_whitespace().nth(1)
        && let Ok(rss_pages) = rss_pages_str.parse::<u64>()
    {
        let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if page_size > 0 {
            return rss_pages.saturating_mul(page_size as u64);
        }
    }
    0
}
