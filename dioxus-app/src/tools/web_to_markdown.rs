use dioxus::prelude::*;
use serde::Serialize;
use wasm_bindgen::JsCast;

use crate::gateway_session::authorized_post;

#[derive(Clone, Debug, PartialEq)]
enum ConvertState {
    Idle,
    Loading,
    Success(String),
    Error(String),
}

#[derive(Serialize)]
struct FetchBody<'a> {
    url: &'a str,
}

#[component]
pub fn WebToMarkdownPage() -> Element {
    let mut url = use_signal(String::new);
    let mut state = use_signal(|| ConvertState::Idle);
    let mut toast = use_signal(String::new);
    let filename = use_memo(move || sanitize_filename(&url()));

    rsx! {
        div { class: "tool",
            h2 { "Web → Markdown" }
            p { class: "tool-help",
                "Fetches a page server-side and returns markdown. Only http/https; ports 80/443; no redirects."
            }
            label { class: "tool-label", "URL" }
            input {
                value: "{url}",
                placeholder: "https://example.com",
                class: "tool-input",
                oninput: move |event| url.set(event.value()),
                onkeydown: move |event| {
                    if event.key() == Key::Enter {
                        event.prevent_default();
                        spawn(convert(url(), state, toast));
                    }
                }
            }
            div { class: "tool-actions",
                button {
                    class: "tool-button",
                    onclick: move |_| {
                        let url = url();
                        let state = state;
                        let toast = toast;
                        async move { convert(url, state, toast).await }
                    },
                    disabled: matches!(*state.read(), ConvertState::Loading),
                    if matches!(*state.read(), ConvertState::Loading) { "Converting..." } else { "Convert" }
                }
                button {
                    class: "tool-button ghost",
                    onclick: move |_| {
                        state.set(ConvertState::Idle);
                        toast.set(String::new());
                    },
                    "Clear"
                }
                button {
                    class: "tool-button ghost",
                    onclick: move |_| {
                        let state = state;
                        let toast = toast;
                        async move { copy_markdown(state, toast).await }
                    },
                    disabled: !matches!(*state.read(), ConvertState::Success(_)),
                    "Copy"
                }
                button {
                    class: "tool-button ghost",
                    onclick: move |_| {
                        let filename = filename();
                        let state = state;
                        let toast = toast;
                        async move { download_markdown(filename, state, toast).await }
                    },
                    disabled: !matches!(*state.read(), ConvertState::Success(_)),
                    "Download"
                }
            }
            if !toast().is_empty() {
                p { class: "tool-toast", "{toast}" }
            }
            match state() {
                ConvertState::Error(message) => rsx! { p { class: "tool-error", "{message}" } },
                _ => rsx! {},
            }
            textarea {
                class: "tool-output",
                readonly: true,
                value: match state() {
                    ConvertState::Success(markdown) => markdown,
                    _ => String::new(),
                }
            }
        }
    }
}

async fn convert(url: String, mut state: Signal<ConvertState>, mut toast: Signal<String>) {
    let trimmed = url.trim().to_string();
    toast.set(String::new());
    if trimmed.is_empty() {
        state.set(ConvertState::Error("URL is required".to_string()));
        return;
    }
    if trimmed.len() > 2048 {
        state.set(ConvertState::Error("URL is too long".to_string()));
        return;
    }

    state.set(ConvertState::Loading);
    let body = serde_json::to_string(&FetchBody { url: &trimmed })
        .unwrap_or_else(|_| "{\"url\":\"\"}".to_string());
    let response = match authorized_post("/api/fmd/v1/fetch-md", &body).await {
        Ok(response) => response,
        Err(err) => {
            state.set(ConvertState::Error(err));
            return;
        }
    };

    if !response.ok() {
        let status = response.status();
        let message = response.text().await.unwrap_or_default();
        state.set(ConvertState::Error(format!(
            "Request failed (status {status}): {message}"
        )));
        return;
    }

    let markdown = response.text().await.unwrap_or_default();
    state.set(ConvertState::Success(markdown));
}

async fn copy_markdown(state: Signal<ConvertState>, mut toast: Signal<String>) {
    if let ConvertState::Success(markdown) = state() {
        if let Err(err) = write_clipboard(&markdown).await {
            toast.set(format!("Copy failed: {err}"));
        } else {
            toast.set("Copied to clipboard".to_string());
        }
    }
}

async fn download_markdown(filename: String, state: Signal<ConvertState>, mut toast: Signal<String>) {
    if let ConvertState::Success(markdown) = state() {
        if let Err(err) = download_text(&filename, &markdown) {
            toast.set(format!("Download failed: {err}"));
        } else {
            toast.set("Download ready".to_string());
        }
    }
}

fn sanitize_filename(url: &str) -> String {
    if let Ok(parsed) = web_sys::Url::new(url) {
        let host = parsed.hostname();
        let mut clean = host
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '-' })
            .collect::<String>();
        clean.truncate(80);
        if clean.is_empty() {
            clean = "page".to_string();
        }
        return format!("{clean}.md");
    }
    "page.md".to_string()
}

async fn write_clipboard(text: &str) -> Result<(), String> {
    let window = web_sys::window().ok_or("clipboard unavailable")?;
    let clipboard = window.navigator().clipboard();
    let promise = clipboard.write_text(text);
    wasm_bindgen_futures::JsFuture::from(promise)
        .await
        .map_err(|_| "clipboard write failed")?;
    Ok(())
}

fn download_text(filename: &str, text: &str) -> Result<(), String> {
    let window = web_sys::window().ok_or("window unavailable")?;
    let document = window.document().ok_or("document unavailable")?;

    let blob_parts = js_sys::Array::new();
    blob_parts.push(&wasm_bindgen::JsValue::from_str(text));
    let options = web_sys::BlobPropertyBag::new();
    options.set_type("text/markdown;charset=utf-8");
    let blob = web_sys::Blob::new_with_str_sequence_and_options(&blob_parts, &options)
        .map_err(|_| "blob failed")?;
    let url = web_sys::Url::create_object_url_with_blob(&blob)
        .map_err(|_| "url failed")?;

    let element = document
        .create_element("a")
        .map_err(|_| "anchor failed")?;
    let anchor = element
        .dyn_into::<web_sys::HtmlAnchorElement>()
        .map_err(|_| "anchor cast failed")?;
    anchor.set_href(&url);
    anchor.set_download(filename);
    document
        .body()
        .ok_or("document body missing")?
        .append_child(&anchor)
        .map_err(|_| "append failed")?;
    anchor.click();
    anchor.remove();
    web_sys::Url::revoke_object_url(&url).map_err(|_| "revoke failed")?;
    Ok(())
}
