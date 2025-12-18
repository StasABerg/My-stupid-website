use dioxus::prelude::*;
use gloo_storage::{LocalStorage, Storage};
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
    pub requested_limit: Option<RequestedLimit>,
    pub offset: i64,
    #[serde(rename = "cacheSource")]
    pub cache_source: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum RequestedLimit {
    Number(i64),
    Text(String),
}

#[component]
pub fn RadioPage() -> Element {
    let config = use_context::<RuntimeConfig>();
    let base_url = config.radio_api_base_url.clone();
    let mut selected = use_signal::<Option<RadioStation>>(|| None);
    let mut search = use_signal(String::new);
    let mut country = use_signal(String::new);
    let mut genre = use_signal(String::new);
    let mut favorites = use_signal(load_favorites);

    let stations = use_resource(move || {
        let base_url = base_url.clone();
        async move {
            fetch_stations(
                base_url,
                Filters {
                    search: search.read().clone(),
                    country: country.read().clone(),
                    genre: genre.read().clone(),
                },
            )
            .await
        }
    });

    rsx! {
        div { class: "radio",
            h2 { "Broadcast Control" }
            div { class: "filters",
                label { "search" }
                input {
                    value: "{search}",
                    placeholder: "station name or tag",
                    oninput: move |event| search.set(event.value()),
                }
                label { "country" }
                input {
                    value: "{country}",
                    placeholder: "country",
                    oninput: move |event| country.set(event.value()),
                }
                label { "genre" }
                input {
                    value: "{genre}",
                    placeholder: "genre",
                    oninput: move |event| genre.set(event.value()),
                }
            }
            match stations() {
                None => rsx! { p { "Loading stations..." } },
                Some(Err(message)) => rsx! { p { "Failed to load: {message}" } },
                Some(Ok(response)) => rsx! {
                    p { "Stations: {response.meta.matches}" }
                    ul { class: "station-list",
                        {
                            let favs = favorites();
                            response.items.into_iter().map(move |station| {
                                let station_id = station.id.clone();
                                let station_for_play = station.clone();
                                let is_fav = is_favorite(&favs, &station_id);
                                rsx! {
                                    li { class: "station",
                                        button {
                                            class: "station-play",
                                            onclick: move |_| selected.set(Some(station_for_play.clone())),
                                            "Play"
                                        }
                                        button {
                                            class: if is_fav {
                                                "station-fav active"
                                            } else {
                                                "station-fav"
                                            },
                                            onclick: move |_| {
                                                let updated = toggle_favorite(favorites(), &station_id);
                                                favorites.set(updated.clone());
                                                save_favorites(&updated);
                                            },
                                            if is_fav { "♥" } else { "♡" }
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
                            })
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
async fn fetch_stations(base_url: String, filters: Filters) -> Result<StationsResponse, String> {
    let url = build_url(&base_url, &filters);
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
async fn fetch_stations(_base_url: String, _filters: Filters) -> Result<StationsResponse, String> {
    Err("native fetch not implemented yet".to_string())
}

#[derive(Clone, Debug, PartialEq)]
struct Filters {
    search: String,
    country: String,
    genre: String,
}

#[cfg(target_arch = "wasm32")]
fn build_url(base_url: &str, filters: &Filters) -> String {
    let mut params = Vec::new();
    params.push("limit=40".to_string());
    if !filters.search.trim().is_empty() {
        params.push(format!("search={}", urlencoding::encode(filters.search.trim())));
    }
    if !filters.country.trim().is_empty() {
        params.push(format!("country={}", urlencoding::encode(filters.country.trim())));
    }
    if !filters.genre.trim().is_empty() {
        params.push(format!("genre={}", urlencoding::encode(filters.genre.trim())));
    }
    format!(
        "{}/stations?{}",
        base_url.trim_end_matches('/'),
        params.join("&")
    )
}

fn load_favorites() -> Vec<String> {
    LocalStorage::get("radio.favorites").unwrap_or_default()
}

fn save_favorites(favorites: &[String]) {
    let _ = LocalStorage::set("radio.favorites", favorites);
}

fn is_favorite(favorites: &[String], station_id: &str) -> bool {
    favorites.iter().any(|id| id == station_id)
}

fn toggle_favorite(mut favorites: Vec<String>, station_id: &str) -> Vec<String> {
    if let Some(index) = favorites.iter().position(|id| id == station_id) {
        favorites.remove(index);
    } else {
        favorites.push(station_id.to_string());
    }
    favorites
}
