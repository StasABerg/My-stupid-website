use dioxus::prelude::*;
use dioxus::web::WebEventExt;
use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;

const SWAGGER_CSS_URL: &str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css";
const SWAGGER_BUNDLE_URL: &str =
    "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js";
const SWAGGER_PRESET_URL: &str =
    "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js";

#[component]
pub fn SwaggerEmbed(spec_url: String) -> Element {
    let mut container = use_signal(|| Option::<web_sys::Element>::None);
    let error = use_signal(|| Option::<String>::None);
    let mut mounted = use_signal(|| false);
    let mut last_spec = use_signal(|| None::<String>);

    use_effect(move || {
        let container = container();
        let spec_url = spec_url.clone();
        let mut error = error;
        if container.is_none() {
            return;
        }
        if mounted() && last_spec().as_ref() == Some(&spec_url) {
            return;
        }
        mounted.set(true);
        last_spec.set(Some(spec_url.clone()));
        if let Some(container) = container {
            spawn(async move {
                if let Err(message) = ensure_assets().await {
                    error.set(Some(message));
                    return;
                }
                if let Err(message) = mount_swagger(&container, &spec_url) {
                    error.set(Some(message));
                }
            });
        }
    });

    rsx! {
        if let Some(message) = error() {
            p { class: "tool-error", "{message}" }
        }
        div {
            class: "swagger-embed swagger-ui",
            onmounted: move |event| {
                let element = event.data.as_ref().as_web_event();
                container.set(Some(element));
            }
        }
    }
}

async fn ensure_assets() -> Result<(), String> {
    ensure_stylesheet(SWAGGER_CSS_URL)?;
    ensure_script(SWAGGER_BUNDLE_URL).await?;
    ensure_script(SWAGGER_PRESET_URL).await?;
    Ok(())
}

fn ensure_stylesheet(href: &str) -> Result<(), String> {
    let document = web_sys::window()
        .and_then(|window| window.document())
        .ok_or("Document unavailable")?;

    let selector = format!("link[data-swagger-ui=\"{href}\"]");
    if let Ok(Some(_)) = document.query_selector(&selector) {
        return Ok(());
    }

    let link = document
        .create_element("link")
        .map_err(|_| "Stylesheet creation failed")?;
    link.set_attribute("rel", "stylesheet")
        .map_err(|_| "Stylesheet rel failed")?;
    link.set_attribute("href", href)
        .map_err(|_| "Stylesheet href failed")?;
    link.set_attribute("data-swagger-ui", href)
        .map_err(|_| "Stylesheet data attr failed")?;
    document
        .head()
        .ok_or("Document head missing")?
        .append_child(&link)
        .map_err(|_| "Stylesheet append failed")?;
    Ok(())
}

async fn ensure_script(src: &str) -> Result<(), String> {
    let document = web_sys::window()
        .and_then(|window| window.document())
        .ok_or("Document unavailable")?;

    let selector = format!("script[data-swagger-ui=\"{src}\"]");
    if let Ok(Some(_)) = document.query_selector(&selector) {
        return Ok(());
    }

    let script = document
        .create_element("script")
        .map_err(|_| "Script creation failed")?
        .dyn_into::<web_sys::HtmlScriptElement>()
        .map_err(|_| "Script cast failed")?;
    script.set_src(src);
    script.set_defer(true);
    script
        .set_attribute("data-swagger-ui", src)
        .map_err(|_| "Script data attr failed")?;

    let promise = js_sys::Promise::new(&mut |resolve, reject| {
        let resolve = resolve.clone();
        let reject = reject.clone();

        let onload = Closure::once(move || {
            let _ = resolve.call0(&wasm_bindgen::JsValue::NULL);
        });
        let onerror = Closure::once(move || {
            let _ = reject.call0(&wasm_bindgen::JsValue::NULL);
        });
        script.set_onload(Some(onload.as_ref().unchecked_ref()));
        script.set_onerror(Some(onerror.as_ref().unchecked_ref()));
        onload.forget();
        onerror.forget();
    });

    document
        .body()
        .ok_or("Document body missing")?
        .append_child(&script)
        .map_err(|_| "Script append failed")?;

    wasm_bindgen_futures::JsFuture::from(promise)
        .await
        .map_err(|_| "Script load failed".to_string())?;
    Ok(())
}

fn mount_swagger(container: &web_sys::Element, spec_url: &str) -> Result<(), String> {
    container.set_inner_html("");

    let window = web_sys::window().ok_or("Window unavailable")?;
    let bundle = js_sys::Reflect::get(&window, &wasm_bindgen::JsValue::from_str("SwaggerUIBundle"))
        .map_err(|_| "SwaggerUIBundle missing")?;
    let bundle_fn = bundle
        .dyn_into::<js_sys::Function>()
        .map_err(|_| "SwaggerUIBundle invalid")?;

    let config = js_sys::Object::new();
    js_sys::Reflect::set(&config, &"domNode".into(), container)
        .map_err(|_| "Config domNode failed")?;
    js_sys::Reflect::set(&config, &"url".into(), &spec_url.into())
        .map_err(|_| "Config url failed")?;
    js_sys::Reflect::set(&config, &"deepLinking".into(), &false.into())
        .map_err(|_| "Config deepLinking failed")?;
    js_sys::Reflect::set(&config, &"docExpansion".into(), &"list".into())
        .map_err(|_| "Config docExpansion failed")?;
    js_sys::Reflect::set(&config, &"layout".into(), &"StandaloneLayout".into())
        .map_err(|_| "Config layout failed")?;

    let presets = js_sys::Array::new();
    if let Ok(bundle_presets) = js_sys::Reflect::get(&bundle_fn, &"presets".into()) {
        if let Ok(apis) = js_sys::Reflect::get(&bundle_presets, &"apis".into()) {
            presets.push(&apis);
        }
    }
    if let Ok(standalone) =
        js_sys::Reflect::get(&window, &wasm_bindgen::JsValue::from_str("SwaggerUIStandalonePreset"))
    {
        presets.push(&standalone);
    }
    if presets.length() > 0 {
        js_sys::Reflect::set(&config, &"presets".into(), &presets)
            .map_err(|_| "Config presets failed")?;
    }

    bundle_fn
        .call1(&wasm_bindgen::JsValue::NULL, &config)
        .map_err(|_| "SwaggerUIBundle call failed")?;
    Ok(())
}
