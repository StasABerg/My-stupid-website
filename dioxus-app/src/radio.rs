use dioxus::prelude::*;
use serde::Deserialize;

use crate::config::RuntimeConfig;

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct RadioStation {
    pub id: String,
    pub name: String,
    #[serde(rename = "streamUrl")]
    pub stream_url: String,
    pub homepage: Option<String>,
    pub favicon: Option<String>,
    pub country: Option<String>,
    #[serde(rename = "countryCode")]
    pub country_code: Option<String>,
    pub state: Option<String>,
    pub languages: Vec<String>,
    pub tags: Vec<String>,
    pub bitrate: Option<i32>,
    pub codec: Option<String>,
    pub hls: bool,
    #[serde(rename = "isOnline")]
    pub is_online: bool,
    #[serde(rename = "clickCount")]
    pub click_count: i64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct StationsResponse {
    pub meta: StationsMeta,
    pub items: Vec<RadioStation>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct StationsMeta {
    pub total: i64,
    pub filtered: i64,
    pub matches: i64,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
    pub page: i64,
    pub limit: i64,
    #[serde(rename = "maxLimit")]
    pub max_limit: i64,
    #[serde(rename = "requestedLimit")]
    pub requested_limit: Option<String>,
    pub offset: i64,
    #[serde(rename = "cacheSource")]
    pub cache_source: String,
}

#[component]
pub fn RadioPage() -> Element {
    let config = use_context::<RuntimeConfig>();
    let base_url = config.radio_api_base_url.clone();
    let stations = use_resource(move || fetch_stations(base_url.clone()));
    let mut selected = use_signal::<Option<RadioStation>>(|| None);

    rsx! {
        div { class: "radio",
            h2 { "Broadcast Control" }
            match stations() {
                None => rsx! { p { "Loading stations..." } },
                Some(Err(message)) => rsx! { p { "Failed to load: {message}" } },
                Some(Ok(response)) => rsx! {
                    p { "Stations: {response.meta.matches}" }
                    ul { class: "station-list",
                        for station in response.items {
                            li { class: "station",
                                button {
                                    class: "station-play",
                                    onclick: move |_| selected.set(Some(station.clone())),
                                    "Play"
                                }
                                div { class: "station-info",
                                    strong { "{station.name}" }
                                    if let Some(country) = &station.country {
                                        span { class: "station-meta", " — {country}" }
                                    }
                                    if station.hls {
                                        span { class: "station-meta", " (HLS)" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if let Some(station) = selected() {
                div { class: "player",
                    h3 { "{station.name}" }
                    audio {
                        src: "{station.stream_url}",
                        controls: true,
                        autoplay: true,
                    }
                    if station.hls {
                        p { class: "station-meta",
                            "This station is marked HLS. If playback fails, we'll add hls.js interop next."
                        }
                    }
                }
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
async fn fetch_stations(base_url: String) -> Result<StationsResponse, String> {
    let url = format!("{}/stations?limit=40", base_url.trim_end_matches('/'));
    let response = gloo_net::http::Request::get(&url)
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    if !response.ok() {
        return Err(format!("http {}", response.status()));
    }
    response
        .json::<StationsResponse>()
        .await
        .map_err(|err| format!("decode failed: {err}"))
}

#[cfg(not(target_arch = "wasm32"))]
async fn fetch_stations(_base_url: String) -> Result<StationsResponse, String> {
    Err("native fetch not implemented yet".to_string())
}
