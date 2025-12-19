use dioxus::prelude::*;
use dioxus::html::FileData;
use wasm_bindgen::JsCast;

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_WIDTH: i32 = 300;
const MIN_WIDTH: i32 = 1;
const MAX_DECODED_PIXELS: u64 = 40_000_000;
const RAMP: &str = "@%#*+=-:. ";

const ALLOWED_MIME_TYPES: [&str; 4] = ["image/jpeg", "image/png", "image/bmp", "image/gif"];
const ALLOWED_EXTENSIONS: [&str; 5] = ["jpg", "jpeg", "png", "bmp", "gif"];

#[derive(Clone, Debug, PartialEq)]
enum ConvertState {
    Idle,
    Loading,
    Success { ascii: String, width: u32, height: u32 },
    Error(String),
}

#[component]
pub fn ImageToAsciiPage() -> Element {
    let mut file = use_signal(|| Option::<FileData>::None);
    let mut width = use_signal(|| MAX_WIDTH);
    let mut state = use_signal(|| ConvertState::Idle);
    let mut toast = use_signal(String::new);

    let filename = use_memo(move || file().as_ref().map(build_filename).unwrap_or("image.txt".into()));
    let ascii = match state() {
        ConvertState::Success { ascii, .. } => ascii,
        _ => String::new(),
    };

    rsx! {
        div { class: "tool",
            h2 { "Image → ASCII" }
            p { class: "tool-help",
                "Converts an image locally in your browser. Supported: jpg/jpeg/png/bmp/gif."
            }
            label { class: "tool-label", "Image file (max 5 MiB)" }
            input {
                r#type: "file",
                accept: ".jpg,.jpeg,.png,.bmp,.gif,image/jpeg,image/png,image/bmp,image/gif",
                class: "tool-input",
                onchange: move |event| {
                    let next_file = event.files().into_iter().next();
                    file.set(next_file);
                    state.set(ConvertState::Idle);
                    toast.set(String::new());
                }
            }
            label { class: "tool-label", "Width (1–300)" }
            input {
                r#type: "number",
                min: "{MIN_WIDTH}",
                max: "{MAX_WIDTH}",
                value: "{width}",
                class: "tool-input",
                oninput: move |event| {
                    if let Ok(parsed) = event.value().parse::<i32>() {
                        width.set(parsed);
                    }
                }
            }
            div { class: "tool-actions",
                button {
                    class: "tool-button",
                    onclick: move |_| {
                        let selected = file();
                        let target_width = width();
                        let mut state = state;
                        let toast = toast;
                        spawn(async move {
                            match selected {
                                Some(file) => convert(file, target_width, state, toast).await,
                                None => state.set(ConvertState::Error("Choose an image file first".to_string())),
                            }
                        });
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
                        spawn(async move { copy_ascii(state, toast).await });
                    },
                    disabled: !matches!(*state.read(), ConvertState::Success { .. }),
                    "Copy"
                }
                button {
                    class: "tool-button ghost",
                    onclick: move |_| {
                        let filename = filename();
                        let state = state;
                        let toast = toast;
                        spawn(async move { download_ascii(filename, state, toast).await });
                    },
                    disabled: !matches!(*state.read(), ConvertState::Success { .. }),
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
                value: "{ascii}",
                aria_label: "ASCII output",
            }
        }
    }
}

async fn convert(file: FileData, width: i32, mut state: Signal<ConvertState>, mut toast: Signal<String>) {
    toast.set(String::new());
    if file.size() > MAX_FILE_BYTES {
        state.set(ConvertState::Error("File too large (max 5 MiB)".to_string()));
        return;
    }
    if !detect_allowed(&file) {
        state.set(ConvertState::Error(
            "Unsupported file type (jpg/jpeg/png/bmp/gif only)".to_string(),
        ));
        return;
    }

    let target_width = clamp_width(width);
    state.set(ConvertState::Loading);

    let bytes = match file.read_bytes().await {
        Ok(bytes) => bytes,
        Err(_) => {
            state.set(ConvertState::Error("Failed to read file".to_string()));
            return;
        }
    };

    let content_type = file
        .content_type()
        .unwrap_or_else(|| "image/png".to_string());
    let blob = match bytes_to_blob(bytes.as_ref(), &content_type) {
        Ok(blob) => blob,
        Err(message) => {
            state.set(ConvertState::Error(message));
            return;
        }
    };

    let image = match load_image(&blob).await {
        Ok(image) => image,
        Err(message) => {
            state.set(ConvertState::Error(message));
            return;
        }
    };

    let source_width = image.width();
    let source_height = image.height();
    if source_width == 0 || source_height == 0 {
        state.set(ConvertState::Error("Image dimensions are invalid".to_string()));
        return;
    }

    let decoded_pixels = source_width as u64 * source_height as u64;
    if decoded_pixels > MAX_DECODED_PIXELS {
        state.set(ConvertState::Error("Image dimensions too large".to_string()));
        return;
    }

    let ratio = target_width as f64 / source_width as f64;
    let target_height = ((source_height as f64) * ratio).round().max(1.0) as u32;

    let canvas = match create_canvas(target_width, target_height) {
        Ok(canvas) => canvas,
        Err(message) => {
            state.set(ConvertState::Error(message));
            return;
        }
    };
    let context = match canvas_context(&canvas) {
        Ok(context) => context,
        Err(message) => {
            state.set(ConvertState::Error(message));
            return;
        }
    };

    if context
        .draw_image_with_html_image_element_and_dw_and_dh(
            &image,
            0.0,
            0.0,
            target_width as f64,
            target_height as f64,
        )
        .is_err()
    {
        state.set(ConvertState::Error("Failed to draw image".to_string()));
        return;
    }

    let image_data = match context.get_image_data(
        0.0,
        0.0,
        target_width as f64,
        target_height as f64,
    ) {
        Ok(data) => data,
        Err(_) => {
            state.set(ConvertState::Error("Failed to read image data".to_string()));
            return;
        }
    };
    let pixels = image_data.data().to_vec();

    let mut lines = Vec::with_capacity(target_height as usize);
    for y in 0..target_height {
        let mut line = String::with_capacity(target_width as usize);
        let row_start = (y * target_width * 4) as usize;
        for x in 0..target_width {
            let idx = row_start + (x * 4) as usize;
            let r = pixels.get(idx).copied().unwrap_or(0);
            let g = pixels.get(idx + 1).copied().unwrap_or(0);
            let b = pixels.get(idx + 2).copied().unwrap_or(0);
            let a = pixels.get(idx + 3).copied().unwrap_or(255);
            if a == 0 {
                line.push(' ');
            } else {
                line.push(pixel_to_char(r, g, b));
            }
        }
        lines.push(line);
    }

    state.set(ConvertState::Success {
        ascii: lines.join("\n"),
        width: target_width,
        height: target_height,
    });
}

async fn copy_ascii(state: Signal<ConvertState>, mut toast: Signal<String>) {
    if let ConvertState::Success { ascii, .. } = state() {
        if let Err(err) = write_clipboard(&ascii).await {
            toast.set(format!("Copy failed: {err}"));
        } else {
            toast.set("Copied to clipboard".to_string());
        }
    }
}

async fn download_ascii(filename: String, state: Signal<ConvertState>, mut toast: Signal<String>) {
    if let ConvertState::Success { ascii, .. } = state() {
        if let Err(err) = download_text(&filename, &ascii) {
            toast.set(format!("Download failed: {err}"));
        } else {
            toast.set("Download ready".to_string());
        }
    }
}

fn detect_allowed(file: &FileData) -> bool {
    let type_ok = file
        .content_type()
        .map(|value| ALLOWED_MIME_TYPES.iter().any(|allowed| allowed == &value))
        .unwrap_or(false);
    let ext = file
        .name()
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let ext_ok = ALLOWED_EXTENSIONS.contains(&ext.as_str());
    type_ok || ext_ok
}

fn clamp_width(value: i32) -> u32 {
    value.clamp(MIN_WIDTH, MAX_WIDTH) as u32
}

fn build_filename(file: &FileData) -> String {
    let name = file.name();
    let base = name.rsplit_once('.').map(|(base, _)| base).unwrap_or(&name);
    let clean = if base.is_empty() { "image" } else { base };
    format!("{clean}.txt")
}

fn bytes_to_blob(bytes: &[u8], content_type: &str) -> Result<web_sys::Blob, String> {
    let array = js_sys::Uint8Array::from(bytes);
    let parts = js_sys::Array::of1(&array);
    let options = web_sys::BlobPropertyBag::new();
    options.set_type(content_type);
    web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &options)
        .map_err(|_| "Failed to create blob".to_string())
}

async fn load_image(blob: &web_sys::Blob) -> Result<web_sys::HtmlImageElement, String> {
    let url = web_sys::Url::create_object_url_with_blob(blob).map_err(|_| "Invalid blob URL")?;
    let image = web_sys::HtmlImageElement::new().map_err(|_| "Image element unavailable")?;
    image.set_src(&url);
    let decode = image.decode();
    let result = wasm_bindgen_futures::JsFuture::from(decode).await;
    web_sys::Url::revoke_object_url(&url).map_err(|_| "Failed to revoke blob URL")?;
    result.map_err(|_| "Image decode failed".to_string())?;
    Ok(image)
}

fn create_canvas(width: u32, height: u32) -> Result<web_sys::HtmlCanvasElement, String> {
    let document = web_sys::window()
        .and_then(|window| window.document())
        .ok_or("Document unavailable")?;
    let canvas = document
        .create_element("canvas")
        .map_err(|_| "Canvas creation failed")?
        .dyn_into::<web_sys::HtmlCanvasElement>()
        .map_err(|_| "Canvas cast failed")?;
    canvas.set_width(width);
    canvas.set_height(height);
    Ok(canvas)
}

fn canvas_context(
    canvas: &web_sys::HtmlCanvasElement,
) -> Result<web_sys::CanvasRenderingContext2d, String> {
    let context = canvas
        .get_context("2d")
        .map_err(|_| "Canvas context error")?
        .ok_or("Canvas context unavailable")?;
    context
        .dyn_into::<web_sys::CanvasRenderingContext2d>()
        .map_err(|_| "Canvas context cast failed".to_string())
}

fn luminance(r: u8, g: u8, b: u8) -> f64 {
    0.2126 * (r as f64) + 0.7152 * (g as f64) + 0.0722 * (b as f64)
}

fn pixel_to_char(r: u8, g: u8, b: u8) -> char {
    let t = luminance(r, g, b) / 255.0;
    let idx = ((1.0 - t) * ((RAMP.len() - 1) as f64)).floor() as usize;
    RAMP.chars().nth(idx).unwrap_or(' ')
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

    let parts = js_sys::Array::new();
    parts.push(&wasm_bindgen::JsValue::from_str(text));
    let options = web_sys::BlobPropertyBag::new();
    options.set_type("text/plain;charset=utf-8");
    let blob = web_sys::Blob::new_with_str_sequence_and_options(&parts, &options)
        .map_err(|_| "blob failed")?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(|_| "url failed")?;

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
