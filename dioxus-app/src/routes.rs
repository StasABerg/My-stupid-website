use dioxus::prelude::*;
use dioxus_router::{Link, Routable, Router};

use crate::config::use_runtime_config;
use crate::radio::RadioPage;
use crate::swagger::SwaggerEmbed;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};
use crate::tools::{ImageToAsciiPage, WebToMarkdownPage};

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

    #[cfg(target_arch = "wasm32")]
    use_effect(register_service_worker);

    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "stylesheet", href: MAIN_CSS }
        document::Link { rel: "manifest", href: "/manifest.webmanifest" }
        document::Meta { name: "theme-color", content: "#0bff96" }
        script {
            src: "https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.light.min.js",
            defer: true,
        }
        Router::<Route> {}
    }
}

#[cfg(target_arch = "wasm32")]
fn register_service_worker() {
    use wasm_bindgen_futures::spawn_local;
    let Some(window) = web_sys::window() else {
        return;
    };
    let navigator = window.navigator();
    if navigator.service_worker().is_undefined() {
        return;
    }
    spawn_local(async move {
        let promise = navigator.service_worker().register("/sw.js");
        let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
    });
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
    let today_label = ls_date_now();
    rsx! {
        div { class: "home",
            TerminalWindow { aria_label: Some("Gitgud terminal home".to_string()),
                TerminalHeader { display_cwd: "~".to_string(), label: None }
                div { class: "terminal-body",
                    pre { class: "logo-desktop", aria_label: "Gitgud Blog logo",
                        r#"
          ██████╗ ██╗████████╗ ██████╗ ██╗   ██╗██████╗     ██████╗ ██╗      ██████╗  ██████╗ 
         ██╔════╝ ██║╚══██╔══╝██╔════╝ ██║   ██║██╔══██╗    ██╔══██╗██║     ██╔═══██╗██╔════╝ 
         ██║  ███╗██║   ██║   ██║  ███╗██║   ██║██║  ██║    ██████╔╝██║     ██║   ██║██║  ███╗
         ██║   ██║██║   ██║   ██║   ██║██║   ██║██║  ██║    ██╔══██╗██║     ██║   ██║██║   ██║
         ╚██████╔╝██║   ██║   ╚██████╔╝╚██████╔╝██████╔╝    ██████╔╝███████╗╚██████╔╝╚██████╔╝
          ╚═════╝ ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝     ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ 
                        "#
                    }
                    pre { class: "logo-mobile", aria_label: "Gitgud folded logo",
                        r#"
          ██████╗ ██╗████████╗ ██████╗ ██╗   ██╗██████╗  
         ██╔════╝ ██║╚══██╔══╝██╔════╝ ██║   ██║██╔══██╗ 
         ██║  ███╗██║   ██║   ██║  ███╗██║   ██║██║  ██║ 
         ██║   ██║██║   ██║   ██║   ██║██║   ██║██║  ██║ 
         ╚██████╔╝██║   ██║   ╚██████╔╝╚██████╔╝██████╔╝ 
          ╚═════╝ ╚═╝   ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝  

               ██████╗ ██╗      ██████╗  ██████╗ 
               ██╔══██╗██║     ██╔═══██╗██╔════╝ 
               ██████╔╝██║     ██║   ██║██║  ███╗
               ██╔══██╗██║     ██║   ██║██║   ██║
               ██████╔╝███████╗╚██████╔╝╚██████╔╝
               ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ 
                        "#
                    }
                    TerminalPrompt { command: Some("cat welcome.txt".to_string()), children: rsx! {} }
                    div { class: "terminal-card",
                        p { "╔═══════════════════════════════════════════╗" }
                        p { "║ Welcome to my stupid website              ║" }
                        p { "║ System Status: " span { class: "text-terminal-green", "ONLINE" } "                     ║" }
                        p { "║ Security Level: " span { class: "text-terminal-cyan", "GITGUD" } "                    ║" }
                        p { "╚═══════════════════════════════════════════╝" }
                    }
                    TerminalPrompt { command: Some("ls -la /home/user".to_string()), children: rsx! {} }
                    div { class: "terminal-list",
                        nav { aria_label: "Main directories", role: "navigation",
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Documents {}, class: "text-terminal-magenta", "documents/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Games {}, class: "text-terminal-magenta", "games/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Radio {}, class: "text-terminal-magenta", "radio/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Blog {}, class: "text-terminal-magenta", "blog/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Contact {}, class: "text-terminal-magenta", "contact/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Motivation {}, class: "text-terminal-magenta", "motivation?/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Tools {}, class: "text-terminal-magenta", "tools/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Terminal {}, class: "text-terminal-magenta", "ssh-sandbox/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Swagger {}, class: "text-terminal-magenta", "swagger/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::HowToIndex {}, class: "text-terminal-magenta", "how-to/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white", "drwxr----- 2 root root 1337 {today_label} " }
                                Link { to: Route::Konami {}, class: "text-terminal-yellow", ".secrets/" }
                            }
                        }
                    }
                    TerminalPrompt { command: Some("tail -n 5 blog/latest.log".to_string()), children: rsx! {} }
                    p { class: "text-terminal-green terminal-meta", "# Blog migration pending." }
                    TerminalPrompt { command: Some("fastfetch".to_string()), children: rsx! {} }
                    pre { class: "terminal-fastfetch", aria_label: "System information",
                        r#"
        .---.
       /     \       OS: Gitgud 2025
      | O _ O |      Host: Unknown
      |   >   |      Kernel: 6.6.6
     /|  ---  |\     Uptime: 420 years, 69 days
    / \_______/ \    Shell: gitgudsh 4.2.0
   /  |  / \  |  \
  /   | /   \ |   \
      |/     \|
                        "#
                    }
                    TerminalPrompt { children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn ls_date_now() -> String {
    let date = js_sys::Date::new_0();
    let month = match date.get_month() as u32 {
        0 => "Jan",
        1 => "Feb",
        2 => "Mar",
        3 => "Apr",
        4 => "May",
        5 => "Jun",
        6 => "Jul",
        7 => "Aug",
        8 => "Sep",
        9 => "Oct",
        10 => "Nov",
        _ => "Dec",
    };
    let day = date.get_date();
    format!("{month} {day:02}")
}

#[cfg(not(target_arch = "wasm32"))]
fn ls_date_now() -> String {
    "Dec 20".to_string()
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
        div { class: "swagger-shell",
            SwaggerEmbed { spec_url: "/api/terminal/docs/json".to_string() }
        }
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
        div { class: "swagger-shell",
            SwaggerEmbed { spec_url: "/api/radio/docs/json".to_string() }
        }
    } }
}

#[component]
fn GatewayDocs() -> Element {
    rsx! { PageShell { title: "gateway docs",
        div { class: "swagger-shell",
            SwaggerEmbed { spec_url: "/api/docs/json".to_string() }
        }
    } }
}

#[component]
fn Swagger() -> Element {
    rsx! { PageShell { title: "swagger",
        ul { class: "list",
            li {
                Link { to: Route::RadioDocs {}, "radio-api" }
                span { class: "list-note", "# Swagger UI for the Radio service" }
            }
            li {
                Link { to: Route::TerminalDocs {}, "terminal-api" }
                span { class: "list-note", "# Swagger UI for the Terminal service" }
            }
            li {
                Link { to: Route::GatewayDocs {}, "gateway-api" }
                span { class: "list-note", "# Swagger UI for the API Gateway" }
            }
        }
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
        ImageToAsciiPage {}
    } }
}

#[component]
fn NotFound(route: Vec<String>) -> Element {
    let path = route.join("/");
    rsx! { PageShell { title: "not found",
        p { "Missing: /{path}" }
    } }
}
