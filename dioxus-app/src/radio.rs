use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dioxus::prelude::*;
#[cfg(target_arch = "wasm32")]
use dioxus::prelude::document;
#[cfg(target_arch = "wasm32")]
use dioxus::web::WebEventExt;
use dioxus_router::Link;
use gloo_storage::{LocalStorage, Storage};
#[cfg(target_arch = "wasm32")]
use gloo_timers::future::TimeoutFuture;
use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;
#[cfg(target_arch = "wasm32")]
use web_sys::{AbortController, Request, RequestCredentials, RequestInit, Response};

use crate::config::RuntimeConfig;
use crate::gateway_session::{authorized_get_json, ensure_gateway_session};
use crate::routes::Route;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};

fn log_debug(message: &str) {
    tracing::debug!("{message}");
}

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
    pub max_limit: Option<i64>,
    #[serde(rename = "requestedLimit")]
    pub requested_limit: Option<RequestedLimit>,
    pub offset: i64,
    #[serde(rename = "cacheSource")]
    pub cache_source: Option<String>,
    #[serde(rename = "origin")]
    pub origin: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub countries: Option<Vec<String>>,
    #[serde(default)]
    pub genres: Option<Vec<String>>,
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
const MAX_PRESET_SLOTS: usize = 6;
const PAGE_SIZE: i64 = 40;
const PRESET_COLORS: [&str; 5] = [
    "text-terminal-green",
    "text-terminal-cyan",
    "text-terminal-magenta",
    "text-terminal-yellow",
    "text-terminal-red",
];

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

#[cfg(target_arch = "wasm32")]
struct IntervalHandle {
    id: i32,
    _closure: Rc<wasm_bindgen::closure::Closure<dyn FnMut()>>,
}

#[cfg(target_arch = "wasm32")]
struct TimeoutHandle {
    id: i32,
    _closure: Rc<wasm_bindgen::closure::Closure<dyn FnMut()>>,
}

#[cfg(target_arch = "wasm32")]
struct ObserverHandle {
    observer: web_sys::IntersectionObserver,
    target: web_sys::Element,
    _closure: Rc<wasm_bindgen::closure::Closure<dyn FnMut(js_sys::Array, web_sys::IntersectionObserver)>>,
}

#[component]
pub fn RadioPage() -> Element {
    let config = use_context::<RuntimeConfig>();
    let base_url = config.radio_api_base_url.clone();
    let mut mounted = use_signal(|| false);
    let mut selected = use_signal::<Option<RadioStation>>(|| None);
    let mut resolved_stream_url = use_signal::<Option<String>>(|| None);
    let mut share_loaded = use_signal(|| false);
    let mut search = use_signal(String::new);
    let mut country = use_signal(String::new);
    let mut genre = use_signal(String::new);
    let mut debounced_search = use_signal(String::new);
    #[cfg(target_arch = "wasm32")]
    let mut debounce_handle = use_signal(|| None::<TimeoutHandle>);
    #[cfg(not(target_arch = "wasm32"))]
    let _debounce_handle = ();
    let mut selected_index = use_signal(|| 0usize);
    let mut volume = use_signal(|| 0.65f64);
    let mut share_dialog_open = use_signal(|| false);
    let mut share_toast = use_signal(String::new);
    let midnight_active = use_signal(is_midnight_hour);
    let mystery_station = use_signal(|| secret_station(random_midnight_preset()));
    #[cfg(target_arch = "wasm32")]
    let mut midnight_timer = use_signal(|| None::<IntervalHandle>);
    #[cfg(not(target_arch = "wasm32"))]
    let _midnight_timer = ();
    let mut favorites = use_signal(load_favorites);
    let mut stations_state = use_signal(Vec::<RadioStation>::new);
    let mut first_meta = use_signal(|| None::<StationsMeta>);
    let mut last_meta = use_signal(|| None::<StationsMeta>);
    let mut fetch_error = use_signal(|| None::<String>);
    let mut is_fetching = use_signal(|| false);
    let mut is_fetching_next = use_signal(|| false);
    let mut has_more = use_signal(|| false);
    let mut last_filters = use_signal(|| None::<Filters>);
    let mut last_stream_id = use_signal(|| None::<String>);
    #[cfg(target_arch = "wasm32")]
    let mut last_hls_key = use_signal(|| None::<String>);
    #[cfg(not(target_arch = "wasm32"))]
    let _last_hls_key = ();
    #[cfg(target_arch = "wasm32")]
    let mut load_more_ref = use_signal(|| None::<web_sys::Element>);
    #[cfg(target_arch = "wasm32")]
    let load_more_trigger = use_signal(|| 0u64);
    #[cfg(target_arch = "wasm32")]
    let mut last_load_trigger = use_signal(|| 0u64);
    #[cfg(target_arch = "wasm32")]
    let mut observer_handle = use_signal(|| None::<ObserverHandle>);
    #[cfg(not(target_arch = "wasm32"))]
    let _load_more_ref = ();
    #[cfg(not(target_arch = "wasm32"))]
    let _load_more_trigger = ();
    #[cfg(not(target_arch = "wasm32"))]
    let _last_load_trigger = ();
    #[cfg(not(target_arch = "wasm32"))]
    let _observer_handle = ();

    #[cfg(target_arch = "wasm32")]
    use_effect(move || {
        use wasm_bindgen::closure::Closure;
        use wasm_bindgen::JsCast;

        let next_search = search();
        let trimmed = next_search.trim().to_string();
        if let Some(handle) = debounce_handle.read().as_ref() {
            if let Some(window) = web_sys::window() {
                window.clear_timeout_with_handle(handle.id);
            }
        }
        if trimmed.is_empty() {
            debounced_search.set(String::new());
            debounce_handle.set(None);
            return;
        }
        let Some(window) = web_sys::window() else {
            return;
        };
        let mut debounced = debounced_search;
        let mut debounce_handle = debounce_handle;
        let closure = Rc::new(Closure::wrap(Box::new(move || {
            debounced.set(trimmed.clone());
            debounce_handle.set(None);
        }) as Box<dyn FnMut()>));
        if let Ok(id) = window.set_timeout_with_callback_and_timeout_and_arguments_0(
            closure.as_ref().as_ref().unchecked_ref(),
            300,
        ) {
            debounce_handle.set(Some(TimeoutHandle { id, _closure: closure }));
        }
    });

    #[cfg(not(target_arch = "wasm32"))]
    use_effect(move || {
        debounced_search.set(search());
    });

    use_effect({
        let base_url = base_url.clone();
        move || {
            if !mounted() {
                log_debug("radio: mount");
                mounted.set(true);
            }
            let filters = Filters {
                search: debounced_search(),
                country: country(),
                genre: genre(),
            };
            if last_filters().as_ref() == Some(&filters) {
                return;
            }
            last_filters.set(Some(filters.clone()));
            log_debug("radio: filter change, fetching first page");
            selected_index.set(0);
            selected.set(None);
            stations_state.set(Vec::new());
            first_meta.set(None);
            last_meta.set(None);
            fetch_error.set(None);
            is_fetching.set(true);
            is_fetching_next.set(false);
            has_more.set(false);
            let base_url = base_url.clone();
            spawn(async move {
                match fetch_station_page(&base_url, &filters, 0, PAGE_SIZE).await {
                    Ok(response) => {
                        log_debug("radio: first page loaded");
                        stations_state.set(response.items.clone());
                        let meta = response.meta.clone();
                        first_meta.set(Some(meta.clone()));
                        last_meta.set(Some(meta.clone()));
                        has_more.set(meta.has_more);
                        fetch_error.set(None);
                    }
                    Err(message) => {
                        log_debug("radio: first page error");
                        fetch_error.set(Some(message));
                    }
                }
                is_fetching.set(false);
            });
        }
    });

    use_effect(move || {
        if share_loaded() {
            return;
        }
        if let Some(station) = read_shared_station() {
            selected.set(Some(station));
            share_dialog_open.set(true);
        }
        share_loaded.set(true);
    });

    #[cfg(target_arch = "wasm32")]
    use_effect(move || {
        use wasm_bindgen::closure::Closure;
        use wasm_bindgen::JsCast;

        if midnight_timer.read().is_some() {
            return;
        }
        let mut midnight_active = midnight_active;
        let mut mystery_station = mystery_station;
        let Some(window) = web_sys::window() else {
            return;
        };
        let closure = Rc::new(Closure::wrap(Box::new(move || {
            let active = is_midnight_hour();
            if active && !midnight_active() {
                mystery_station.set(secret_station(random_midnight_preset()));
            }
            midnight_active.set(active);
        }) as Box<dyn FnMut()>));
        if let Ok(id) = window.set_interval_with_callback_and_timeout_and_arguments_0(
            closure.as_ref().as_ref().unchecked_ref(),
            60000,
        ) {
            midnight_timer.set(Some(IntervalHandle { id, _closure: closure }));
        }
    });

    use_effect({
        let base_url = base_url.clone();
        move || {
            let selection = selected();
            let selection_id = selection.as_ref().map(|station| station.id.clone());
            if last_stream_id() == selection_id {
                return;
            }
            last_stream_id.set(selection_id);
            if let Some(station) = selection {
                log_debug("radio: resolve stream url");
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

    #[cfg(target_arch = "wasm32")]
    {
        let midnight_timer = midnight_timer;
        use_drop(move || {
            if let Some(handle) = midnight_timer.read().as_ref() {
                if let Some(window) = web_sys::window() {
                    window.clear_interval_with_handle(handle.id);
                }
            }
        });
    }

    #[cfg(target_arch = "wasm32")]
    {
        let debounce_handle = debounce_handle;
        use_drop(move || {
            if let Some(handle) = debounce_handle.read().as_ref() {
                if let Some(window) = web_sys::window() {
                    window.clear_timeout_with_handle(handle.id);
                }
            }
        });
    }

    #[cfg(target_arch = "wasm32")]
    use_effect(move || {
        use wasm_bindgen::closure::Closure;
        use wasm_bindgen::JsCast;

        let Some(target) = load_more_ref.read().as_ref().cloned() else {
            return;
        };
        if observer_handle.read().is_some() {
            return;
        }
        log_debug("radio: setting up intersection observer");
        let mut load_more_trigger = load_more_trigger;
        let closure = Rc::new(Closure::wrap(Box::new(move |entries: js_sys::Array, _observer: web_sys::IntersectionObserver| {
            let entry = entries.get(0);
            if entry.is_null() || entry.is_undefined() {
                return;
            }
            let entry: web_sys::IntersectionObserverEntry = entry.unchecked_into();
            if entry.is_intersecting() {
                log_debug("radio: intersection observer trigger");
                load_more_trigger.set(load_more_trigger() + 1);
            }
        }) as Box<dyn FnMut(js_sys::Array, web_sys::IntersectionObserver)>));
        let Ok(observer) = web_sys::IntersectionObserver::new(closure.as_ref().as_ref().unchecked_ref()) else {
            return;
        };
        observer.observe(&target);
        observer_handle.set(Some(ObserverHandle {
            observer,
            target,
            _closure: closure,
        }));
    });

    #[cfg(target_arch = "wasm32")]
    {
        let observer_handle = observer_handle;
        use_drop(move || {
            if let Some(handle) = observer_handle.read().as_ref() {
                handle.observer.unobserve(&handle.target);
            }
        });
    }

    #[cfg(target_arch = "wasm32")]
    use_effect({
        let base_url = base_url.clone();
        move || {
            let trigger = load_more_trigger();
            if trigger == last_load_trigger() {
                return;
            }
            last_load_trigger.set(trigger);
            if !has_more() || is_fetching() || is_fetching_next() {
                return;
            }
            log_debug("radio: loading next page");
            let offset = last_meta()
                .as_ref()
                .map(|meta| meta.offset + meta.limit)
                .unwrap_or(stations_state().len() as i64);
            let filters = Filters {
                search: debounced_search(),
                country: country(),
                genre: genre(),
            };
            let base_url = base_url.clone();
            is_fetching_next.set(true);
            spawn(async move {
                match fetch_station_page(&base_url, &filters, offset, PAGE_SIZE).await {
                    Ok(response) => {
                        stations_state.with_mut(|items| items.extend(response.items.clone()));
                        last_meta.set(Some(response.meta.clone()));
                        has_more.set(response.meta.has_more);
                        fetch_error.set(None);
                    }
                    Err(message) => {
                        fetch_error.set(Some(message));
                    }
                }
                is_fetching_next.set(false);
            });
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
            let key = format!("{}::{}", should_use_hls, url);
            if last_hls_key() == Some(key.clone()) {
                return;
            }
            last_hls_key.set(Some(key));
            if should_use_hls {
                log_debug("radio: attach hls");
                spawn(async move {
                    let _ = attach_hls(&url, "radio-audio").await;
                });
            } else {
                log_debug("radio: destroy hls (direct stream)");
                spawn(async {
                    let _ = destroy_hls("radio-audio", false).await;
                });
            }
        } else {
            #[cfg(target_arch = "wasm32")]
            spawn(async {
                log_debug("radio: destroy hls (no selection)");
                let _ = destroy_hls("radio-audio", true).await;
            });
            #[cfg(target_arch = "wasm32")]
            last_hls_key.set(None);
        }
    });

    let station_items = stations_state();
    let response_error = fetch_error();
    let available_filters = use_memo(move || {
        resolve_filter_options_from(first_meta().as_ref(), &stations_state())
    });
    let (available_countries, available_genres) = available_filters();
    let selected_station = selected();
    let bounded_index = selected_index()
        .min(station_items.len().saturating_sub(1));
    let active_station = selected_station
        .clone()
        .or_else(|| station_items.get(bounded_index).cloned());
    let frequency_label = if station_items.is_empty() || selected_station.is_some() {
        "Preset".to_string()
    } else {
        format!("{} FM", format_frequency(bounded_index))
    };

    use_effect(move || {
        let items = stations_state();
        if items.is_empty() {
            return;
        }
        if selected().is_none() {
            let idx = selected_index().min(items.len().saturating_sub(1));
            selected.set(Some(items[idx].clone()));
        }
    });

    use_effect(move || {
        #[cfg(target_arch = "wasm32")]
        {
            let volume = volume();
            if let Some(document) = web_sys::window().and_then(|window| window.document()) {
                if let Some(element) = document.get_element_by_id("radio-audio") {
                    if let Ok(audio) = element.dyn_into::<web_sys::HtmlElement>() {
                        let _ = js_sys::Reflect::set(
                            &audio,
                            &JsValue::from_str("volume"),
                            &JsValue::from_f64(volume),
                        );
                    }
                }
            }
        }
    });

    let active_station_id = active_station.as_ref().map(|station| station.id.clone());
    let share_link = active_station
        .as_ref()
        .map(build_share_url)
        .unwrap_or_default();
    let share_link_available = !share_link.is_empty();
    let station_totals = use_memo(move || {
        let station_items = stations_state();
        let station_count = first_meta()
            .as_ref()
            .map(|meta| meta.matches)
            .unwrap_or(station_items.len() as i64);
        let next_offset = last_meta()
            .as_ref()
            .map(|meta| meta.offset + meta.limit)
            .unwrap_or(station_items.len() as i64);
        (station_count, next_offset)
    });
    let (station_count, next_offset) = station_totals();
    let station_list_command = if next_offset > 0 {
        format!("radio stations --limit {PAGE_SIZE} --offset {next_offset}")
    } else {
        format!("radio stations --limit {PAGE_SIZE}")
    };
    let directory_status = if station_items.is_empty() {
        if is_fetching() {
            "Scanning…"
        } else {
            "No results"
        }
    } else if is_fetching_next() {
        "Loading more stations…"
    } else if has_more() {
        "Scroll to load more stations"
    } else {
        "All stations loaded"
    };

    rsx! {
        div { class: "terminal-screen radio-page",
            TerminalWindow { aria_label: Some("Gitgud radio control center".to_string()),
                TerminalHeader { display_cwd: "~/radio".to_string(), label: None }
                div { class: "terminal-body terminal-stack radio-body",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/radio".to_string()), command: Some("radio --help".to_string()), children: rsx! {} }
                    div { class: "radio-intro terminal-indent",
                        p { "Use the controls below to search and tune into stations from the Gitgud directory." }
                        p { "Adjust filters, choose presets, or scroll the list to lock onto a new frequency. Audio starts automatically when a station is active." }
                    }
                    div { class: "radio-grid",
                        div { class: "radio-column",
                            TerminalPrompt { path: Some("~/radio".to_string()), command: Some("radio status".to_string()), children: rsx! {} }
                            div { class: "radio-panel",
                                if let Some(station) = active_station.clone() {
                                    div { class: "radio-station-header",
                                        div {
                                            h2 { class: "radio-title text-terminal-yellow", "{station.name}" }
                                            span { class: "radio-frequency text-terminal-green", "{frequency_label}" }
                                        }
                                        button {
                                            r#type: "button",
                                            class: if share_link_available { "radio-share-button" } else { "radio-share-button disabled" },
                                            disabled: !share_link_available,
                                            onclick: move |_| {
                                                if share_link_available {
                                                    share_toast.set(String::new());
                                                    share_dialog_open.set(true);
                                                }
                                            },
                                            "Share"
                                        }
                                    }
                                    dl { class: "radio-stats",
                                        div {
                                            dt { "Origin" }
                                            dd {
                                                "{station.country.clone().unwrap_or_else(|| \"Unknown\".to_string())}"
                                                if let Some(state) = station.state.clone() {
                                                    " · {state}"
                                                }
                                            }
                                        }
                                        div {
                                            dt { "Codec" }
                                            dd { "{station.codec.clone().unwrap_or_else(|| \"Auto\".to_string())}" }
                                        }
                                        div {
                                            dt { "Bitrate" }
                                            dd {
                                                if let Some(bitrate) = station.bitrate {
                                                    "{bitrate} kbps"
                                                } else {
                                                    "Auto"
                                                }
                                            }
                                        }
                                        div {
                                            dt { "Status" }
                                            dd { if station.is_online { "Online" } else { "Offline" } }
                                        }
                                    }
                                    div { class: "radio-tags",
                                        span { "Tags: " }
                                        if station.tags.is_empty() {
                                            "None"
                                        } else {
                                            "{station.tags.iter().take(6).cloned().collect::<Vec<_>>().join(\", \")}"
                                        }
                                    }
                                } else {
                                    p { class: "terminal-muted", "No station selected." }
                                }
                            }
                            if let Some(secret) = active_station
                                .as_ref()
                                .and_then(|station| match_secret(&station.id)) {
                                div { class: "radio-panel secret",
                                    p { class: "text-terminal-cyan radio-section-title", "{SECRET_BROADCAST_LABEL}" }
                                    div { class: "radio-embed",
                                        iframe {
                                            class: "secret-frame",
                                            src: "{secret.stream_url}",
                                            allow: "autoplay; encrypted-media; picture-in-picture",
                                            referrerpolicy: "strict-origin-when-cross-origin",
                                        }
                                    }
                                    p { class: "radio-muted",
                                        "{secret.label} · "
                                        a { href: "{secret.watch_url}", target: "_blank", rel: "noopener noreferrer", class: "terminal-link text-terminal-yellow", "watch on YouTube" }
                                    }
                                }
                            }
                            TerminalPrompt { path: Some("~/radio".to_string()), command: Some("radio presets --list".to_string()), children: rsx! {} }
                            div { class: "radio-panel",
                                div { class: "radio-section-header",
                                    span { class: "text-terminal-cyan", "Preset Slots" }
                                    span { class: "radio-muted", "{favorites().len()}/{MAX_PRESET_SLOTS}" }
                                }
                                div { class: "radio-presets",
                                    {
                                        let favs = favorites();
                                        let mut slots = Vec::new();
                                        for idx in 0..MAX_PRESET_SLOTS {
                                            slots.push(favs.get(idx).cloned());
                                        }
                                        slots.into_iter().enumerate().map(|(index, station_id)| {
                                            let color = PRESET_COLORS[index % PRESET_COLORS.len()];
                                            if let Some(station_id) = station_id {
                                                let station = station_items
                                                    .iter()
                                                    .find(|item| item.id == station_id)
                                                    .cloned();
                                                if let Some(station) = station {
                                                    let station_id = station.id.clone();
                                                    let is_active = active_station
                                                        .as_ref()
                                                        .map(|value| value.id == station_id)
                                                        .unwrap_or(false);
                                                    rsx! {
                                                        div { key: "preset-{index}", class: "radio-preset-slot",
                                                            button {
                                                                class: if is_active { format!("radio-preset-button active {color}") } else { format!("radio-preset-button {color}") },
                                                                onclick: move |_| {
                                                                    selected.set(Some(station.clone()));
                                                                },
                                                                span { class: "text-terminal-cyan", "[{index + 1}]" }
                                                                span { class: "radio-preset-name", "{station.name}" }
                                                            }
                                                            button {
                                                                class: "radio-fav-button active",
                                                                onclick: move |_| {
                                                                    let updated = toggle_favorite(favorites(), &station_id);
                                                                    favorites.set(updated.clone());
                                                                    save_favorites(&updated);
                                                                },
                                                                "♥"
                                                            }
                                                        }
                                                    }
                                                } else {
                                                    rsx! {
                                                        div { key: "preset-empty-{index}", class: "radio-preset-empty",
                                                            span { class: "text-terminal-cyan", "[{index + 1}]" }
                                                            span { class: "radio-muted", "Empty slot" }
                                                        }
                                                    }
                                                }
                                            } else {
                                                rsx! {
                                                    div { key: "preset-empty-{index}", class: "radio-preset-empty",
                                                        span { class: "text-terminal-cyan", "[{index + 1}]" }
                                                        span { class: "radio-muted", "Empty slot" }
                                                    }
                                                }
                                            }
                                        })
                                    }
                                }
                                if favorites().is_empty() {
                                    p { class: "radio-muted", "Use the heart icon in the directory to pin stations here." }
                                }
                            }
                            if midnight_active() {
                                TerminalPrompt { path: Some("~/radio".to_string()), command: Some("radio midnight --tune".to_string()), children: rsx! {} }
                                div { class: "radio-panel midnight",
                                    p { class: "text-terminal-cyan radio-section-title", "Secret Broadcast" }
                                    p { class: "radio-muted", "A mysterious preset is available until the clock strikes 01:00." }
                                    button {
                                        class: "radio-midnight-button",
                                        onclick: move |_| {
                                            selected.set(Some(mystery_station()));
                                        },
                                        "Summon Broadcast"
                                    }
                                }
                            }
                        }
                        div { class: "radio-column",
                            TerminalPrompt { path: Some("~/radio".to_string()), command: Some("radio filters".to_string()), children: rsx! {} }
                            div { class: "radio-panel",
                                if let Some(message) = response_error.clone() {
                                    p { class: "terminal-error", "Failed to load stations: {message}" }
                                }
                                fieldset { class: "radio-fieldset",
                                    legend { "Filters" }
                                    label { r#for: "radio-search", "Search" }
                                    input {
                                        id: "radio-search",
                                        value: "{search}",
                                        placeholder: "Station, tag, or language",
                                        oninput: move |event| search.set(event.value()),
                                    }
                                    label { r#for: "radio-country", "Country" }
                                    select {
                                        id: "radio-country",
                                        value: "{country}",
                                        onchange: move |event| country.set(event.value()),
                                        option { value: "", "All origins" }
                                        for value in available_countries.clone().into_iter() {
                                            option { key: "{value}", value: "{value}", "{value}" }
                                        }
                                    }
                                    label { r#for: "radio-genre", "Genre" }
                                    select {
                                        id: "radio-genre",
                                        value: "{genre}",
                                        onchange: move |event| genre.set(event.value()),
                                        option { value: "", "All genres" }
                                        for value in available_genres.clone().into_iter() {
                                            option { key: "{value}", value: "{value}", "{value}" }
                                        }
                                    }
                                    div { class: "radio-volume",
                                        span { "Volume" }
                                        div { class: "radio-volume-controls",
                                            button {
                                                r#type: "button",
                                                disabled: volume() <= 0.0,
                                                onclick: move |_| volume.set((volume() - 0.1).max(0.0)),
                                                "-"
                                            }
                                            span { "{((volume() * 100.0).round())}%" }
                                            button {
                                                r#type: "button",
                                                disabled: volume() >= 1.0,
                                                onclick: move |_| volume.set((volume() + 0.1).min(1.0)),
                                                "+"
                                            }
                                        }
                                    }
                                }
                            }
                            TerminalPrompt { path: Some("~/radio".to_string()), command: Some(station_list_command), children: rsx! {} }
                            div { class: "radio-panel",
                                div { class: "radio-section-header", span { class: "text-terminal-cyan", "Station Directory" } }
                                if station_items.is_empty() {
                                    p { class: "radio-muted", "No stations found. Adjust filters or refresh the cache." }
                                } else {
                                    ol { class: "radio-directory",
                                        {
                                            let favs = favorites();
                                            let favs_for_list = favs.clone();
                                            station_items.iter().enumerate().map({
                                                let favs_for_list = favs_for_list.clone();
                                                move |(index, station)| {
                                                let station_id = station.id.clone();
                                                let station_for_select = station.clone();
                                                let is_fav = is_favorite(&favs_for_list, &station_id);
                                                let is_active = active_station_id
                                                    .as_ref()
                                                    .map(|value| value == &station_id)
                                                    .unwrap_or(false);
                                                let freq = format!("{} FM", format_frequency(index));
                                                rsx! {
                                                    li {
                                                        key: "{station_id}",
                                                        class: if is_active { "radio-directory-item active" } else { "radio-directory-item" },
                                                        div {
                                                            class: "radio-directory-row",
                                                            role: "button",
                                                            tabindex: "0",
                                                            onclick: move |_| {
                                                                selected.set(Some(station_for_select.clone()));
                                                                selected_index.set(index);
                                                            },
                                                            span { class: "radio-caret text-terminal-cyan", if is_active { ">" } else { "" } }
                                                            span { class: "radio-frequency text-terminal-green", "{freq}" }
                                                            button {
                                                                class: if is_fav { "radio-fav-button active" } else { "radio-fav-button" },
                                                                onclick: move |event| {
                                                                    event.stop_propagation();
                                                                    let updated = toggle_favorite(favorites(), &station_id);
                                                                    favorites.set(updated.clone());
                                                                    save_favorites(&updated);
                                                                },
                                                                if is_fav { "♥" } else { "♡" }
                                                            }
                                                            span { class: "radio-station-name", "{station.name}" }
                                                            span { class: "radio-country", "{station.country.clone().unwrap_or_else(|| \"Unknown\".to_string())}" }
                                                        }
                                                    }
                                                }
                                            }
                                            })
                                        }
                                        li {
                                            class: "radio-directory-footer",
                                            onmounted: move |_event| {
                                                #[cfg(target_arch = "wasm32")]
                                                {
                                                    let element = _event.data.as_ref().as_web_event();
                                                    if let Ok(node) = element.dyn_into::<web_sys::Element>() {
                                                        load_more_ref.set(Some(node));
                                                    }
                                                }
                                            },
                                            "{directory_status}"
                                        }
                                    }
                                }
                                div { class: "radio-footer",
                                    "Stations: {station_count}"
                                }
                            }
                        }
                    }
                    div { class: "radio-status",
                        if is_fetching() && station_items.is_empty() {
                            p { "Scanning the dial…" }
                        } else if response_error.is_some() {
                            p { class: "text-terminal-red", "Failed to reach the station directory." }
                        } else if let Some(meta) = first_meta() {
                            p { "Displaying {station_items.len()} of {meta.matches} stations · Cache: {meta.cache_source.clone().unwrap_or_else(|| \"unknown\".to_string())}" }
                            if let Some(updated) = meta.updated_at.clone() {
                                p { "Last refresh: {updated}" }
                            }
                            if let Some(origin) = meta.origin.clone() {
                                p { "Radio Browser source: {origin}" }
                            }
                        }
                    }
                    TerminalPrompt { path: Some("~/radio".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
            if let Some(station) = active_station {
                audio {
                    id: "radio-audio",
                    src: "{resolved_stream_url().unwrap_or_else(|| station.stream_url.clone())}",
                    autoplay: true,
                    controls: true,
                    hidden: true,
                }
            }
            if share_dialog_open() {
                div { class: "radio-modal",
                    div { class: "radio-modal-card",
                        h3 { class: "text-terminal-yellow", "Share Station" }
                        p { class: "radio-muted", "The link below opens radio and starts playing this station immediately. It was copied to your clipboard." }
                        div { class: "radio-share-link", "{share_link}" }
                        div { class: "radio-modal-actions",
                            button {
                                class: "radio-modal-button",
                                disabled: !share_link_available,
                                onclick: move |_| {
                                    #[cfg(target_arch = "wasm32")]
                                    {
                                        let link = share_link.clone();
                                        let mut share_toast = share_toast;
                                        spawn(async move {
                                            let window = web_sys::window().ok_or("window missing".to_string());
                                            if window.is_err() {
                                                share_toast.set("Copy failed: window missing".to_string());
                                                return;
                                            }
                                            let clipboard = window.unwrap().navigator().clipboard();
                                            let promise = clipboard.write_text(&link);
                                            if wasm_bindgen_futures::JsFuture::from(promise).await.is_ok() {
                                                share_toast.set("Share link copied.".to_string());
                                            } else {
                                                share_toast.set("Copy failed.".to_string());
                                            }
                                        });
                                    }
                                },
                                "Copy"
                            }
                            button {
                                class: "radio-modal-button ghost",
                                onclick: move |_| share_dialog_open.set(false),
                                "Close"
                            }
                        }
                        if !share_toast().is_empty() {
                            p { class: "text-terminal-green", "{share_toast}" }
                        }
                    }
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Filters {
    search: String,
    country: String,
    genre: String,
}

async fn fetch_station_page(
    base_url: &str,
    filters: &Filters,
    offset: i64,
    limit: i64,
) -> Result<StationsResponse, String> {
    #[cfg(target_arch = "wasm32")]
    {
        return fetch_station_page_web(base_url, filters, offset, limit).await;
    }
    let url = build_stations_url(base_url, filters, offset, limit);
    authorized_get_json(&url).await
}

#[cfg(target_arch = "wasm32")]
async fn fetch_station_page_web(
    base_url: &str,
    filters: &Filters,
    offset: i64,
    limit: i64,
) -> Result<StationsResponse, String> {
    let url = build_stations_url(base_url, filters, offset, limit);
    let controller =
        AbortController::new().map_err(|_| "abort controller unavailable".to_string())?;
    let signal = controller.signal();
    let mut init = RequestInit::new();
    init.method("GET");
    init.credentials(RequestCredentials::Include);
    init.signal(Some(&signal));
    let request = Request::new_with_str_and_init(&url, &init)
        .map_err(|_| "request init failed".to_string())?;
    let window = web_sys::window().ok_or("window unavailable")?;
    let timeout_controller = controller.clone();
    spawn(async move {
        TimeoutFuture::new(8000).await;
        timeout_controller.abort();
    });
    let response_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|err| format!("request failed: {err:?}"))?;
    let response: Response = response_value
        .dyn_into()
        .map_err(|_| "response decode failed".to_string())?;
    if !response.ok() {
        return Err(format!("http {}", response.status()));
    }
    let json_promise = response
        .json()
        .map_err(|_| "json parse failed".to_string())?;
    let json_value = JsFuture::from(json_promise)
        .await
        .map_err(|err| format!("json decode failed: {err:?}"))?;
    serde_wasm_bindgen::from_value(json_value)
        .map_err(|err| format!("decode failed: {err}"))
}

fn build_stations_url(base_url: &str, filters: &Filters, offset: i64, limit: i64) -> String {
    let mut params = Vec::new();
    params.push(format!("limit={limit}"));
    params.push(format!("offset={offset}"));
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

fn resolve_filter_options_from(
    meta: Option<&StationsMeta>,
    items: &[RadioStation],
) -> (Vec<String>, Vec<String>) {
    let countries = meta
        .and_then(|meta| meta.countries.clone())
        .filter(|values| !values.is_empty())
        .unwrap_or_else(|| collect_unique_countries(items));
    let genres = meta
        .and_then(|meta| meta.genres.clone())
        .filter(|values| !values.is_empty())
        .unwrap_or_else(|| collect_unique_genres(items));

    (normalize_values(countries), normalize_values(genres))
}

fn collect_unique_countries(items: &[RadioStation]) -> Vec<String> {
    let values: Vec<String> = items
        .iter()
        .filter_map(|station| station.country.clone())
        .collect();
    values
}

fn collect_unique_genres(items: &[RadioStation]) -> Vec<String> {
    let mut values = Vec::new();
    for station in items {
        for tag in &station.tags {
            if !tag.trim().is_empty() {
                values.push(tag.clone());
            }
        }
    }
    values
}

fn normalize_values(mut values: Vec<String>) -> Vec<String> {
    values.retain(|value| !value.trim().is_empty());
    values.sort_by_key(|value| value.to_lowercase());
    values.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    values
}

fn format_frequency(index: usize) -> String {
    let frequency = 87.5 + (index as f64 * 0.2);
    format!("{frequency:.1}")
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
async fn destroy_hls(element_id: &str, reset_src: bool) -> Result<(), String> {
    let id = serde_json::to_string(element_id).map_err(|err| err.to_string())?;
    let reset = if reset_src { "true" } else { "false" };
    let script = format!(
        r#"
        (function() {{
            const elementId = {id};
            const reset = {reset};
            const audio = document.getElementById(elementId);
            if (window.__gitgud_hls) {{
                window.__gitgud_hls.destroy();
                window.__gitgud_hls = null;
            }}
            if (audio && reset) {{
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

fn random_midnight_preset() -> SecretBroadcast {
    #[cfg(target_arch = "wasm32")]
    {
        let len = MIDNIGHT_PRESETS.len();
        let idx = (js_sys::Math::random() * len as f64).floor() as usize;
        return MIDNIGHT_PRESETS[idx.min(len - 1)];
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        MIDNIGHT_PRESETS[0]
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
