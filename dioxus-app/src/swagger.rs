use dioxus::prelude::*;

#[cfg(target_arch = "wasm32")]
mod web {
    use super::*;
    use dioxus::web::WebEventExt;
    use wasm_bindgen::closure::Closure;
    use wasm_bindgen::JsCast;
    use wasm_bindgen::JsValue;

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
            .head()
            .ok_or("Document head missing")?
            .append_child(&script)
            .map_err(|_| "Script append failed")?;

        wasm_bindgen_futures::JsFuture::from(promise)
            .await
            .map_err(|_| "Script load failed")?;
        Ok(())
    }

    fn mount_swagger(container: &web_sys::Element, spec_url: &str) -> Result<(), String> {
        let window = web_sys::window().ok_or("Window unavailable")?;
        let swagger = js_sys::Reflect::get(&window, &JsValue::from_str("SwaggerUIBundle"))
            .map_err(|_| "SwaggerUIBundle missing")?;

        if !swagger.is_function() {
            return Err("SwaggerUIBundle not loaded".to_string());
        }

        let config = js_sys::Object::new();
        js_sys::Reflect::set(&config, &JsValue::from_str("url"), &JsValue::from_str(spec_url))
            .map_err(|_| "Swagger config url failed")?;
        js_sys::Reflect::set(&config, &JsValue::from_str("domNode"), container)
            .map_err(|_| "Swagger config dom node failed")?;
        js_sys::Reflect::set(
            &config,
            &JsValue::from_str("deepLinking"),
            &JsValue::from_bool(false),
        )
        .map_err(|_| "Swagger config deepLinking failed")?;
        js_sys::Reflect::set(
            &config,
            &JsValue::from_str("docExpansion"),
            &JsValue::from_str("list"),
        )
        .map_err(|_| "Swagger config docExpansion failed")?;
        js_sys::Reflect::set(
            &config,
            &JsValue::from_str("layout"),
            &JsValue::from_str("StandaloneLayout"),
        )
        .map_err(|_| "Swagger config layout failed")?;

        let presets = js_sys::Array::new();
        if let Ok(bundle_presets) = js_sys::Reflect::get(&swagger, &JsValue::from_str("presets"))
        {
            if !bundle_presets.is_undefined() && !bundle_presets.is_null() {
                if let Ok(apis) =
                    js_sys::Reflect::get(&bundle_presets, &JsValue::from_str("apis"))
                {
                    if !apis.is_undefined() && !apis.is_null() {
                        presets.push(&apis);
                    }
                }
            }
        }
        if let Ok(standalone) =
            js_sys::Reflect::get(&window, &JsValue::from_str("SwaggerUIStandalonePreset"))
        {
            if !standalone.is_undefined() && !standalone.is_null() {
                presets.push(&standalone);
            }
        }
        if presets.length() > 0 {
            js_sys::Reflect::set(&config, &JsValue::from_str("presets"), &presets)
                .map_err(|_| "Swagger config presets failed")?;
        }

        let function = swagger
            .dyn_into::<js_sys::Function>()
            .map_err(|_| "SwaggerUIBundle function failed")?;
        function
            .call1(&JsValue::NULL, &config)
            .map_err(|_| "Swagger mount failed")?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
pub use web::SwaggerEmbed;

#[cfg(not(target_arch = "wasm32"))]
#[component]
pub fn SwaggerEmbed(spec_url: String) -> Element {
    rsx! {
        div { class: "swagger-embed",
            p { class: "radio-muted", "Swagger UI loads in the browser." }
            a { class: "terminal-link text-terminal-cyan", href: "{spec_url}", "Open OpenAPI spec" }
        }
    }
}
