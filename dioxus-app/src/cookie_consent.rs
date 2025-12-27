use dioxus::prelude::*;

#[cfg(target_arch = "wasm32")]
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{closure::Closure, JsCast, JsValue};

#[cfg(target_arch = "wasm32")]
const CONSENT_COOKIE_NAME: &str = "zaraz-consent";
#[cfg(target_arch = "wasm32")]
const ANALYTICS_PURPOSE_ID: &str = "analytics";
#[cfg(target_arch = "wasm32")]
const OPEN_EVENT: &str = "openCookieConsentBar";
#[cfg(target_arch = "wasm32")]
const LOCAL_CONSENT_KEY: &str = "cookie-consent-choice";

#[cfg(target_arch = "wasm32")]
struct ConsentListeners {
    choices: Rc<Closure<dyn FnMut(web_sys::Event)>>,
    open: Rc<Closure<dyn FnMut(web_sys::Event)>>,
}

#[component]
pub fn CookieConsentBanner() -> Element {
    let visible = use_signal(initial_visibility);
    #[cfg(target_arch = "wasm32")]
    let mut listeners = use_signal(|| None::<ConsentListeners>);
    #[cfg(not(target_arch = "wasm32"))]
    let _listeners = ();

    #[cfg(target_arch = "wasm32")]
    use_effect(move || {
        if listeners.read().is_some() {
            return;
        }
        let document = match web_sys::window().and_then(|window| window.document()) {
            Some(document) => document,
            None => return,
        };

        let mut visible_for_choices = visible;
        let on_choices = Rc::new(Closure::wrap(Box::new(move |_event: web_sys::Event| {
            if consent_exists() {
                visible_for_choices.set(false);
            }
        }) as Box<dyn FnMut(_)>));

        let mut visible_for_open = visible;
        let on_open = Rc::new(Closure::wrap(Box::new(move |_event: web_sys::Event| {
            visible_for_open.set(true);
        }) as Box<dyn FnMut(_)>));

        let _ = document.add_event_listener_with_callback(
            "zarazConsentChoicesUpdated",
            on_choices.as_ref().as_ref().unchecked_ref(),
        );
        let _ = document.add_event_listener_with_callback(
            OPEN_EVENT,
            on_open.as_ref().as_ref().unchecked_ref(),
        );

        listeners.set(Some(ConsentListeners {
            choices: on_choices,
            open: on_open,
        }));
    });

    #[cfg(target_arch = "wasm32")]
    {
        let listeners = listeners;
        use_drop(move || {
            let binding = listeners.read();
            let Some(listeners) = binding.as_ref() else {
                return;
            };
            if let Some(document) = web_sys::window().and_then(|window| window.document()) {
                let _ = document.remove_event_listener_with_callback(
                    "zarazConsentChoicesUpdated",
                    listeners.choices.as_ref().as_ref().unchecked_ref(),
                );
                let _ = document.remove_event_listener_with_callback(
                    OPEN_EVENT,
                    listeners.open.as_ref().as_ref().unchecked_ref(),
                );
            }
        });
    }

    if !visible() {
        return rsx! {};
    }

    rsx! {
        div { class: "cookie-consent",
            div { class: "cookie-consent-card",
                div { class: "cookie-consent-body",
                    div { class: "cookie-consent-copy",
                        p { class: "text-terminal-green cookie-consent-title", "Cookies" }
                        p { class: "cookie-consent-text",
                            "We use a single analytics cookie via Cloudflare Zaraz. No ads, no profiling, no cross-site tracking. You can update your choice any time."
                        }
                        a {
                            href: "/privacy",
                            class: "terminal-link text-terminal-cyan cookie-consent-link",
                            "Privacy & Cookies Policy"
                        }
                    }
                    div { class: "cookie-consent-actions",
                        button {
                            r#type: "button",
                            class: "cookie-consent-button ghost",
                            onclick: move |_| apply_consent(false, visible),
                            "Reject all"
                        }
                        button {
                            r#type: "button",
                            class: "cookie-consent-button primary",
                            onclick: move |_| apply_consent(true, visible),
                            "Accept analytics"
                        }
                    }
                }
            }
        }
    }
}

fn initial_visibility() -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        if consent_exists() {
            return false;
        }
        true
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        false
    }
}

#[cfg(target_arch = "wasm32")]
fn consent_exists() -> bool {
    if get_cookie(CONSENT_COOKIE_NAME).is_some() {
        return true;
    }
    local_storage_get(LOCAL_CONSENT_KEY).is_some()
}

#[cfg(target_arch = "wasm32")]
fn get_cookie(name: &str) -> Option<String> {
    let document = web_sys::window().and_then(|window| window.document())?;
    let cookies = js_sys::Reflect::get(&document, &JsValue::from_str("cookie"))
        .ok()
        .and_then(|value| value.as_string())?;
    for part in cookies.split(';') {
        let trimmed = part.trim();
        if let Some((key, value)) = trimmed.split_once('=') {
            if key == name {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(target_arch = "wasm32")]
fn local_storage_get(key: &str) -> Option<String> {
    let storage = web_sys::window().and_then(|window| window.local_storage().ok().flatten())?;
    storage.get_item(key).ok().flatten()
}

#[cfg(target_arch = "wasm32")]
fn local_storage_set(key: &str, value: &str) {
    if let Some(storage) =
        web_sys::window().and_then(|window| window.local_storage().ok().flatten())
    {
        let _ = storage.set_item(key, value);
    }
}

fn apply_consent(granted: bool, mut visible: Signal<bool>) {
    visible.set(false);
    #[cfg(target_arch = "wasm32")]
    {
        let value = if granted { "accepted" } else { "rejected" };
        local_storage_set(LOCAL_CONSENT_KEY, value);

        if try_apply_consent(granted).is_err() {
            if let Some(document) = web_sys::window().and_then(|window| window.document()) {
                let closure = Closure::wrap(Box::new(move |_event: web_sys::Event| {
                    let _ = try_apply_consent(granted);
                }) as Box<dyn FnMut(_)>);
                let _ = document.add_event_listener_with_callback(
                    "zarazConsentAPIReady",
                    closure.as_ref().unchecked_ref(),
                );
                closure.forget();
            }
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = granted;
    }
}

#[cfg(target_arch = "wasm32")]
fn try_apply_consent(granted: bool) -> Result<(), String> {
    use js_sys::Object;
    use wasm_bindgen::JsValue;

    let window = web_sys::window().ok_or_else(|| "window missing".to_string())?;
    let zaraz = js_sys::Reflect::get(&window, &JsValue::from_str("zaraz"))
        .map_err(|_| "zaraz missing".to_string())?;
    if zaraz.is_undefined() || zaraz.is_null() {
        return Err("zaraz missing".to_string());
    }
    let consent = js_sys::Reflect::get(&zaraz, &JsValue::from_str("consent"))
        .map_err(|_| "consent missing".to_string())?;
    if consent.is_undefined() || consent.is_null() {
        return Err("consent missing".to_string());
    }

    let api_ready = js_sys::Reflect::get(&consent, &JsValue::from_str("APIReady"))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !api_ready {
        return Err("consent not ready".to_string());
    }

    let has_analytics = js_sys::Reflect::get(&consent, &JsValue::from_str("purposes"))
        .ok()
        .and_then(|value| {
            if value.is_null() || value.is_undefined() {
                return None;
            }
            js_sys::Reflect::has(&value, &JsValue::from_str(ANALYTICS_PURPOSE_ID)).ok()
        })
        .unwrap_or(false);

    if has_analytics {
        if let Ok(set_fn) = js_sys::Reflect::get(&consent, &JsValue::from_str("set")) {
            if let Some(set_fn) = set_fn.dyn_ref::<js_sys::Function>() {
                let prefs = Object::new();
                js_sys::Reflect::set(
                    &prefs,
                    &JsValue::from_str(ANALYTICS_PURPOSE_ID),
                    &JsValue::from_bool(granted),
                )
                .map_err(|_| "consent set failed".to_string())?;
                let _ = set_fn.call1(&consent, &prefs);
            }
        }
    } else if let Ok(set_all_fn) = js_sys::Reflect::get(&consent, &JsValue::from_str("setAll")) {
        if let Some(set_all_fn) = set_all_fn.dyn_ref::<js_sys::Function>() {
            let _ = set_all_fn.call1(&consent, &JsValue::from_bool(granted));
        }
    }

    if granted {
        if let Ok(send_fn) = js_sys::Reflect::get(&consent, &JsValue::from_str("sendQueuedEvents"))
        {
            if let Some(send_fn) = send_fn.dyn_ref::<js_sys::Function>() {
                let _ = send_fn.call0(&consent);
            }
        }
    }

    Ok(())
}
