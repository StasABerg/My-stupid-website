use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dioxus::prelude::*;
#[cfg(target_arch = "wasm32")]
use dioxus::prelude::document;
use gloo_storage::{LocalStorage, Storage};
use serde::{Deserialize, Serialize};

use crate::config::RuntimeConfig;
use crate::gateway_session::ensure_gateway_session;

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct ShareableStation {
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct SharedStationPayload {
    version: i32,
    station: ShareableStation,
}

const SHARE_QUERY_PARAM: &str = "share";
const SHARE_PAYLOAD_VERSION: i32 = 1;
const SECRET_BROADCAST_LABEL: &str = "Secret Broadcast";

const MIDNIGHT_RICKROLL_ID: &str = "midnight-rickroll";
const MIDNIGHT_LOFI_ID: &str = "midnight-lofi";

const MIDNIGHT_PRESETS: [SecretBroadcast; 2] = [
    SecretBroadcast {
        id: MIDNIGHT_RICKROLL_ID,
        name: "????",
        stream_url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&loop=1&playlist=dQw4w9WgXcQ&controls=0&modestbranding=1&rel=0&mute=0",
        watch_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        label: "80s Eternal Rick Broadcast",
    },
    SecretBroadcast {
        id: MIDNIGHT_LOFI_ID,
        name: "????",
        stream_url: "https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=1&controls=0&modestbranding=1&rel=0&enablejsapi=1",
        watch_url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
        label: "Lofi Girl Control Tower",
    },
];

#[derive(Clone, Copy, Debug, PartialEq)]
struct SecretBroadcast {
    id: &'static str,
    name: &'static str,
    stream_url: &'static str,
    watch_url: &'static str,
    label: &'static str,
}

#[component]
pub fn RadioPage() -> Element {
    let config = use_context::<RuntimeConfig>();
    let base_url = config.radio_api_base_url.clone();
    let mut selected = use_signal::<Option<RadioStation>>(|| None);
    let mut resolved_stream_url = use_signal::<Option<String>>(|| None);
    let mut share_url = use_signal(String::new);
    let mut share_loaded = use_signal(|| false);
    let mut search = use_signal(String::new);
    let mut country = use_signal(String::new);
    let mut genre = use_signal(String::new);
    let mut favorites = use_signal(load_favorites);

    let stations = use_resource({
        let base_url = base_url.clone();
        move || {
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
        }
    });

    use_effect(move || {
        if share_loaded() {
            return;
        }
        if let Some(station) = read_shared_station() {
            selected.set(Some(station));
        }
        share_loaded.set(true);
    });

    use_effect({
        let base_url = base_url.clone();
        move || {
            if let Some(station) = selected() {
                let base_url = base_url.clone();
                let station = station.clone();
                spawn(async move {
                    let resolved = resolve_stream_url(&base_url, &station).await;
                    resolved_stream_url.set(Some(resolved));
                });
            } else {
                resolved_stream_url.set(None);
            }
        }
    });

    use_effect(move || {
        #[cfg(target_arch = "wasm32")]
        if let Some(url) = resolved_stream_url() {
            let station = selected();
            let should_use_hls = station
                .as_ref()
                .map(|value| is_hls_station(value, &url))
                .unwrap_or(false);
            if should_use_hls {
                spawn(async move {
                    let _ = attach_hls(&url, "radio-audio").await;
                });
            } else {
                spawn(async {
                    let _ = destroy_hls("radio-audio").await;
                });
            }
        } else {
            #[cfg(target_arch = "wasm32")]
            spawn(async {
                let _ = destroy_hls("radio-audio").await;
            });
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
                                let mut resolved_stream_url = resolved_stream_url;
                                rsx! {
                                    li { class: "station",
                                        button {
                                            class: "station-play",
                                            onclick: move |_| {
                                                if !station_for_play.hls {
                                                    resolved_stream_url
                                                        .set(Some(station_for_play.stream_url.clone()));
                                                }
                                                selected.set(Some(station_for_play.clone()));
                                            },
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
            if is_midnight_hour() {
                div { class: "midnight",
                    h3 { "Midnight Presets" }
                    p { class: "station-meta", "Tune into a secret broadcast." }
                    div { class: "midnight-buttons",
                        {
                            MIDNIGHT_PRESETS.into_iter().map(|preset| {
                                let label = preset.label;
                                let station = secret_station(preset);
                                rsx! {
                                    button {
                                        class: "midnight-button",
                                        onclick: move |_| selected.set(Some(station.clone())),
                                        "{label}"
                                    }
                                }
                            })
                        }
                    }
                }
            }
            {
                if let Some(station) = selected() {
                    let stream_url = resolved_stream_url()
                        .unwrap_or_else(|| station.stream_url.clone());
                    rsx! {
                        div { class: "player",
                            h3 { "{station.name}" }
                            audio {
                                id: "radio-audio",
                                src: "{stream_url}",
                                controls: true,
                                autoplay: true,
                            }
                            if station.hls {
                                p { class: "station-meta",
                                    "This station is marked HLS. If playback fails, we'll add hls.js interop next."
                                }
                            }
                        }
                        if let Some(secret) = match_secret(&station.id) {
                            div { class: "secret",
                                h3 { "{SECRET_BROADCAST_LABEL}" }
                                iframe {
                                    class: "secret-frame",
                                    src: "{secret.stream_url}",
                                    allow: "autoplay; encrypted-media",
                                    referrerpolicy: "origin",
                                }
                                a { href: "{secret.watch_url}", target: "_blank", "Open on YouTube" }
                            }
                        }
                        div { class: "share",
                            button {
                                class: "share-button",
                                onclick: move |_| {
                                    let url = build_share_url(&station);
                                    share_url.set(url);
                                },
                                "Share"
                            }
                            if !share_url().is_empty() {
                                input {
                                    class: "share-input",
                                    value: "{share_url}",
                                    readonly: true,
                                }
                            }
                        }
                    }
                } else {
                    rsx! {}
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

async fn resolve_stream_url(base_url: &str, station: &RadioStation) -> String {
    if !station.hls {
        return station.stream_url.clone();
    }

    let stream_url = format!(
        "{}/stations/{}/stream",
        base_url.trim_end_matches('/'),
        urlencoding::encode(&station.id)
    );

    let _ = ensure_gateway_session().await;

    stream_url
}

#[cfg(target_arch = "wasm32")]
fn is_hls_station(station: &RadioStation, resolved_url: &str) -> bool {
    if station.hls {
        return true;
    }
    let lower = resolved_url.to_lowercase();
    lower.contains("m3u8") || lower.ends_with(".m3u8") || lower.contains("format=hls")
}

#[cfg(target_arch = "wasm32")]
async fn attach_hls(stream_url: &str, element_id: &str) -> Result<(), String> {
    let url = serde_json::to_string(stream_url).map_err(|err| err.to_string())?;
    let id = serde_json::to_string(element_id).map_err(|err| err.to_string())?;
    let script = format!(
        r#"
        (function() {{
            const url = {url};
            const elementId = {id};
            const audio = document.getElementById(elementId);
            if (!audio) return;
            if (window.__gitgud_hls) {{
                window.__gitgud_hls.destroy();
                window.__gitgud_hls = null;
            }}
            if (!window.Hls) {{
                audio.src = url;
                audio.play().catch(() => {{}});
                return;
            }}
            if (window.Hls.isSupported()) {{
                const hls = new window.Hls({{
                    enableWorker: true,
                    xhrSetup: function(xhr) {{
                        xhr.withCredentials = true;
                    }},
                    fetchSetup: function(context, init) {{
                        init.credentials = "include";
                        return init;
                    }},
                }});
                window.__gitgud_hls = hls;
                hls.loadSource(url);
                hls.attachMedia(audio);
                audio.play().catch(() => {{}});
                return;
            }}
            audio.src = url;
            audio.play().catch(() => {{}});
        }})()
        "#
    );
    document::eval(&script)
        .await
        .map_err(|err| format!("eval failed: {err:?}"))?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
async fn destroy_hls(element_id: &str) -> Result<(), String> {
    let id = serde_json::to_string(element_id).map_err(|err| err.to_string())?;
    let script = format!(
        r#"
        (function() {{
            const elementId = {id};
            const audio = document.getElementById(elementId);
            if (window.__gitgud_hls) {{
                window.__gitgud_hls.destroy();
                window.__gitgud_hls = null;
            }}
            if (audio) {{
                audio.pause();
                audio.removeAttribute("src");
                audio.load();
            }}
        }})()
        "#
    );
    document::eval(&script)
        .await
        .map_err(|err| format!("eval failed: {err:?}"))?;
    Ok(())
}

fn secret_station(secret: SecretBroadcast) -> RadioStation {
    RadioStation {
        id: secret.id.to_string(),
        name: secret.name.to_string(),
        stream_url: secret.stream_url.to_string(),
        homepage: None,
        favicon: None,
        country: Some(SECRET_BROADCAST_LABEL.to_string()),
        country_code: None,
        state: None,
        languages: vec!["English".to_string()],
        tags: vec!["mystery".to_string(), "midnight".to_string()],
        bitrate: Some(128),
        codec: Some("MP3".to_string()),
        hls: false,
        is_online: true,
        click_count: 0,
    }
}

fn match_secret(station_id: &str) -> Option<SecretBroadcast> {
    MIDNIGHT_PRESETS
        .iter()
        .find(|preset| preset.id == station_id)
        .copied()
}

#[cfg(target_arch = "wasm32")]
fn is_midnight_hour() -> bool {
    let date = js_sys::Date::new_0();
    date.get_hours() == 0
}

#[cfg(not(target_arch = "wasm32"))]
fn is_midnight_hour() -> bool {
    false
}

fn build_share_url(station: &RadioStation) -> String {
    let payload = SharedStationPayload {
        version: SHARE_PAYLOAD_VERSION,
        station: ShareableStation {
            id: station.id.clone(),
            name: station.name.clone(),
            stream_url: station.stream_url.clone(),
            homepage: station.homepage.clone(),
            favicon: station.favicon.clone(),
            country: station.country.clone(),
            country_code: station.country_code.clone(),
            state: station.state.clone(),
            languages: station.languages.clone(),
            tags: station.tags.clone(),
            bitrate: station.bitrate,
            codec: station.codec.clone(),
            hls: station.hls,
            is_online: station.is_online,
            click_count: station.click_count,
        },
    };

    let encoded = serde_json::to_vec(&payload)
        .ok()
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
        .unwrap_or_default();
    let origin = current_origin().unwrap_or_else(|| "https://gitgud.zip".to_string());
    format!("{origin}/radio?{SHARE_QUERY_PARAM}={encoded}")
}

fn read_shared_station() -> Option<RadioStation> {
    let encoded = read_share_param()?;
    let decoded = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let payload: SharedStationPayload = serde_json::from_slice(&decoded).ok()?;
    if payload.version != SHARE_PAYLOAD_VERSION {
        return None;
    }
    Some(RadioStation {
        id: payload.station.id,
        name: payload.station.name,
        stream_url: payload.station.stream_url,
        homepage: payload.station.homepage,
        favicon: payload.station.favicon,
        country: payload.station.country,
        country_code: payload.station.country_code,
        state: payload.station.state,
        languages: payload.station.languages,
        tags: payload.station.tags,
        bitrate: payload.station.bitrate,
        codec: payload.station.codec,
        hls: payload.station.hls,
        is_online: payload.station.is_online,
        click_count: payload.station.click_count,
    })
}

#[cfg(target_arch = "wasm32")]
fn read_share_param() -> Option<String> {
    let window = web_sys::window()?;
    let search = window.location().search().ok()?;
    let params = web_sys::UrlSearchParams::new_with_str(&search).ok()?;
    params.get(SHARE_QUERY_PARAM)
}

#[cfg(not(target_arch = "wasm32"))]
fn read_share_param() -> Option<String> {
    None
}

#[cfg(target_arch = "wasm32")]
fn current_origin() -> Option<String> {
    let window = web_sys::window()?;
    window.location().origin().ok()
}

#[cfg(not(target_arch = "wasm32"))]
fn current_origin() -> Option<String> {
    None
}
