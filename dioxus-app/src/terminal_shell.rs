use dioxus::prelude::*;
#[cfg(target_arch = "wasm32")]
use dioxus::web::WebEventExt;
use dioxus_router::use_navigator;
use dioxus_router::{Link, Navigator};
use gloo_net::http::Request;
use serde::{Deserialize, Serialize};
use web_sys::RequestCredentials;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsCast;

use crate::config::RuntimeConfig;
use crate::gateway_session::ensure_gateway_session;
use crate::hooks::use_gateway_get_with_headers;
use crate::routes::Route;
use crate::terminal::{TerminalHeader, TerminalPrompt, TerminalWindow};

const DEFAULT_VIRTUAL_CWD: &str = "/home/demo";

#[derive(Clone, Debug, PartialEq, Deserialize)]
struct InfoResponse {
    #[serde(rename = "virtualCwd")]
    virtual_cwd: Option<String>,
    #[serde(rename = "displayCwd")]
    display_cwd: Option<String>,
    #[serde(rename = "supportedCommands")]
    supported_commands: Option<Vec<String>>,
    motd: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
struct ExecuteResponse {
    command: Option<String>,
    output: Option<Vec<String>>,
    error: Option<bool>,
    cwd: Option<String>,
    #[serde(rename = "displayCwd")]
    display_cwd: Option<String>,
    clear: Option<bool>,
    #[serde(rename = "promptLabel")]
    prompt_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct HistoryEntry {
    id: u64,
    cwd: String,
    command: String,
    output: Vec<String>,
    is_error: bool,
    prompt_label: String,
}

#[derive(Clone, Debug, Serialize)]
struct ExecuteBody<'a> {
    input: &'a str,
    cwd: &'a str,
}

#[component]
pub fn TerminalPage() -> Element {
    let config = use_context::<RuntimeConfig>();
    let base_url = config.terminal_api_base_url.clone();
    let navigator = use_navigator();

    let mut input = use_signal(String::new);
    let history = use_signal(Vec::<HistoryEntry>::new);
    let command_history = use_signal(Vec::<String>::new);
    let mut history_index = use_signal(|| None::<usize>);
    let mut display_cwd = use_signal(|| to_display_path(DEFAULT_VIRTUAL_CWD));
    let mut virtual_cwd = use_signal(|| DEFAULT_VIRTUAL_CWD.to_string());
    let mut supported_commands = use_signal(Vec::<String>::new);
    let mut motd = use_signal(Vec::<String>::new);
    let mut loading = use_signal(|| true);
    let mut connection_error = use_signal(|| None::<String>);
    let is_submitting = use_signal(|| false);
    let command_id = use_signal(|| 0u64);
    #[cfg(target_arch = "wasm32")]
    let mut input_handle = use_signal(|| None::<web_sys::HtmlInputElement>);
    #[cfg(target_arch = "wasm32")]
    let mut input_ready = use_signal(|| false);
    #[cfg(target_arch = "wasm32")]
    let mut output_handle = use_signal(|| None::<web_sys::HtmlElement>);
    #[cfg(not(target_arch = "wasm32"))]
    let _input_handle = ();
    #[cfg(not(target_arch = "wasm32"))]
    let _input_ready = ();
    #[cfg(not(target_arch = "wasm32"))]
    let _output_handle = ();

    const OUTPUT_ID: &str = "terminal-output";
    const INPUT_ID: &str = "terminal-input";

    let info_resource = use_gateway_get_with_headers::<InfoResponse, _, _>(
        {
            let base_url = base_url.clone();
            move || build_terminal_url(&base_url, "info")
        },
        || {
            let debug = encode_debug_header("info");
            vec![
                ("Content-Type".to_string(), "application/json".to_string()),
                ("X-Terminal-Debug".to_string(), debug),
            ]
        },
    );

    use_effect(move || {
        match info_resource() {
            None => {
                loading.set(true);
            }
            Some(Ok(info)) => {
                let next_virtual = info
                    .virtual_cwd
                    .unwrap_or_else(|| DEFAULT_VIRTUAL_CWD.to_string());
                let next_display = resolve_display_cwd(&next_virtual, info.display_cwd.as_deref());
                virtual_cwd.set(next_virtual);
                display_cwd.set(next_display);
                supported_commands.set(info.supported_commands.unwrap_or_default());
                motd.set(info.motd.unwrap_or_default());
                connection_error.set(None);
                loading.set(false);
            }
            Some(Err(message)) => {
                connection_error.set(Some(message));
                loading.set(false);
            }
        }
    });

    use_effect(move || {
        #[cfg(target_arch = "wasm32")]
        {
            let _history_len = history().len();
            if let Some(element) = output_handle.read().as_ref().cloned() {
                element.set_scroll_top(element.scroll_height());
            }
        }
    });

    use_effect(move || {
        #[cfg(target_arch = "wasm32")]
        {
            if input_ready() {
                return;
            }
            if let Some(element) = input_handle.read().as_ref().cloned() {
                let _ = element.focus();
                input_ready.set(true);
            }
        }
    });

    let banner_lines = build_banner_lines(
        loading(),
        connection_error().clone(),
        supported_commands(),
        motd(),
    );
    let banner_class = if connection_error().is_some() {
        "text-terminal-red"
    } else {
        "text-terminal-cyan"
    };

    let prompt_user = "sandbox".to_string();
    let prompt_host = "gitgud.zip".to_string();
    let header_label = format!(
        "{} — isolated pod",
        build_prompt_label(&prompt_user, &prompt_host, &display_cwd())
    );

    let base_url_submit = base_url.clone();
    let base_url_keydown = base_url.clone();
    let navigator_submit = navigator;
    let navigator_keydown = navigator;

    rsx! {
        div { class: "terminal-screen",
            onclick: move |_| {
                #[cfg(target_arch = "wasm32")]
                if let Some(element) = input_handle.read().as_ref().cloned() {
                    let _ = element.focus();
                }
            },
            TerminalWindow { aria_label: Some("Sandbox terminal".to_string()),
                TerminalHeader { display_cwd: display_cwd(), label: Some(header_label) }
                div { class: "terminal-output terminal-stack", id: OUTPUT_ID,
                    onmounted: move |_event| {
                        #[cfg(target_arch = "wasm32")]
                        {
                            let element = _event.data.as_ref().as_web_event();
                            if let Ok(node) = element.dyn_into::<web_sys::HtmlElement>() {
                                output_handle.set(Some(node));
                            }
                        }
                    },
                    for (index, line) in banner_lines.iter().enumerate() {
                        if line == "Commands run against a locked-down Kubernetes pod with whitelisted binaries and an ephemeral filesystem." {
                            p { key: "banner-{index}", class: "text-terminal-white", "{line}" }
                        } else if line == "Need to leave? cd ~" {
                            p { key: "banner-{index}", class: "text-terminal-white",
                                "Need to leave? "
                                Link {
                                    to: Route::Home {},
                                    class: "terminal-link text-terminal-yellow",
                                    aria_label: "Go back to home directory",
                                    "cd ~"
                                }
                            }
                        } else {
                            p { key: "banner-{index}", class: "terminal-banner {banner_class}", "{line}" }
                        }
                    }
                    for entry in history().iter() {
                        div { key: "{entry.id}", class: "terminal-entry",
                            TerminalPrompt {
                                user: Some(prompt_user.clone()),
                                host: Some(prompt_host.clone()),
                                path: Some(entry.cwd.clone()),
                                command: Some(entry.command.clone()),
                                children: rsx! {}
                            }
                            for (line_index, line) in entry.output.iter().enumerate() {
                                p {
                                    key: "{entry.id}-{line_index}",
                                    class: if entry.is_error { "text-terminal-red" } else { "text-terminal-white" },
                                    "{line}"
                                }
                            }
                        }
                    }
                    if loading() {
                        p { class: "terminal-muted", "Loading terminal..." }
                    }
                }
                form {
                    class: "terminal-input-bar",
                    onsubmit: move |event| {
                        event.prevent_default();
                        if loading() || is_submitting() {
                            return;
                        }
                        let value = input();
                        if value.trim().is_empty() {
                            return;
                        }
                        let base_url = base_url_submit.clone();
                        let navigator = navigator_submit;
                        let input = input;
                        let history = history;
                        let command_history = command_history;
                        let history_index = history_index;
                        let virtual_cwd = virtual_cwd;
                        let display_cwd = display_cwd;
                        let connection_error = connection_error;
                        let is_submitting = is_submitting;
                        let command_id = command_id;
                        spawn(async move {
                            run_command(
                                value,
                                base_url,
                                navigator,
                                input,
                                history,
                                command_history,
                                history_index,
                                virtual_cwd,
                                display_cwd,
                                connection_error,
                                is_submitting,
                                command_id,
                            )
                            .await;
                        });
                    },
                    div { class: "terminal-prompt-inline",
                        span { class: "text-terminal-green", "{prompt_user}@{prompt_host}" }
                        span { class: "text-terminal-white", ":" }
                        span { class: "text-terminal-cyan", "{display_cwd()}" }
                        span { class: "text-terminal-white", "$" }
                    }
                    input {
                        r#type: "text",
                        id: INPUT_ID,
                        value: "{input}",
                        class: "terminal-input",
                        placeholder: if connection_error().is_some() { "offline" } else { "type a command" },
                        autocomplete: "off",
                        spellcheck: "false",
                        disabled: loading() || is_submitting(),
                        onmounted: move |_event| {
                            #[cfg(target_arch = "wasm32")]
                            {
                                let element = _event.data.as_ref().as_web_event();
                                if let Ok(node) = element.dyn_into::<web_sys::HtmlInputElement>() {
                                    input_handle.set(Some(node));
                                }
                            }
                        },
                        oninput: move |event| input.set(event.value()),
                        onkeydown: move |event| {
                            match event.key() {
                                Key::ArrowUp => {
                                    event.prevent_default();
                                    let history = command_history();
                                    if history.is_empty() {
                                        return;
                                    }
                                    let next_index = history_index().unwrap_or(history.len()).saturating_sub(1);
                                    history_index.set(Some(next_index));
                                    if let Some(value) = history.get(next_index) {
                                        input.set(value.clone());
                                    }
                                }
                                Key::ArrowDown => {
                                    event.prevent_default();
                                    let history = command_history();
                                    let Some(current) = history_index() else {
                                        return;
                                    };
                                    let next_index = current + 1;
                                    if next_index >= history.len() {
                                        history_index.set(None);
                                        input.set(String::new());
                                    } else {
                                        history_index.set(Some(next_index));
                                        if let Some(value) = history.get(next_index) {
                                            input.set(value.clone());
                                        }
                                    }
                                }
                                Key::Enter => {
                                    event.prevent_default();
                                    if loading() || is_submitting() {
                                        return;
                                    }
                                    let value = input();
                                    if value.trim().is_empty() {
                                        return;
                                    }
                                    let base_url = base_url_keydown.clone();
                                    let navigator = navigator_keydown;
                                    let input = input;
                                    let history = history;
                                    let command_history = command_history;
                                    let history_index = history_index;
                                    let virtual_cwd = virtual_cwd;
                                    let display_cwd = display_cwd;
                                    let connection_error = connection_error;
                                    let is_submitting = is_submitting;
                                    let command_id = command_id;
                                    spawn(async move {
                                        run_command(
                                            value,
                                            base_url,
                                            navigator,
                                            input,
                                            history,
                                            command_history,
                                            history_index,
                                            virtual_cwd,
                                            display_cwd,
                                            connection_error,
                                            is_submitting,
                                            command_id,
                                        )
                                        .await;
                                    });
                                }
                                _ => {}
                            }
                        },
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_command(
    raw: String,
    base_url: String,
    navigator: Navigator,
    mut input: Signal<String>,
    mut history: Signal<Vec<HistoryEntry>>,
    mut command_history: Signal<Vec<String>>,
    mut history_index: Signal<Option<usize>>,
    mut virtual_cwd: Signal<String>,
    mut display_cwd: Signal<String>,
    mut connection_error: Signal<Option<String>>,
    mut is_submitting: Signal<bool>,
    mut command_id: Signal<u64>,
) {
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return;
    }

    let previous_display = display_cwd();
    let previous_virtual = virtual_cwd();

    command_history.with_mut(|items| items.push(raw.clone()));
    history_index.set(None);

    if trimmed == "clear" {
        history.set(Vec::new());
        input.set(String::new());
        return;
    }

    if trimmed.to_lowercase() == "be better" {
        let output = vec![
            "Discipline > feelings.".to_string(),
            "Pipelines don't break themselves.".to_string(),
            "75% done is still not shipped.".to_string(),
            "Redirecting you to remedial training...".to_string(),
            format!("Visit {}/gitgud", current_origin()),
        ];
        append_entry(
            &mut history,
            &mut command_id,
            HistoryEntry {
                id: 0,
                cwd: previous_display.clone(),
                command: raw.clone(),
                output,
                is_error: false,
                prompt_label: build_prompt_label("sandbox", "gitgud.zip", &previous_display),
            },
        );
        input.set(String::new());
        navigator.push(Route::GitGud {});
        return;
    }

    if connection_error().is_some() {
        let (output, is_error) = handle_offline_command(&trimmed, &previous_display, &navigator);
        append_entry(
            &mut history,
            &mut command_id,
            HistoryEntry {
                id: 0,
                cwd: previous_display.clone(),
                command: raw.clone(),
                output,
                is_error,
                prompt_label: build_prompt_label("sandbox", "gitgud.zip", &previous_display),
            },
        );
        input.set(String::new());
        return;
    }

    is_submitting.set(true);
    let execute_url = build_terminal_url(&base_url, "execute");
    let payload = serde_json::to_string(&ExecuteBody {
        input: &raw,
        cwd: &previous_virtual,
    })
    .unwrap_or_else(|_| "{}".to_string());

    let response = match authorized_post_with_debug(&execute_url, &payload).await {
        Ok(response) => response,
        Err(err) => {
            append_entry(
                &mut history,
                &mut command_id,
                HistoryEntry {
                    id: 0,
                    cwd: previous_display.clone(),
                    command: raw.clone(),
                    output: vec![err],
                    is_error: true,
                    prompt_label: build_prompt_label("sandbox", "gitgud.zip", &previous_display),
                },
            );
            is_submitting.set(false);
            input.set(String::new());
            return;
        }
    };

    let payload: Option<ExecuteResponse> = response.json().await.ok();
    let next_virtual = payload
        .as_ref()
        .and_then(|value| value.cwd.clone())
        .unwrap_or_else(|| previous_virtual.clone());
    let next_display = resolve_display_cwd(&next_virtual, payload.as_ref().and_then(|value| value.display_cwd.as_deref()));
    let is_error = payload.as_ref().and_then(|value| value.error).unwrap_or(false) || !response.ok();
    let mut output = payload
        .as_ref()
        .and_then(|value| value.output.clone())
        .unwrap_or_default();

    if output.is_empty() && !response.ok() {
        output.push(format!("Command service returned status {}", response.status()));
    }

    let entry = HistoryEntry {
        id: 0,
        cwd: previous_display.clone(),
        command: raw.clone(),
        output,
        is_error,
        prompt_label: payload
            .as_ref()
            .and_then(|value| value.prompt_label.clone())
            .unwrap_or_else(|| build_prompt_label("sandbox", "gitgud.zip", &previous_display)),
    };

    if payload.as_ref().and_then(|value| value.clear).unwrap_or(false) {
        history.set(Vec::new());
    } else {
        append_entry(&mut history, &mut command_id, entry);
    }

    virtual_cwd.set(next_virtual);
    display_cwd.set(next_display);
    connection_error.set(None);
    is_submitting.set(false);
    input.set(String::new());
}

fn append_entry(
    history: &mut Signal<Vec<HistoryEntry>>,
    command_id: &mut Signal<u64>,
    mut entry: HistoryEntry,
) {
    let next_id = command_id() + 1;
    entry.id = next_id;
    command_id.set(next_id);
    history.with_mut(|items| items.push(entry));
}

fn handle_offline_command(
    command: &str,
    previous_display: &str,
    navigator: &Navigator,
) -> (Vec<String>, bool) {
    match command {
        "help" => (
            vec![
                "Available commands:".to_string(),
                "  help     - Show this help message".to_string(),
                "  clear    - Clear the terminal".to_string(),
                "  pwd      - Print working directory".to_string(),
                "  whoami   - Print current user".to_string(),
                "  date     - Print current date".to_string(),
                "  echo     - Print arguments".to_string(),
                "".to_string(),
                "Note: Backend service is unavailable. Some commands may not work as expected.".to_string(),
            ],
            false,
        ),
        "pwd" => (vec![previous_display.to_string()], false),
        "whoami" => (vec!["sandbox".to_string()], false),
        "date" => (vec![current_date_string()], false),
        _ if command.starts_with("echo ") => (vec![command[5..].to_string()], false),
        _ if command == "cd" || command == "cd ~" || command.starts_with("cd ") => {
            let new_path = if command == "cd" {
                "~"
            } else {
                command.trim_start_matches("cd ").trim()
            };
            if new_path == "~" || new_path.is_empty() || new_path == "/home/sandbox" {
                navigator.push(Route::Home {});
                (Vec::new(), false)
            } else {
                (
                    vec!["cd: command not available in offline mode".to_string()],
                    true,
                )
            }
        }
        _ => (
            vec![
                format!("Command '{command}' not available in offline mode."),
                "Type 'help' to see available commands.".to_string(),
            ],
            true,
        ),
    }
}

fn build_terminal_url(base_url: &str, path: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let segment = path.trim_start_matches('/');
    format!("{base}/{segment}")
}

fn to_display_path(virtual_path: &str) -> String {
    if virtual_path.is_empty() || virtual_path == "/" {
        return "~".to_string();
    }
    if virtual_path == DEFAULT_VIRTUAL_CWD {
        return "~".to_string();
    }
    if let Some(stripped) = virtual_path.strip_prefix(DEFAULT_VIRTUAL_CWD) {
        return format!("~{stripped}");
    }
    virtual_path.to_string()
}

fn resolve_display_cwd(virtual_path: &str, candidate: Option<&str>) -> String {
    if let Some(value) = candidate {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    to_display_path(virtual_path)
}

fn build_prompt_label(user: &str, host: &str, display_path: &str) -> String {
    format!("{user}@{host}:{display_path}")
}

fn build_banner_lines(
    loading: bool,
    connection_error: Option<String>,
    supported_commands: Vec<String>,
    motd: Vec<String>,
) -> Vec<String> {
    let mut lines = vec![
        "Commands run against a locked-down Kubernetes pod with whitelisted binaries and an ephemeral filesystem.".to_string(),
        "Need to leave? cd ~".to_string(),
        "".to_string(),
    ];

    if loading {
        lines.push("Establishing secure connection to sandbox pod...".to_string());
        return lines;
    }

    if let Some(error) = connection_error {
        lines.push(error);
        return lines;
    }

    lines.push("Connected to isolated sandbox pod. Commands run inside a locked-down container.".to_string());
    if !supported_commands.is_empty() {
        lines.push(format!("Allowed commands: {}", supported_commands.join(", ")));
    }
    if !motd.is_empty() {
        lines.push("---- motd ----".to_string());
        lines.extend(motd);
        lines.push("--------------".to_string());
    }

    lines
}

async fn authorized_post_with_debug(url: &str, body: &str) -> Result<gloo_net::http::Response, String> {
    let (token, proof) = ensure_gateway_session().await?;
    let response = Request::post(url)
        .header("Content-Type", "application/json")
        .header("X-Gateway-CSRF", &token)
        .header("X-Gateway-CSRF-Proof", &proof)
        .header("X-Terminal-Debug", &encode_debug_header("execute"))
        .credentials(RequestCredentials::Include)
        .body(body)
        .map_err(|err| format!("request failed: {err}"))?
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;

    Ok(response)
}

fn encode_debug_header(stage: &str) -> String {
    let payload = format!("{{\"stage\":\"{stage}\"}}");
    URL_SAFE_NO_PAD.encode(payload)
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

fn current_date_string() -> String {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::new_0().to_string().into()
    }
#[cfg(not(target_arch = "wasm32"))]
    {
        "1970-01-01".to_string()
    }
}
