use dioxus::prelude::*;
use dioxus_router::Link;

use crate::posts::{all_posts, format_date, format_ls_date, get_post};
use crate::routes::Route;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};

#[component]
pub fn BlogPage() -> Element {
    rsx! {
        document::Title { "Blog | My Stupid Website" }
        document::Meta { name: "description", content: "Latest ramblings and updates from the Gitgud terminal." }
        BlogIndexContent {}
    }
}

#[component]
pub fn BlogIndexContent() -> Element {
    let posts = all_posts();
    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Blog index".to_string()),
                TerminalHeader { display_cwd: "~/blog".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~".to_string()),
                        children: rsx! {
                            Link {
                                to: Route::Home {},
                                class: "terminal-link text-terminal-yellow",
                                "cd .."
                            }
                        }
                    }
                    TerminalPrompt { path: Some("~/blog".to_string()), command: Some("ls -la".to_string()), children: rsx! {} }
                    div { class: "terminal-indent terminal-stack-sm",
                        for post in posts.iter() {
                            p { key: "{post.slug}", class: "terminal-listing",
                                span { class: "terminal-muted terminal-inline terminal-desktop-only", "-rw-r--r-- 1 user user 4096 {format_ls_date(post.date)} " }
                                Link {
                                    to: Route::BlogPost { slug: post.slug.to_string() },
                                    class: "terminal-link text-terminal-cyan",
                                    "{post.slug}"
                                }
                                span { class: "text-terminal-green terminal-inline terminal-indent", "# {post.excerpt}" }
                            }
                        }
                    }
                    TerminalPrompt {
                        path: Some("~/blog".to_string()),
                        children: rsx! {
                            Link {
                                to: Route::Home {},
                                class: "terminal-link text-terminal-yellow",
                                "cd .."
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
pub fn BlogPostPage(slug: String) -> Element {
    let post = get_post(&slug);

    if let Some(post) = post.as_ref() {
        rsx! {
            document::Title { "{post.title} | Gitgud Blog" }
            document::Meta { name: "description", content: "{post.excerpt}" }
            document::Meta { property: "og:title", content: "{post.title}" }
            document::Meta { property: "og:description", content: "{post.excerpt}" }
            document::Meta { name: "twitter:card", content: "summary" }
            BlogPostContent { slug }
        }
    } else {
        rsx! {
            document::Title { "Entry not found | Blog" }
            document::Meta { name: "description", content: "Requested blog entry was not found." }
            BlogPostContent { slug }
        }
    }
}

#[component]
pub fn BlogPostContent(slug: String) -> Element {
    let post = get_post(&slug);
    if let Some(post) = post {
        rsx! {
            div { class: "terminal-screen",
                TerminalWindow { aria_label: Some(format!("Blog post {}", post.title)),
                    TerminalHeader { display_cwd: format!("~/blog/{}", post.slug), label: None }
                    div { class: "terminal-body terminal-stack",
                        TerminalPrompt {
                            path: Some("~/blog".to_string()),
                            children: rsx! {
                                Link {
                                    to: Route::Blog {},
                                    class: "terminal-link text-terminal-yellow",
                                    "cd .."
                                }
                            }
                        }
                        TerminalPrompt {
                            command: Some(format!("cat {}.md", post.slug)),
                            path: Some("~/blog".to_string()),
                            children: rsx! {}
                        }
                        article { class: "blog-article",
                            header { class: "blog-header",
                                p { class: "blog-date text-terminal-yellow", "{format_date(post.date)}" }
                                h1 { class: "blog-title", "{post.title}" }
                                p { class: "blog-excerpt", "{post.excerpt}" }
                            }
                            div { class: "blog-body",
                                p { "{post.body}" }
                            }
                            pre { class: "blog-ascii", "{post.ascii}" }
                        }
                        TerminalPrompt {
                            path: Some(format!("~/blog/{}", post.slug)),
                            children: rsx! {
                                Link {
                                    to: Route::Blog {},
                                    class: "terminal-link text-terminal-yellow",
                                    "cd .."
                                }
                            }
                        }
                        TerminalPrompt { path: Some(format!("~/blog/{}", post.slug)), children: rsx! { TerminalCursor {} } }
                    }
                }
            }
        }
    } else {
        rsx! {
            div { class: "terminal-screen",
                TerminalWindow { aria_label: Some("Missing blog post".to_string()),
                    TerminalHeader { display_cwd: "~/blog/404".to_string(), label: None }
                    div { class: "terminal-body terminal-stack",
                        TerminalPrompt { path: Some("~/blog".to_string()), command: Some("cat missing.md".to_string()), children: rsx! {} }
                        p { class: "terminal-muted", "That entry is lost in the logs. Check the index again or head back to the surface." }
                        TerminalPrompt {
                            path: Some("~/blog".to_string()),
                            children: rsx! {
                                Link { to: Route::Blog {}, class: "terminal-link text-terminal-yellow", "cd .." }
                            }
                        }
                        TerminalPrompt { path: Some("~/blog/404".to_string()), children: rsx! { TerminalCursor {} } }
                    }
                }
            }
        }
    }
}
