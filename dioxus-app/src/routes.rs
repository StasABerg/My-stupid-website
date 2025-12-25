use dioxus::prelude::*;
use dioxus_router::{Link, Routable, Router};
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;

use crate::blog::{BlogPage, BlogPostPage};
use crate::config::use_runtime_config;
use crate::contact::ContactPage;
use crate::cookie_consent::CookieConsentBanner;
use crate::date::ls_date_now;
use crate::do_nothing::DoNothingGamePage;
use crate::howto::{HowToIndexPage, HowToTopicPage};
#[cfg(feature = "server")]
use crate::howto::how_to_topics;
use crate::posts::{all_posts, format_ls_date};
use crate::radio::RadioPage;
use crate::swagger::SwaggerEmbed;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};
use crate::terminal_shell::TerminalPage;
use crate::tools::{ImageToAsciiPage, WebToMarkdownPage};

#[cfg(target_arch = "wasm32")]
struct IntervalHandle {
    id: i32,
    _closure: Rc<wasm_bindgen::closure::Closure<dyn FnMut()>>,
}

#[component]
pub fn App() -> Element {
    let config_resource = use_runtime_config();
    let config = match config_resource() {
        None => {
            return rsx! {
                document::Title { "Gitgud Blog" }
                div { class: "page loading",
                    h1 { "Loading config..." }
                }
            }
        }
        Some(Ok(config)) => config,
        Some(Err(message)) => {
            return rsx! {
                document::Title { "Gitgud Blog" }
                div { class: "page loading",
                    h1 { "Config load failed" }
                    p { "{message}" }
                }
            }
        }
    };

    use_context_provider(|| config);

    #[cfg(target_arch = "wasm32")]
    {
        let mut sw_registered = use_signal(|| false);
        use_effect(move || {
            if sw_registered() {
                return;
            }
            sw_registered.set(true);
            register_service_worker();
        });
    }

    rsx! {
        document::Link {
            rel: "icon",
            r#type: "image/x-icon",
            href: asset!("/assets/favicon.ico"),
        }
        document::Link { rel: "manifest", href: "/manifest.webmanifest" }
        document::Link { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }
        document::Meta { name: "theme-color", content: "#0bff96" }
        document::Meta { name: "author", content: "StasBerg" }
        script {
            src: "https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.light.min.js",
            defer: true,
        }
        main { id: "main-content",
            Router::<Route> {}
        }
        CookieConsentBanner {}
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

#[cfg(feature = "server")]
#[server(endpoint = "static_routes", output = server_fn::codec::Json)]
async fn static_routes() -> Result<Vec<String>, ServerFnError> {
    let mut routes: Vec<String> = Route::static_routes()
        .iter()
        .map(ToString::to_string)
        .collect();

    for post in all_posts() {
        routes.push(
            Route::BlogPost {
                slug: post.slug.to_string(),
            }
            .to_string(),
        );
    }

    for topic in how_to_topics() {
        routes.push(
            Route::HowToTopic {
                topic: topic.slug().to_string(),
            }
            .to_string(),
        );
    }

    routes.sort();
    routes.dedup();
    Ok(routes)
}

#[component]
fn Home() -> Element {
    let today_label = ls_date_now();
    let mut latest_posts = all_posts();
    latest_posts.truncate(5);
    rsx! {
        document::Title { "Gitgud Blog" }
        document::Meta { name: "description", content: "Gitgud Blog" }
        document::Meta { property: "og:title", content: "Gitgud Blog" }
        document::Meta { property: "og:description", content: "Some weird project" }
        document::Meta { property: "og:type", content: "website" }
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
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Documents {}, class: "text-terminal-magenta", "documents/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Games {}, class: "text-terminal-magenta", "games/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Radio {}, class: "text-terminal-magenta", "radio/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Blog {}, class: "text-terminal-magenta", "blog/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Contact {}, class: "text-terminal-magenta", "contact/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Motivation {}, class: "text-terminal-magenta", "motivation?/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Tools {}, class: "text-terminal-magenta", "tools/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Terminal {}, class: "text-terminal-magenta", "ssh-sandbox/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::Swagger {}, class: "text-terminal-magenta", "swagger/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr-xr-x 2 user user 4096 {today_label} " }
                                Link { to: Route::HowToIndex {}, class: "text-terminal-magenta", "how-to/" }
                            }
                            p { class: "text-terminal-cyan",
                                span { class: "text-terminal-white terminal-desktop-only", "drwxr----- 2 root root 1337 {today_label} " }
                                Link { to: Route::Konami {}, class: "text-terminal-yellow", ".secrets/" }
                            }
                        }
                    }
                    if !latest_posts.is_empty() {
                        TerminalPrompt { command: Some("tail -n 5 blog/latest.log".to_string()), children: rsx! {} }
                        div { class: "terminal-list terminal-stack",
                            for post in latest_posts.iter() {
                                p { key: "{post.slug}", class: "terminal-listing terminal-wrap",
                                    span { class: "text-terminal-white terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {format_ls_date(post.date)} " }
                                    Link { to: Route::BlogPost { slug: post.slug.to_string() }, class: "text-terminal-cyan", "{post.slug}" }
                                    span { class: "text-terminal-green terminal-inline terminal-indent", "# {post.excerpt}" }
                                }
                            }
                        }
                    }
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

#[component]
fn Documents() -> Element {
    let today_label = ls_date_now();
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Documents page".to_string()),
                TerminalHeader { display_cwd: "~/documents".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/documents".to_string()), command: Some("ls -la".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack",
                        nav { aria_label: "Document links",
                            p { class: "terminal-listing",
                                span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 1024 {today_label} " }
                                a {
                                    href: "https://forgejo.gitgud.zip/stasaberg/My-stupid-website",
                                    target: "_blank",
                                    rel: "noopener noreferrer",
                                    class: "terminal-link text-terminal-cyan",
                                    "Github"
                                }
                            }
                            p { class: "terminal-listing",
                                span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 1024 {today_label} " }
                                a {
                                    href: "https://linkedin.com/in/stasaberg",
                                    target: "_blank",
                                    rel: "noopener noreferrer",
                                    class: "terminal-link text-terminal-cyan",
                                    "Linkedin"
                                }
                            }
                        }
                    }
                    TerminalPrompt {
                        path: Some("~/documents".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/documents".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn Games() -> Element {
    let today_label = ls_date_now();
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Games page".to_string()),
                TerminalHeader { display_cwd: "~/games".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/games".to_string()), command: Some("ls -la".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack",
                        nav { aria_label: "Games list",
                            p { class: "terminal-listing",
                                span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rwxr-xr-x 1 user user 2048 {today_label} " }
                                Link { to: Route::DoNothingGame {}, class: "terminal-link text-terminal-green", "do-nothing" }
                            }
                        }
                    }
                    TerminalPrompt {
                        path: Some("~/games".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/games".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn DoNothingGame() -> Element {
    rsx! { DoNothingGamePage {} }
}

#[component]
fn Terminal() -> Element {
    rsx! { TerminalPage {} }
}

#[component]
fn TerminalDocs() -> Element {
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Terminal docs".to_string()),
                TerminalHeader { display_cwd: "~/swagger/terminal".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        user: Some("sandbox".to_string()),
                        host: Some("gitgud.zip".to_string()),
                        path: Some("~/swagger/terminal".to_string()),
                        children: rsx! { Link { to: Route::Swagger {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    div { class: "swagger-shell",
                        SwaggerEmbed { spec_url: "/api/terminal/docs/json".to_string() }
                    }
                }
            }
        }
    }
}

#[component]
fn Radio() -> Element {
    rsx! { RadioPage {} }
}

#[component]
fn Blog() -> Element {
    rsx! { BlogPage {} }
}

#[component]
fn BlogPost(slug: String) -> Element {
    rsx! { BlogPostPage { slug } }
}

#[component]
fn RadioDocs() -> Element {
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Radio docs".to_string()),
                TerminalHeader { display_cwd: "~/swagger/radio".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        user: Some("sandbox".to_string()),
                        host: Some("gitgud.zip".to_string()),
                        path: Some("~/swagger/radio".to_string()),
                        children: rsx! { Link { to: Route::Swagger {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    div { class: "swagger-shell",
                        SwaggerEmbed { spec_url: "/api/radio/docs/json".to_string() }
                    }
                }
            }
        }
    }
}

#[component]
fn GatewayDocs() -> Element {
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Gateway docs".to_string()),
                TerminalHeader { display_cwd: "~/swagger/gateway".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        user: Some("sandbox".to_string()),
                        host: Some("gitgud.zip".to_string()),
                        path: Some("~/swagger/gateway".to_string()),
                        children: rsx! { Link { to: Route::Swagger {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    div { class: "swagger-shell",
                        SwaggerEmbed { spec_url: "/api/docs/json".to_string() }
                    }
                }
            }
        }
    }
}

#[component]
fn Swagger() -> Element {
    let today_label = ls_date_now();
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Swagger directory".to_string()),
                TerminalHeader { display_cwd: "~/swagger".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/swagger".to_string()), command: Some("ls -la".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack",
                        div { class: "terminal-listing",
                            span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                            Link { to: Route::RadioDocs {}, class: "terminal-link text-terminal-cyan", "radio-api" }
                            span { class: "text-terminal-green terminal-inline terminal-indent", "# Swagger UI for the Radio service" }
                        }
                        div { class: "terminal-listing",
                            span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                            Link { to: Route::TerminalDocs {}, class: "terminal-link text-terminal-cyan", "terminal-api" }
                            span { class: "text-terminal-green terminal-inline terminal-indent", "# Swagger UI for the Terminal service" }
                        }
                        div { class: "terminal-listing",
                            span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                            Link { to: Route::GatewayDocs {}, class: "terminal-link text-terminal-cyan", "gateway-api" }
                            span { class: "text-terminal-green terminal-inline terminal-indent", "# Swagger UI for the API Gateway" }
                        }
                    }
                    TerminalPrompt {
                        path: Some("~/swagger".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/swagger".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn Konami() -> Element {
    let origin = current_origin();
    let embed_url = format!("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&loop=1&playlist=dQw4w9WgXcQ&controls=0&modestbranding=1&rel=0&origin={origin}&playsinline=1&mute=0");
    rsx! {
        document::Title { "Konami Override" }
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Konami transmission".to_string()),
                TerminalHeader { display_cwd: "~/secrets/konami".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { command: Some("cat transmission.log".to_string()), children: rsx! {} }
                    p { class: "text-terminal-cyan", "Access granted. Loading clandestine transmission…" }
                    div { class: "terminal-video",
                        iframe {
                            title: "Konami Transmission",
                            src: "{embed_url}",
                            allow: "autoplay; encrypted-media; picture-in-picture",
                            referrerpolicy: "strict-origin-when-cross-origin",
                            allowfullscreen: "true"
                        }
                    }
                    p { class: "terminal-muted",
                        "Transmission locked in faux-terminal safe mode. Mobile browsers may require a tap before sound kicks in. If the player refuses to cooperate, "
                        a {
                            href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL4fGSI1pDJn63Ntl9x_AcwIJ7bB8uW7VY&index=1",
                            target: "_blank",
                            rel: "noopener noreferrer",
                            class: "terminal-link text-terminal-yellow",
                            "watch it directly on YouTube"
                        }
                        "."
                    }
                    TerminalPrompt {
                        path: Some("~/secrets/konami".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/secrets/konami".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn Privacy() -> Element {
    rsx! {
        document::Title { "Privacy & Cookies | My Stupid Website" }
        document::Meta { name: "description", content: "How we handle analytics, cookies, and consent on gitgud." }
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Privacy and cookies".to_string()),
                TerminalHeader { display_cwd: "~/privacy".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { command: Some("cat privacy.md".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack",
                        p { class: "terminal-muted",
                            "This site keeps tracking minimal. We only run basic analytics through Cloudflare Zaraz, and only after you choose to allow it. No ads, no cross-site profiling."
                        }
                        div { class: "terminal-stack",
                            p { class: "text-terminal-green terminal-title", "What we collect" }
                            ul { class: "terminal-list-bullets",
                                li { "Page views and simple engagement events (for performance and content insights)." }
                                li { "Standard request metadata (IP, user agent) may be processed by our providers to keep the service secure, but we do not build visitor profiles." }
                            }
                        }
                        div { class: "terminal-stack",
                            p { class: "text-terminal-green terminal-title", "Cookies" }
                            ul { class: "terminal-list-bullets",
                                li { "`zaraz-consent` — stores whether you accepted or rejected analytics. Lifetime: 12 months or until you clear it." }
                                li { "No other consent or marketing cookies are set by this site." }
                            }
                        }
                        div { class: "terminal-stack",
                            p { class: "text-terminal-green terminal-title", "Change your choice" }
                            button {
                                r#type: "button",
                                class: "terminal-button",
                                onclick: move |_| reopen_consent_banner(),
                                "Reopen cookie banner"
                            }
                            p { class: "terminal-muted",
                                "You can also clear the `zaraz-consent` cookie in your browser settings to be asked again on your next visit."
                            }
                        }
                    }
                    TerminalPrompt { path: Some("~/privacy".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn Contact() -> Element {
    rsx! { ContactPage {} }
}

#[component]
fn Motivation() -> Element {
    let today_label = ls_date_now();
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Motivation terminal".to_string()),
                TerminalHeader { display_cwd: "~/motivation?".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { command: Some("ls -la ./motivation?".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack",
                        p { class: "terminal-listing",
                            span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                            Link { to: Route::GitGud {}, class: "terminal-link text-terminal-cyan", "gitgud" }
                            span { class: "text-terminal-green terminal-inline terminal-indent", "# Run the impossible progress bar" }
                        }
                        p { class: "terminal-listing",
                            span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                            Link { to: Route::Begud {}, class: "terminal-link text-terminal-cyan", "begud" }
                            span { class: "text-terminal-green terminal-inline terminal-indent", "# Rotate reminders; pretend it helps" }
                        }
                    }
                    TerminalPrompt { command: Some("cat README.motivation".to_string()), children: rsx! {} }
                    p { class: "terminal-muted", "Choose your poison. Both routes update morale by ±0.00%." }
                    TerminalPrompt {
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                }
            }
        }
    }
}

#[component]
fn Begud() -> Element {
    const INSULTS: &[&str] = &[
        "Push harder. Git Gud.",
        "Logs don't read themselves.",
        "If kubectl apply failed, so did you.",
        "Backups are for cowards who plan ahead.",
        "Alerts are love letters from production. Answer them.",
        "Latency is just procrastination measured in ms.",
    ];
    let index = use_signal(|| 0usize);
    #[cfg(target_arch = "wasm32")]
    {
        let mut interval_handle = use_signal(|| None::<IntervalHandle>);
        use_effect(move || {
            use wasm_bindgen::closure::Closure;
            use wasm_bindgen::JsCast;

            if interval_handle.read().is_some() {
                return;
            }
            let Some(window) = web_sys::window() else {
                return;
            };
            let mut interval_index = index;
            let closure = Rc::new(Closure::wrap(Box::new(move || {
                let next = (interval_index() + 1) % INSULTS.len();
                interval_index.set(next);
            }) as Box<dyn FnMut()>));
            if let Ok(id) = window.set_interval_with_callback_and_timeout_and_arguments_0(
                closure.as_ref().as_ref().unchecked_ref(),
                2800,
            ) {
                interval_handle.set(Some(IntervalHandle {
                    id,
                    _closure: closure,
                }));
            }
        });

        let interval_handle = interval_handle;
        use_drop(move || {
            if let Some(handle) = interval_handle.read().as_ref() {
                if let Some(window) = web_sys::window() {
                    window.clear_interval_with_handle(handle.id);
                }
            }
        });
    }

    let message = INSULTS[index() % INSULTS.len()];
    rsx! {
        document::Title { "Be Gud Training" }
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("BeGud training terminal".to_string()),
                TerminalHeader { display_cwd: "~/begud".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { command: Some("watch -n2 /var/log/begud.log".to_string()), children: rsx! {} }
                    div { class: "terminal-stack",
                        p { class: "text-terminal-cyan", "live feed" }
                        p { class: "text-terminal-yellow", "{message}" }
                        p { class: "terminal-faint", "Tip: repetition is a feature, not a bug." }
                    }
                    div { class: "terminal-stack terminal-muted",
                        p { class: "text-terminal-cyan", "training checklist" }
                        ul { class: "terminal-list-plain",
                            li { "[ ] acknowledge paging noises" }
                            li { "[ ] drink water between deploys" }
                            li { "[ ] pretend to enjoy postmortems" }
                            li { "[ ] rerun tests you forgot" }
                            li { "[ ] blame cache last" }
                        }
                    }
                    div { class: "terminal-stack",
                        TerminalPrompt { command: Some("echo \"discipline > motivation\"".to_string()), children: rsx! {} }
                        p { class: "terminal-faint", "neurons recalibrating" span { class: "terminal-cursor text-terminal-white", "█" } }
                    }
                    TerminalPrompt {
                        path: Some("~/begud".to_string()),
                        children: rsx! { Link { to: Route::GitGud {}, class: "terminal-link text-terminal-cyan", "cd /gitgud" } }
                    }
                    TerminalPrompt {
                        path: Some("~/begud".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/begud".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn GitGud() -> Element {
    let progress = use_signal(|| 0.0f64);
    #[cfg(target_arch = "wasm32")]
    {
        let mut interval_handle = use_signal(|| None::<IntervalHandle>);
        use_effect(move || {
            use wasm_bindgen::closure::Closure;
            use wasm_bindgen::JsCast;

            if interval_handle.read().is_some() {
                return;
            }
            let Some(window) = web_sys::window() else {
                return;
            };
            let mut progress_signal = progress;
            let closure = Rc::new(Closure::wrap(Box::new(move || {
                let next = progress_signal() + random_increment();
                let clamped = if next > 98.0 { 42.0 } else { next };
                progress_signal.set(clamped);
            }) as Box<dyn FnMut()>));
            if let Ok(id) = window.set_interval_with_callback_and_timeout_and_arguments_0(
                closure.as_ref().as_ref().unchecked_ref(),
                800,
            ) {
                interval_handle.set(Some(IntervalHandle {
                    id,
                    _closure: closure,
                }));
            }
        });

        let interval_handle = interval_handle;
        use_drop(move || {
            if let Some(handle) = interval_handle.read().as_ref() {
                if let Some(window) = web_sys::window() {
                    window.clear_interval_with_handle(handle.id);
                }
            }
        });
    }

    let text_bar = build_progress_bar(progress());
    rsx! {
        document::Title { "Git Gud Sequence" }
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("GitGud training terminal".to_string()),
                TerminalHeader { display_cwd: "~/gitgud".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { command: Some("git gud --run --mode=montage".to_string()), children: rsx! {} }
                    div { class: "terminal-stack",
                        p { class: "text-terminal-cyan", "status feed" }
                        p { class: "text-terminal-green", "{text_bar}" }
                        p { class: "terminal-muted", "Compilation of life choices in progress… reaching 100% is intentionally impossible." }
                        p { class: "terminal-muted", "stage: training_loop · mood: resigned optimism · operator: you" }
                    }
                    TerminalPrompt { command: Some("tail -f /var/log/gitgud.log".to_string()), children: rsx! {} }
                    div { class: "terminal-stack terminal-muted",
                        p { "[ok] linked caffeine to build pipeline" }
                        p { "[warn] impostor syndrome rising; ignoring for now" }
                        p { "[info] rerouting patience to /dev/null" }
                    }
                    div { class: "terminal-stack",
                        TerminalPrompt { command: Some("watch progress".to_string()), children: rsx! {} }
                        p { class: "terminal-faint", "█ recalculating destiny " span { class: "terminal-cursor text-terminal-white", "█" } }
                    }
                    TerminalPrompt {
                        path: Some("~/gitgud".to_string()),
                        children: rsx! { Link { to: Route::Begud {}, class: "terminal-link text-terminal-cyan", "cd /begud" } }
                    }
                    TerminalPrompt {
                        path: Some("~/gitgud".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { path: Some("~/gitgud".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn HowToIndex() -> Element {
    rsx! { HowToIndexPage {} }
}

#[component]
fn HowToTopic(topic: String) -> Element {
    rsx! { HowToTopicPage { topic } }
}

#[component]
fn Tools() -> Element {
    let today_label = ls_date_now();
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Tools page".to_string()),
                TerminalHeader { display_cwd: "~/tools".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! { Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." } }
                    }
                    TerminalPrompt { command: Some("ls -la ./tools".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack",
                        p { class: "terminal-listing",
                            span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                            Link { to: Route::WebToMarkdown {}, class: "terminal-link text-terminal-cyan", "web-to-markdown" }
                            span { class: "text-terminal-green terminal-inline terminal-indent", "# Fetch a URL and output markdown" }
                        }
                        p { class: "terminal-listing",
                            span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                            Link { to: Route::ImageToAscii {}, class: "terminal-link text-terminal-cyan", "image-to-ascii" }
                            span { class: "text-terminal-green terminal-inline terminal-indent", "# Local-only ASCII conversion" }
                        }
                    }
                    TerminalPrompt { path: Some("~/tools".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}

#[component]
fn WebToMarkdown() -> Element {
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Web to Markdown".to_string()),
                TerminalHeader { display_cwd: "~/tools/web-to-markdown".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~/tools".to_string()),
                        children: rsx! { Link { to: Route::Tools {}, class: "terminal-link text-terminal-yellow", "cd ../tools" } }
                    }
                    WebToMarkdownPage {}
                }
            }
        }
    }
}

#[component]
fn ImageToAscii() -> Element {
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Image to ASCII".to_string()),
                TerminalHeader { display_cwd: "~/tools/image-to-ascii".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~/tools".to_string()),
                        children: rsx! { Link { to: Route::Tools {}, class: "terminal-link text-terminal-yellow", "cd ../tools" } }
                    }
                    ImageToAsciiPage {}
                }
            }
        }
    }
}

#[component]
fn NotFound(route: Vec<String>) -> Element {
    let _path = route.join("/");
    let mut show_modal = use_signal(random_modal_choice);
    let gif_src = use_signal(random_access_denied_gif);
    rsx! {
        document::Title { "Not Found | My Stupid Website" }
        div { class: "notfound",
            div {
                class: if show_modal() { "notfound-card dimmed" } else { "notfound-card" },
                aria_hidden: if show_modal() { "true" } else { "false" },
                p { class: "notfound-kicker text-terminal-cyan", "404 // ACCESS LOST" }
                h1 { class: "text-terminal-yellow", "Directory not found" }
                p { class: "notfound-sub", "The file system refuses your request." }
                Link { to: Route::Home {}, class: "terminal-link text-terminal-cyan", "Return to Home" }
            }
            if show_modal() {
                div { class: "notfound-overlay",
                    div { class: "notfound-modal",
                        p { class: "notfound-modal-text", "Access denied. Security is reviewing this incident." }
                        div { class: "notfound-gif-frame",
                            img { src: "{gif_src}", alt: "Access denied meme" }
                        }
                        button {
                            r#type: "button",
                            class: "notfound-button text-terminal-yellow",
                            onclick: move |_| show_modal.set(false),
                            "I Understand"
                        }
                    }
                }
            }
        }
    }
}

fn reopen_consent_banner() {
    #[cfg(target_arch = "wasm32")]
    {
        if let Some(window) = web_sys::window() {
            if let Some(document) = window.document() {
                if let Ok(event) = web_sys::Event::new("openCookieConsentBar") {
                    let _ = document.dispatch_event(&event);
                }
            }
        }
    }
}

fn current_origin() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        if let Some(window) = web_sys::window() {
            if let Ok(origin) = window.location().origin() {
                return origin;
            }
        }
    }
    "https://gitgud.zip".to_string()
}

fn build_progress_bar(progress: f64) -> String {
    let total = 36;
    let clamped = clamp_percent(progress);
    let filled = ((clamped as f64 / 100.0) * total as f64).round() as usize;
    let filled = filled.min(total);
    format!(
        "[{}{}] {}%",
        "#".repeat(filled),
        ".".repeat(total - filled),
        clamped
    )
}

fn clamp_percent(value: f64) -> u32 {
    let value = value.round().clamp(0.0, 100.0);
    value as u32
}

fn random_modal_choice() -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Math::random() < 0.5
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        false
    }
}

fn random_access_denied_gif() -> String {
    const GIFS: [&str; 2] = [
        "/easter-eggs/access-denied-1.gif",
        "/easter-eggs/access-denied-2.gif",
    ];
    #[cfg(target_arch = "wasm32")]
    {
        let idx = (js_sys::Math::random() * GIFS.len() as f64).floor() as usize;
        GIFS[idx.min(GIFS.len() - 1)].to_string()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        GIFS[0].to_string()
    }
}

#[cfg(target_arch = "wasm32")]
fn random_increment() -> f64 {
    js_sys::Math::random() * 8.0
}
