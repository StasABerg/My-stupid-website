use dioxus::prelude::*;
use dioxus_router::Link;
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;

use crate::date::ls_date_now;
use crate::routes::Route;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HowToTopic {
    slug: &'static str,
    title: &'static str,
    query: &'static str,
    description: &'static str,
}

impl HowToTopic {
    pub fn slug(&self) -> &'static str {
        self.slug
    }
}

const HOW_TO_TOPICS: &[HowToTopic] = &[
    HowToTopic {
        slug: "setup-nginx",
        title: "Configure Nginx Reverse Proxy",
        query: "how to configure nginx reverse proxy",
        description: "Virtual hosts, SSL, the works.",
    },
    HowToTopic {
        slug: "deploy-k8s",
        title: "Deploy to Kubernetes",
        query: "how to deploy to kubernetes cluster",
        description: "Because kubectl apply fixes everything.",
    },
    HowToTopic {
        slug: "roll-back",
        title: "Roll Back Deployment",
        query: "how to roll back kubernetes deployment",
        description: "Undo button for production panic.",
    },
    HowToTopic {
        slug: "monitor-prometheus",
        title: "Prometheus + Grafana Monitoring",
        query: "how to monitor services with prometheus grafana",
        description: "Dashboards or it didn't happen.",
    },
    HowToTopic {
        slug: "configure-ci",
        title: "GitHub Actions CI",
        query: "how to set up github actions ci pipeline",
        description: "Ship faster, break fewer things.",
    },
    HowToTopic {
        slug: "docker-hardening",
        title: "Harden Docker Images",
        query: "how to secure docker container image best practices",
        description: "Stop shipping root shells.",
    },
    HowToTopic {
        slug: "helm-upgrade",
        title: "Upgrade Helm Release",
        query: "how to upgrade helm release safely",
        description: "Tillers may be gone but fear remains.",
    },
    HowToTopic {
        slug: "ssl-renewal",
        title: "Renew Let's Encrypt",
        query: "how to renew letsencrypt wildcard cert",
        description: "Because certificates expire faster than coffee.",
    },
    HowToTopic {
        slug: "redis-scale",
        title: "Scale Redis",
        query: "how to scale redis cluster",
        description: "Cache harder.",
    },
    HowToTopic {
        slug: "postgres-backup",
        title: "Postgres Backups",
        query: "how to backup postgres with wal-g",
        description: "Point-in-time sanity.",
    },
    HowToTopic {
        slug: "logging-stack",
        title: "ELK Logging Stack",
        query: "how to build elk logging stack",
        description: "Kibana or chaos.",
    },
    HowToTopic {
        slug: "secret-rotation",
        title: "Rotate Kubernetes Secrets",
        query: "how to rotate kubernetes secrets",
        description: "Rotate like it's laundry day.",
    },
    HowToTopic {
        slug: "load-test",
        title: "Run k6 Load Test",
        query: "how to run k6 load test",
        description: "Break it before users do.",
    },
    HowToTopic {
        slug: "argo-rollouts",
        title: "Argo Rollouts Canary",
        query: "how to use argo rollouts canary deploy",
        description: "Sightseeing between blue and green.",
    },
    HowToTopic {
        slug: "cdn-cache",
        title: "Purge Cloudflare Cache",
        query: "how to purge cloudflare cache via api",
        description: "Because stale assets are cursed.",
    },
];

pub fn how_to_topics() -> &'static [HowToTopic] {
    HOW_TO_TOPICS
}

#[component]
pub fn HowToIndexPage() -> Element {
    let today_label = ls_date_now();
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("How-to index".to_string()),
                TerminalHeader { display_cwd: "~/briefings".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! {
                            Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." }
                        }
                    }
                    TerminalPrompt { command: Some("ls -la ./missions".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack",
                        for topic in HOW_TO_TOPICS.iter() {
                            p { key: "{topic.slug}", class: "terminal-listing",
                                span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {today_label} " }
                                Link {
                                    to: Route::HowToTopic { topic: topic.slug.to_string() },
                                    class: "terminal-link text-terminal-cyan",
                                    "{display_slug(topic.title)}"
                                }
                                span { class: "text-terminal-green terminal-inline terminal-indent", "# {topic.description}" }
                            }
                        }
                    }
                    TerminalPrompt {
                        children: rsx! {
                            Link { to: Route::Home {}, class: "terminal-link text-terminal-yellow", "cd .." }
                        }
                    }
                }
            }
        }
    }
}

fn display_slug(title: &str) -> String {
    let mut output = String::new();
    for (index, chunk) in title.split_whitespace().enumerate() {
        if index > 0 {
            output.push('-');
        }
        output.push_str(&chunk.to_lowercase());
    }
    output
}

#[cfg(target_arch = "wasm32")]
struct TimeoutHandle {
    id: i32,
    _closure: Rc<wasm_bindgen::closure::Closure<dyn FnMut()>>,
}

#[component]
pub fn HowToTopicPage(topic: String) -> Element {
    let topic_info = HOW_TO_TOPICS
        .iter()
        .find(|entry| entry.slug == topic)
        .cloned();
    #[cfg(target_arch = "wasm32")]
    let opened = use_signal(|| false);
    #[cfg(target_arch = "wasm32")]
    let timeout_handle = use_signal(|| None::<TimeoutHandle>);
    #[cfg(not(target_arch = "wasm32"))]
    let _opened = ();
    #[cfg(not(target_arch = "wasm32"))]
    let _timeout_handle = ();
    #[cfg(target_arch = "wasm32")]
    {
        use wasm_bindgen::{closure::Closure, JsCast};

        use_effect(move || {
            let Some(info) = topic_info else {
                return;
            };
            if opened() || timeout_handle.read().is_some() {
                return;
            }
            let window = web_sys::window();
            let Some(window) = window else {
                return;
            };
            let window_for_callback = window.clone();
            let query = info.query.to_string();
            let mut opened_signal = opened;
            let mut timeout_handle = timeout_handle;
            let closure = Rc::new(Closure::wrap(Box::new(move || {
                let url = format!(
                    "https://www.google.com/search?q={}",
                    urlencoding::encode(&query)
                );
                let _ = window_for_callback.open_with_url_and_target(&url, "_blank");
                opened_signal.set(true);
                timeout_handle.set(None);
            }) as Box<dyn FnMut()>));
            if let Ok(id) = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                closure.as_ref().as_ref().unchecked_ref(),
                3000,
            ) {
                timeout_handle.set(Some(TimeoutHandle {
                    id,
                    _closure: closure,
                }));
            }
        });

        use_drop(move || {
            if let Some(handle) = timeout_handle.read().as_ref() {
                if let Some(window) = web_sys::window() {
                    window.clear_timeout_with_handle(handle.id);
                }
            }
        });
    }

    match topic_info {
        None => rsx! {
            div { class: "terminal-screen",
                TerminalWindow { aria_label: Some("Missing briefing".to_string()),
                    TerminalHeader { display_cwd: "~/briefings/unknown".to_string(), label: None }
                    div { class: "terminal-body terminal-stack terminal-center",
                        TerminalPrompt { command: Some("cat missing.md".to_string()), children: rsx! {} }
                        p { class: "terminal-muted", "That topic isn't wired up yet. Check the list again." }
                        TerminalPrompt { command: Some("cd ..".to_string()), children: rsx! {} }
                        Link { to: Route::HowToIndex {}, class: "terminal-link text-terminal-cyan", "return /how-to" }
                    }
                }
            }
        },
        Some(info) => {
            let google_url = format!(
                "https://www.google.com/search?q={}",
                urlencoding::encode(info.query)
            );
            rsx! {
                div { class: "terminal-screen",
                    TerminalWindow { aria_label: Some("How-to topic".to_string()),
                        TerminalHeader { display_cwd: format!("~/briefings/{}", info.slug), label: None }
                        div { class: "terminal-body terminal-stack",
                            TerminalPrompt {
                                path: Some("~/briefings".to_string()),
                                children: rsx! {
                                    Link { to: Route::HowToIndex {}, class: "terminal-link text-terminal-yellow", "cd .." }
                                }
                            }
                            TerminalPrompt { command: Some(format!("cat {}.md", info.slug)), children: rsx! {} }
                            div { class: "terminal-stack",
                                p { class: "text-terminal-yellow terminal-title", "{info.title}" }
                                p { class: "terminal-muted", "{info.description}" }
                            }
                            TerminalPrompt { command: Some(format!("open \"{}\"", info.query)), children: rsx! {} }
                            p { class: "terminal-faint",
                                "Launching the briefing tab in 3 seconds… "
                                a {
                                    href: "{google_url}",
                                    target: "_blank",
                                    rel: "noopener noreferrer",
                                    class: "terminal-link text-terminal-yellow",
                                    "click here if nothing happens"
                                }
                                "."
                            }
                            TerminalPrompt {
                                path: Some(format!("~/briefings/{}", info.slug)),
                                children: rsx! {
                                    Link { to: Route::HowToIndex {}, class: "terminal-link text-terminal-yellow", "cd .." }
                                }
                            }
                            TerminalPrompt { path: Some(format!("~/briefings/{}", info.slug)), children: rsx! { TerminalCursor {} } }
                        }
                    }
                }
            }
        }
    }
}
