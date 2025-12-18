use dioxus::prelude::*;
use dioxus_router::{Link, Routable, Router};

use crate::config::{use_runtime_config, RuntimeConfig};
use crate::radio::RadioPage;
use crate::tools::WebToMarkdownPage;

const FAVICON: Asset = asset!("/assets/favicon.ico");
const MAIN_CSS: Asset = asset!("/assets/main.css");

#[component]
pub fn App() -> Element {
    let config_resource = use_runtime_config();
    let config = match config_resource() {
        None => {
            return rsx! {
                document::Title { "gitgud.zip" }
                div { class: "page loading",
                    h1 { "Loading config..." }
                }
            }
        }
        Some(Ok(config)) => config,
        Some(Err(message)) => {
            return rsx! {
                document::Title { "gitgud.zip" }
                div { class: "page loading",
                    h1 { "Config load failed" }
                    p { "{message}" }
                }
            }
        }
    };

    use_context_provider(|| config);

    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "stylesheet", href: MAIN_CSS }
        script {
            src: "https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.light.min.js",
            defer: true,
        }
        Router::<Route> {}
    }
}

#[derive(Clone, PartialEq, Routable)]
pub enum Route {
    #[route("/")]
    Home {},
    #[route("/documents")]
    Documents {},
    #[route("/games")]
    Games {},
    #[route("/games/do-nothing")]
    DoNothingGame {},
    #[route("/terminal")]
    Terminal {},
    #[route("/terminal/docs")]
    TerminalDocs {},
    #[route("/radio")]
    Radio {},
    #[route("/blog")]
    Blog {},
    #[route("/blog/:slug")]
    BlogPost { slug: String },
    #[route("/radio/docs")]
    RadioDocs {},
    #[route("/gateway/docs")]
    GatewayDocs {},
    #[route("/swagger")]
    Swagger {},
    #[route("/konami")]
    Konami {},
    #[route("/privacy")]
    Privacy {},
    #[route("/contact")]
    Contact {},
    #[route("/motivation")]
    Motivation {},
    #[route("/begud")]
    Begud {},
    #[route("/gitgud")]
    GitGud {},
    #[route("/how-to")]
    HowToIndex {},
    #[route("/how-to/:topic")]
    HowToTopic { topic: String },
    #[route("/tools")]
    Tools {},
    #[route("/tools/web-to-markdown")]
    WebToMarkdown {},
    #[route("/tools/image-to-ascii")]
    ImageToAscii {},
    #[route("/:..route")]
    NotFound { route: Vec<String> },
}

#[component]
fn PageShell(title: String, children: Element) -> Element {
    rsx! {
        div { class: "page",
            SiteNav {}
            header { class: "page-header",
                h1 { "{title}" }
            }
            main { class: "page-body",
                {children}
            }
        }
    }
}

#[component]
fn SiteNav() -> Element {
    rsx! {
        nav { class: "site-nav",
            Link { to: Route::Home {}, "home" }
            Link { to: Route::Radio {}, "radio" }
            Link { to: Route::Tools {}, "tools" }
            Link { to: Route::Swagger {}, "docs" }
        }
    }
}

#[component]
fn Home() -> Element {
    let config = use_context::<RuntimeConfig>();
    rsx! {
        PageShell { title: "home",
            p { "Dioxus migration in progress." }
            p { "radio api: {config.radio_api_base_url}" }
            p { "terminal api: {config.terminal_api_base_url}" }
            p { "gateway api: {config.gateway_api_base_url}" }
        }
    }
}

#[component]
fn Documents() -> Element {
    rsx! { PageShell { title: "documents",
        p { "Placeholder." }
    } }
}

#[component]
fn Games() -> Element {
    rsx! { PageShell { title: "games",
        p { "Placeholder." }
    } }
}

#[component]
fn DoNothingGame() -> Element {
    rsx! { PageShell { title: "do-nothing",
        p { "Placeholder." }
    } }
}

#[component]
fn Terminal() -> Element {
    rsx! { PageShell { title: "terminal",
        p { "Placeholder." }
    } }
}

#[component]
fn TerminalDocs() -> Element {
    rsx! { PageShell { title: "terminal docs",
        p { "Placeholder." }
    } }
}

#[component]
fn Radio() -> Element {
    rsx! { PageShell { title: "radio",
        RadioPage {}
    } }
}

#[component]
fn Blog() -> Element {
    rsx! { PageShell { title: "blog",
        p { "Placeholder." }
    } }
}

#[component]
fn BlogPost(slug: String) -> Element {
    rsx! { PageShell { title: "blog",
        p { "Post: {slug}" }
    } }
}

#[component]
fn RadioDocs() -> Element {
    rsx! { PageShell { title: "radio docs",
        p { "Placeholder." }
    } }
}

#[component]
fn GatewayDocs() -> Element {
    rsx! { PageShell { title: "gateway docs",
        p { "Placeholder." }
    } }
}

#[component]
fn Swagger() -> Element {
    rsx! { PageShell { title: "swagger",
        p { "Placeholder." }
    } }
}

#[component]
fn Konami() -> Element {
    rsx! { PageShell { title: "konami",
        p { "Placeholder." }
    } }
}

#[component]
fn Privacy() -> Element {
    rsx! { PageShell { title: "privacy",
        p { "Placeholder." }
    } }
}

#[component]
fn Contact() -> Element {
    rsx! { PageShell { title: "contact",
        p { "Placeholder." }
    } }
}

#[component]
fn Motivation() -> Element {
    rsx! { PageShell { title: "motivation",
        p { "Placeholder." }
    } }
}

#[component]
fn Begud() -> Element {
    rsx! { PageShell { title: "begud",
        p { "Placeholder." }
    } }
}

#[component]
fn GitGud() -> Element {
    rsx! { PageShell { title: "gitgud",
        p { "Placeholder." }
    } }
}

#[component]
fn HowToIndex() -> Element {
    rsx! { PageShell { title: "how-to",
        p { "Placeholder." }
    } }
}

#[component]
fn HowToTopic(topic: String) -> Element {
    rsx! { PageShell { title: "how-to",
        p { "Topic: {topic}" }
    } }
}

#[component]
fn Tools() -> Element {
    rsx! { PageShell { title: "tools",
        ul { class: "list",
            li { Link { to: Route::WebToMarkdown {}, "Web to Markdown" } }
            li { Link { to: Route::ImageToAscii {}, "Image to ASCII" } }
        }
    } }
}

#[component]
fn WebToMarkdown() -> Element {
    rsx! { PageShell { title: "web to markdown",
        WebToMarkdownPage {}
    } }
}

#[component]
fn ImageToAscii() -> Element {
    rsx! { PageShell { title: "image to ascii",
        p { "Placeholder." }
    } }
}

#[component]
fn NotFound(route: Vec<String>) -> Element {
    let path = route.join("/");
    rsx! { PageShell { title: "not found",
        p { "Missing: /{path}" }
    } }
}
