use crate::fetch_md::{FetchLimits, FetchMdError, resolve_public_addrs, validate_url};
use chromiumoxide::browser::Browser;
use chromiumoxide::cdp::browser_protocol::fetch::{
    ContinueRequestParams, EventRequestPaused, FailRequestParams,
};
use chromiumoxide::cdp::browser_protocol::network::ErrorReason;
use chromiumoxide::handler::HandlerConfig;
use futures_util::StreamExt;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::time::{sleep, timeout};
use url::Url;

const RENDER_HOST: &str = "127.0.0.1";
const CONNECT_RETRY_DELAY: Duration = Duration::from_millis(100);

#[derive(Clone, Debug)]
pub struct RenderConfig {
    pub enabled: bool,
    pub max_concurrency: usize,
    pub max_subrequests: usize,
    pub port: u16,
    pub timeout: Duration,
    pub startup_timeout: Duration,
    pub spa_text_threshold: usize,
    pub post_load_wait_ms: u64,
    pub ws_url: String,
    pub binary: String,
}

#[derive(Clone, Debug)]
pub struct RenderState {
    pub config: RenderConfig,
    pub semaphore: Option<Arc<Semaphore>>,
}

impl RenderState {
    pub fn new(config: RenderConfig) -> Self {
        let semaphore = if config.enabled {
            Some(Arc::new(Semaphore::new(config.max_concurrency)))
        } else {
            None
        };
        Self { config, semaphore }
    }
}

pub async fn render_html_with_lightpanda(
    url: &Url,
    config: &RenderConfig,
    limits: &FetchLimits,
) -> Result<String, FetchMdError> {
    let render = timeout(config.timeout, render_html_inner(url, config, limits)).await;
    match render {
        Ok(result) => result,
        Err(_) => Err(FetchMdError::Upstream("Rendered fetch timed out".into())),
    }
}

async fn render_html_inner(
    url: &Url,
    config: &RenderConfig,
    limits: &FetchLimits,
) -> Result<String, FetchMdError> {
    let mut child = spawn_lightpanda(config)?;
    let connect_result = connect_browser(&config.ws_url, config.startup_timeout).await;

    let (mut browser, mut handler) = match connect_result {
        Ok(result) => result,
        Err(err) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(err);
        }
    };

    let handler_task = tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if event.is_err() {
                break;
            }
        }
    });

    let page = Arc::new(
        browser
            .new_page("about:blank")
            .await
            .map_err(|_| FetchMdError::Upstream("Failed to create Lightpanda page".into()))?,
    );

    let mut request_paused = page
        .event_listener::<EventRequestPaused>()
        .await
        .map_err(|_| FetchMdError::Upstream("Failed to listen for Lightpanda requests".into()))?;

    let intercepted_page = page.clone();
    let request_count = Arc::new(AtomicUsize::new(0));
    let blocked_request = Arc::new(AtomicBool::new(false));
    let intercept_limit = config.max_subrequests;
    let intercept_count = request_count.clone();
    let intercept_blocked = blocked_request.clone();

    let intercept_handle = tokio::spawn(async move {
        while let Some(event) = request_paused.next().await {
            if event.response_status_code.is_some() {
                let _ = intercepted_page
                    .execute(ContinueRequestParams::new(event.request_id.clone()))
                    .await;
                continue;
            }

            let count = intercept_count.fetch_add(1, Ordering::SeqCst) + 1;
            if count > intercept_limit {
                intercept_blocked.store(true, Ordering::SeqCst);
                let _ = intercepted_page
                    .execute(FailRequestParams::new(
                        event.request_id.clone(),
                        ErrorReason::BlockedByClient,
                    ))
                    .await;
                continue;
            }

            let allowed = is_render_url_allowed(&event.request.url).await;
            if !allowed {
                intercept_blocked.store(true, Ordering::SeqCst);
                let _ = intercepted_page
                    .execute(FailRequestParams::new(
                        event.request_id.clone(),
                        ErrorReason::BlockedByClient,
                    ))
                    .await;
                continue;
            }

            let _ = intercepted_page
                .execute(ContinueRequestParams::new(event.request_id.clone()))
                .await;
        }
    });

    let navigate = page
        .goto(url.as_str())
        .await
        .map_err(|_| FetchMdError::Upstream("Lightpanda navigation failed".into()));

    if navigate.is_err() {
        intercept_handle.abort();
        handler_task.abort();
        let _ = browser.close().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
        return Err(FetchMdError::Upstream(
            "Lightpanda navigation failed".into(),
        ));
    }

    if config.post_load_wait_ms > 0 {
        sleep(Duration::from_millis(config.post_load_wait_ms)).await;
    }

    let html = page
        .content()
        .await
        .map_err(|_| FetchMdError::Upstream("Failed to read Lightpanda HTML".into()))?;

    intercept_handle.abort();
    handler_task.abort();
    let _ = browser.close().await;
    let _ = child.kill().await;
    let _ = child.wait().await;

    if html.len() > limits.max_html_bytes {
        return Err(FetchMdError::TooLarge("Rendered HTML too large".into()));
    }

    if blocked_request.load(Ordering::SeqCst) {
        return Err(FetchMdError::Upstream(
            "Rendered fetch blocked by URL policy".into(),
        ));
    }

    Ok(html)
}

fn spawn_lightpanda(config: &RenderConfig) -> Result<tokio::process::Child, FetchMdError> {
    Command::new(&config.binary)
        .arg("serve")
        .arg("--host")
        .arg(RENDER_HOST)
        .arg("--port")
        .arg(config.port.to_string())
        .env("LIGHTPANDA_DISABLE_TELEMETRY", "true")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| FetchMdError::Upstream("Failed to start Lightpanda".into()))
}

async fn connect_browser(
    ws_url: &str,
    startup_timeout: Duration,
) -> Result<(Browser, chromiumoxide::handler::Handler), FetchMdError> {
    let deadline = Instant::now() + startup_timeout;
    loop {
        let config = HandlerConfig {
            request_intercept: true,
            cache_enabled: false,
            ..Default::default()
        };

        match Browser::connect_with_config(ws_url.to_string(), config).await {
            Ok(result) => return Ok(result),
            Err(_) => {
                if Instant::now() >= deadline {
                    return Err(FetchMdError::Upstream(
                        "Failed to connect to Lightpanda".into(),
                    ));
                }
                sleep(CONNECT_RETRY_DELAY).await;
            }
        }
    }
}

async fn is_render_url_allowed(raw: &str) -> bool {
    let parsed = match validate_url(raw) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };

    let host = match parsed.host_str() {
        Some(host) => host,
        None => return false,
    };

    let port = match parsed.port_or_known_default() {
        Some(port) => port,
        None => return false,
    };
    if port != 80 && port != 443 {
        return false;
    }

    resolve_public_addrs(host, port).await.is_ok()
}
