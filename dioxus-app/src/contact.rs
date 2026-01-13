use dioxus::prelude::*;
use dioxus_router::Link;
use gloo_net::http::Request;
use serde::{Deserialize, Serialize};
use web_sys::RequestCredentials;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue};

use crate::config::RuntimeConfig;
use crate::gateway_session::{authorized_post, ensure_gateway_session};
use crate::routes::Route;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};

#[derive(Clone, Debug, Default)]
struct ContactForm {
    name: String,
    email: String,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
struct ContactPayload {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    honeypot: Option<String>,
    timestamp: i64,
    #[serde(rename = "turnstileToken", skip_serializing_if = "Option::is_none")]
    turnstile_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct GatewayConfig {
    #[serde(rename = "turnstileSiteKey")]
    turnstile_site_key: Option<String>,
}

const TURNSTILE_CONTAINER_ID: &str = "turnstile-container";

#[component]
pub fn ContactPage() -> Element {
    let config = use_context::<RuntimeConfig>();
    let gateway_base = config.gateway_api_base_url.clone();
    let mut form = use_signal(ContactForm::default);
    let mut honeypot = use_signal(String::new);
    let loading = use_signal(|| false);
    let mut success = use_signal(|| false);
    let mut error = use_signal(|| None::<String>);
    let session_ready = use_signal(|| false);
    let turnstile_site_key = use_signal(|| None::<String>);
    let turnstile_token = use_signal(|| None::<String>);
    #[cfg(target_arch = "wasm32")]
    let turnstile_widget_id = use_signal(|| None::<String>);
    #[cfg(not(target_arch = "wasm32"))]
    let _turnstile_widget_id = ();
    let mut timestamp = use_signal(now_timestamp);
    #[cfg(target_arch = "wasm32")]
    let turnstile_ready = use_signal(|| false);
    #[cfg(not(target_arch = "wasm32"))]
    let _turnstile_ready = ();
    let mut config_loaded = use_signal(|| false);

    use_effect(move || {
        if session_ready() {
            return;
        }
        let mut session_ready = session_ready;
        let mut error = error;
        spawn(async move {
            if ensure_gateway_session().await.is_ok() {
                session_ready.set(true);
            } else {
                error.set(Some(
                    "Failed to initialize session. Please refresh the page.".to_string(),
                ));
            }
        });
    });

    use_effect(move || {
        if config_loaded() {
            return;
        }
        config_loaded.set(true);
        let mut turnstile_site_key = turnstile_site_key;
        let mut error = error;
        let gateway_base = gateway_base.clone();
        spawn(async move {
            match fetch_gateway_config(&gateway_base).await {
                Ok(config) => {
                    turnstile_site_key.set(config.turnstile_site_key);
                }
                Err(_) => {
                    error.set(None);
                }
            }
        });
    });

    #[cfg(target_arch = "wasm32")]
    use_effect(move || {
        if success() {
            return;
        }
        let mut turnstile_widget_id = turnstile_widget_id;
        let turnstile_ready = turnstile_ready;
        let Some(site_key) = turnstile_site_key() else {
            return;
        };
        if turnstile_widget_id().is_some() {
            return;
        }
        if !turnstile_ready() {
            if ensure_turnstile_script_loaded(turnstile_ready).is_err() {
                return;
            }
            return;
        }
        let Some(container) = get_turnstile_container() else {
            return;
        };
        match render_turnstile_widget(container, site_key, turnstile_token, error) {
            Ok(widget_id) => turnstile_widget_id.set(Some(widget_id)),
            Err(message) => error.set(Some(message)),
        }
    });

    let char_count = form().message.len();
    let max_chars = 2000;
    let ready = session_ready();
    let submit_disabled =
        loading() || !ready || form().name.trim().is_empty() || form().message.trim().is_empty();
    let turnstile_required = turnstile_site_key().is_some();
    let turnstile_blocking = turnstile_required && turnstile_token().is_none();

    rsx! {
        document::Title { "Contact | My Stupid Website" }
        document::Meta { name: "description", content: "Get in touch with us." }
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Contact form".to_string()),
                TerminalHeader { display_cwd: "~/contact".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { command: Some("cat contact.txt".to_string()), children: rsx! {} }
                    if success() {
                        div { class: "terminal-stack-md terminal-indent",
                            p { class: "text-terminal-green", "✓ Message received" }
                            p { class: "terminal-muted", "We'll get back to you if needed." }
                            button {
                                r#type: "button",
                                class: "terminal-link text-terminal-blue",
                                onclick: move |_| {
                                    error.set(None);
                                    success.set(false);
                                    timestamp.set(now_timestamp());
                                    #[cfg(target_arch = "wasm32")]
                                    reset_turnstile_widget(
                                        turnstile_widget_id(),
                                        turnstile_token,
                                        turnstile_widget_id,
                                    );
                                },
                                "Send another message"
                            }
                        }
                    } else {
                        form {
                            class: "terminal-form terminal-indent terminal-stack",
                            onsubmit: move |event| {
                                event.prevent_default();
                                if submit_disabled || turnstile_blocking {
                                    return;
                                }
                                let payload = build_payload(form(), honeypot(), timestamp(), turnstile_token());
                                let mut loading = loading;
                                let mut success = success;
                                let mut error = error;
                                let mut form = form;
                                let mut turnstile_token = turnstile_token;
                                spawn(async move {
                                    loading.set(true);
                                    error.set(None);
                                    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
                                    match authorized_post("/api/contact", &body).await {
                                        Ok(response) => {
                                            if response.ok() {
                                                success.set(true);
                                                form.set(ContactForm::default());
                                                turnstile_token.set(None);
                                            } else {
                                                let message = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                                                error.set(Some(message));
                                            }
                                        }
                                        Err(err) => {
                                            error.set(Some(err));
                                        }
                                    }
                                    loading.set(false);
                                });
                            },
                            input {
                                r#type: "text",
                                name: "website",
                                value: "{honeypot}",
                                oninput: move |event| honeypot.set(event.value()),
                                tabindex: "-1",
                                autocomplete: "off",
                                class: "honeypot",
                                aria_hidden: "true",
                            }
                            div { class: "terminal-stack-sm",
                                label { r#for: "name", class: "text-terminal-green", "Name: " span { class: "text-terminal-red", "*" } }
                                input {
                                    id: "name",
                                    r#type: "text",
                                    value: "{form().name}",
                                    maxlength: "80",
                                    disabled: loading(),
                                    class: "terminal-input-field",
                                    oninput: move |event| {
                                        let mut next = form();
                                        next.name = event.value();
                                        form.set(next);
                                    },
                                }
                            }
                            div { class: "terminal-stack-sm",
                                label { r#for: "email", class: "text-terminal-green",
                                    "Email: " span { class: "terminal-muted", "(optional)" }
                                }
                                input {
                                    id: "email",
                                    r#type: "email",
                                    value: "{form().email}",
                                    maxlength: "120",
                                    disabled: loading(),
                                    class: "terminal-input-field",
                                    oninput: move |event| {
                                        let mut next = form();
                                        next.email = event.value();
                                        form.set(next);
                                    },
                                }
                            }
                            div { class: "terminal-stack-sm",
                                label { r#for: "message", class: "text-terminal-green", "Message: " span { class: "text-terminal-red", "*" } }
                                textarea {
                                    id: "message",
                                    value: "{form().message}",
                                    maxlength: "2000",
                                    rows: "8",
                                    disabled: loading(),
                                    class: "terminal-input-field terminal-textarea",
                                    oninput: move |event| {
                                        let mut next = form();
                                        next.message = event.value();
                                        form.set(next);
                                    },
                                }
                                p { class: "terminal-muted", "{char_count} / {max_chars} characters" }
                            }
                            if turnstile_site_key().is_some() {
                                div { id: TURNSTILE_CONTAINER_ID, class: "turnstile-box" }
                            }
                            if let Some(message) = error() {
                                div { class: "terminal-error", "{message}" }
                            }
                            button {
                                r#type: "submit",
                                class: "terminal-button",
                                disabled: submit_disabled || turnstile_blocking,
                                if loading() {
                                    "Sending..."
                                } else if !ready {
                                    "Initializing..."
                                } else if turnstile_blocking {
                                    "Complete challenge..."
                                } else {
                                    "Send Message"
                                }
                            }
                            p { class: "terminal-muted",
                                "By submitting, you agree that we may store your message for review. See our "
                                Link { to: Route::Privacy {}, class: "terminal-link text-terminal-blue", "privacy policy" }
                                "."
                            }
                        }
                    }
                    TerminalPrompt { path: Some("~/contact".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

fn build_payload(
    form: ContactForm,
    honeypot: String,
    timestamp: i64,
    turnstile_token: Option<String>,
) -> ContactPayload {
    let name = form.name.trim().to_string();
    let message = form.message.trim().to_string();
    let email = form.email.trim().to_string();
    let email = if email.is_empty() { None } else { Some(email) };
    let honeypot = if honeypot.trim().is_empty() {
        None
    } else {
        Some(honeypot.trim().to_string())
    };

    ContactPayload {
        name,
        email,
        message,
        honeypot,
        timestamp,
        turnstile_token,
    }
}

async fn fetch_gateway_config(base_url: &str) -> Result<GatewayConfig, String> {
    let base = base_url.trim().trim_end_matches('/');
    let url = format!("{base}/config");
    let response = Request::get(&url)
        .credentials(RequestCredentials::Include)
        .send()
        .await
        .map_err(|err| format!("config fetch failed: {err}"))?;
    if !response.ok() {
        return Err(format!("config fetch failed: status {}", response.status()));
    }
    response
        .json::<GatewayConfig>()
        .await
        .map_err(|err| format!("config decode failed: {err}"))
}

fn now_timestamp() -> i64 {
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() as i64) / 1000
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        0
    }
}

#[cfg(target_arch = "wasm32")]
fn get_turnstile_container() -> Option<web_sys::Element> {
    let window = web_sys::window()?;
    let document = window.document()?;
    document.get_element_by_id(TURNSTILE_CONTAINER_ID)
}

#[cfg(target_arch = "wasm32")]
fn ensure_turnstile_script_loaded(mut ready: Signal<bool>) -> Result<(), String> {
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::JsCast;

    let window = web_sys::window().ok_or("window unavailable")?;
    let document = window.document().ok_or("document unavailable")?;

    if js_sys::Reflect::has(&window, &wasm_bindgen::JsValue::from_str("turnstile")).unwrap_or(false)
    {
        ready.set(true);
        return Ok(());
    }

    if let Ok(existing) = document.query_selector(
        "script[src=\"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit\"]",
    ) {
        if existing.is_some() {
            return Ok(());
        }
    }

    let script = document
        .create_element("script")
        .map_err(|_| "script create failed")?
        .dyn_into::<web_sys::HtmlScriptElement>()
        .map_err(|_| "script cast failed")?;
    script.set_src("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    script.set_async(true);
    script.set_defer(true);

    let onload = Closure::wrap(Box::new(move || {
        ready.set(true);
    }) as Box<dyn FnMut()>);
    script.set_onload(Some(onload.as_ref().unchecked_ref()));
    onload.forget();

    document
        .head()
        .ok_or("document head missing")?
        .append_child(&script)
        .map_err(|_| "script append failed")?;

    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn render_turnstile_widget(
    container: web_sys::Element,
    site_key: String,
    mut turnstile_token: Signal<Option<String>>,
    mut error: Signal<Option<String>>,
) -> Result<String, String> {
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::JsCast;

    let window = web_sys::window().ok_or("window unavailable")?;
    let turnstile = js_sys::Reflect::get(&window, &wasm_bindgen::JsValue::from_str("turnstile"))
        .map_err(|_| "turnstile unavailable")?;
    if turnstile.is_undefined() {
        return Err("turnstile not available".to_string());
    }

    let render_fn = js_sys::Reflect::get(&turnstile, &wasm_bindgen::JsValue::from_str("render"))
        .map_err(|_| "turnstile render missing")?
        .dyn_into::<js_sys::Function>()
        .map_err(|_| "turnstile render invalid")?;

    let options = js_sys::Object::new();
    js_sys::Reflect::set(&options, &"sitekey".into(), &site_key.into())
        .map_err(|_| "sitekey set failed")?;

    let callback = Closure::wrap(Box::new(move |token: wasm_bindgen::JsValue| {
        if let Some(token) = token.as_string() {
            turnstile_token.set(Some(token));
        }
    }) as Box<dyn FnMut(_)>);

    let error_callback = Closure::wrap(Box::new(move || {
        error.set(Some(
            "Turnstile verification failed. Please refresh the page.".to_string(),
        ));
        turnstile_token.set(None);
    }) as Box<dyn FnMut()>);

    let expired_callback = Closure::wrap(Box::new(move || {
        error.set(Some(
            "Turnstile token expired. Please complete the challenge again.".to_string(),
        ));
        turnstile_token.set(None);
    }) as Box<dyn FnMut()>);

    let timeout_callback = Closure::wrap(Box::new(move || {
        error.set(Some(
            "Turnstile timed out. Please complete the challenge again.".to_string(),
        ));
        turnstile_token.set(None);
    }) as Box<dyn FnMut()>);

    js_sys::Reflect::set(&options, &"callback".into(), callback.as_ref())
        .map_err(|_| "callback set failed")?;
    js_sys::Reflect::set(&options, &"error-callback".into(), error_callback.as_ref())
        .map_err(|_| "error callback set failed")?;
    js_sys::Reflect::set(
        &options,
        &"expired-callback".into(),
        expired_callback.as_ref(),
    )
    .map_err(|_| "expired callback set failed")?;
    js_sys::Reflect::set(
        &options,
        &"timeout-callback".into(),
        timeout_callback.as_ref(),
    )
    .map_err(|_| "timeout callback set failed")?;

    let widget_id = render_fn
        .call2(&turnstile, &container.into(), &options)
        .map_err(|_| "turnstile render failed")?;

    callback.forget();
    error_callback.forget();
    expired_callback.forget();
    timeout_callback.forget();

    widget_id
        .as_string()
        .ok_or_else(|| "turnstile widget id missing".to_string())
}

#[cfg(target_arch = "wasm32")]
fn reset_turnstile_widget(
    widget_id: Option<String>,
    mut turnstile_token: Signal<Option<String>>,
    mut turnstile_widget_id: Signal<Option<String>>,
) {
    turnstile_token.set(None);
    if let Some(id) = widget_id {
        if let Some(window) = web_sys::window() {
            if let Ok(turnstile) = js_sys::Reflect::get(&window, &JsValue::from_str("turnstile"))
            {
                if !turnstile.is_null() && !turnstile.is_undefined() {
                    let mut removed = false;
                    if let Ok(remove_value) =
                        js_sys::Reflect::get(&turnstile, &JsValue::from_str("remove"))
                    {
                        if let Ok(remove_fn) = remove_value.dyn_into::<js_sys::Function>() {
                            let _ = remove_fn.call1(&turnstile, &JsValue::from_str(&id));
                            removed = true;
                        }
                    }
                    if !removed {
                        if let Ok(reset_value) =
                            js_sys::Reflect::get(&turnstile, &JsValue::from_str("reset"))
                        {
                            if let Ok(reset_fn) = reset_value.dyn_into::<js_sys::Function>() {
                                let _ = reset_fn.call1(&turnstile, &JsValue::from_str(&id));
                            }
                        }
                    }
                }
            }
        }
    }
    turnstile_widget_id.set(None);
}
