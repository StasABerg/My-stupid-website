use dioxus::prelude::*;

#[component]
pub fn TerminalWindow(children: Element, aria_label: Option<String>) -> Element {
    let label = aria_label.unwrap_or_else(|| "Terminal interface".to_string());
    rsx! {
        div { class: "terminal-window", role: "main", aria_label: "{label}",
            {children}
        }
    }
}

#[component]
pub fn TerminalHeader(display_cwd: String, label: Option<String>) -> Element {
    let rendered_label = label.unwrap_or_else(|| format!("sandbox@gitgud.zip:{display_cwd} — isolated pod"));
    rsx! {
        div { class: "terminal-header",
            span { class: "text-terminal-red", "●" }
            span { class: "text-terminal-yellow", "●" }
            span { class: "text-terminal-green", "●" }
            span { class: "terminal-header-label text-terminal-cyan", "{rendered_label}" }
        }
    }
}

#[component]
pub fn TerminalPrompt(
    user: Option<String>,
    host: Option<String>,
    path: Option<String>,
    command: Option<String>,
    children: Element,
) -> Element {
    let user = user.unwrap_or_else(|| "user".to_string());
    let host = host.unwrap_or_else(|| "terminal".to_string());
    let path = path.unwrap_or_else(|| "~".to_string());
    rsx! {
        div { class: "terminal-prompt",
            span { class: "text-terminal-green", "{user}@{host}" }
            span { class: "text-terminal-white", ":" }
            span { class: "text-terminal-cyan", "{path}" }
            span { class: "text-terminal-white", "$ " }
            if let Some(command) = command {
                span { class: "text-terminal-yellow", "{command}" }
            }
            {children}
        }
    }
}

#[component]
pub fn TerminalCursor() -> Element {
    rsx! {
        span { class: "terminal-cursor text-terminal-white", "█" }
    }
}
