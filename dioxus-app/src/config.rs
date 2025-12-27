use dioxus::prelude::*;
use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct RuntimeConfig {
    pub radio_api_base_url: String,
    pub terminal_api_base_url: String,
    pub gateway_api_base_url: String,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            radio_api_base_url: "/api/radio".to_string(),
            terminal_api_base_url: "/api/terminal".to_string(),
            gateway_api_base_url: "/api".to_string(),
        }
    }
}

pub fn use_runtime_config() -> Resource<Result<RuntimeConfig, String>> {
    use_resource(|| async move { fetch_runtime_config().await })
}

#[cfg(target_arch = "wasm32")]
async fn fetch_runtime_config() -> Result<RuntimeConfig, String> {
    match fetch_config_from("/config.json").await {
        Ok(config) => Ok(config),
        Err(_) => fetch_config_from("/assets/config.json").await,
    }
}

#[cfg(target_arch = "wasm32")]
async fn fetch_config_from(path: &str) -> Result<RuntimeConfig, String> {
    let response = gloo_net::http::Request::get(path)
        .send()
        .await
        .map_err(|err| format!("config fetch failed: {err}"))?;
    if !response.ok() {
        return Err(format!("config fetch failed: status {}", response.status()));
    }
    response
        .json::<RuntimeConfig>()
        .await
        .map_err(|err| format!("config decode failed: {err}"))
}

#[cfg(not(target_arch = "wasm32"))]
async fn fetch_runtime_config() -> Result<RuntimeConfig, String> {
    let radio_api_base_url =
        std::env::var("RADIO_API_BASE_URL").unwrap_or_else(|_| "/api/radio".to_string());
    let terminal_api_base_url =
        std::env::var("TERMINAL_API_BASE_URL").unwrap_or_else(|_| "/api/terminal".to_string());
    let gateway_api_base_url =
        std::env::var("GATEWAY_API_BASE_URL").unwrap_or_else(|_| "/api".to_string());
    Ok(RuntimeConfig {
        radio_api_base_url,
        terminal_api_base_url,
        gateway_api_base_url,
    })
}
