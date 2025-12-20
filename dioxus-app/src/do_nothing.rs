use dioxus::prelude::*;
use dioxus_router::Link;

use crate::routes::Route;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};

#[component]
pub fn DoNothingGamePage() -> Element {
    let mut is_running = use_signal(|| false);
    let mut elapsed_time = use_signal(|| 0.0f64);
    let best_time = use_signal(|| 0.0f64);
    #[cfg(target_arch = "wasm32")]
    let mut interval_id = use_signal(|| None::<i32>);
    #[cfg(not(target_arch = "wasm32"))]
    let _interval_id = ();

    #[cfg(target_arch = "wasm32")]
    let mut listeners_ready = use_signal(|| false);
    #[cfg(not(target_arch = "wasm32"))]
    let _listeners_ready = ();

    #[cfg(target_arch = "wasm32")]
    {
        use_effect(move || {
            if listeners_ready() {
                return;
            }
            let Some(window) = web_sys::window() else {
                return;
            };
            use wasm_bindgen::closure::Closure;
            use wasm_bindgen::JsCast;

            let mut on_move_running = is_running;
            let on_move_elapsed = elapsed_time;
            let mut on_move_best = best_time;
            let mut on_move_interval = interval_id;
            let move_closure = Closure::wrap(Box::new(move |_event: web_sys::Event| {
                if !on_move_running() {
                    return;
                }
                on_move_running.set(false);
                if let Some(id) = on_move_interval() {
                    if let Some(window) = web_sys::window() {
                        window.clear_interval_with_handle(id);
                    }
                    on_move_interval.set(None);
                }
                let elapsed = on_move_elapsed();
                if elapsed > on_move_best() {
                    on_move_best.set(elapsed);
                }
            }) as Box<dyn FnMut(_)>);

            let _ = window.add_event_listener_with_callback(
                "mousemove",
                move_closure.as_ref().unchecked_ref(),
            );
            let _ = window.add_event_listener_with_callback(
                "touchmove",
                move_closure.as_ref().unchecked_ref(),
            );
            move_closure.forget();
            listeners_ready.set(true);
        });

        use_effect(move || {
            use wasm_bindgen::closure::Closure;
            use wasm_bindgen::JsCast;

            let running = is_running();
            let Some(window) = web_sys::window() else {
                return;
            };

            if !running {
                if let Some(id) = interval_id() {
                    window.clear_interval_with_handle(id);
                    interval_id.set(None);
                }
                return;
            }

            if let Some(id) = interval_id() {
                window.clear_interval_with_handle(id);
                interval_id.set(None);
            }

            let mut interval_elapsed = elapsed_time;
            let interval_closure = Closure::wrap(Box::new(move || {
                let next = interval_elapsed() + 0.01;
                interval_elapsed.set(next);
            }) as Box<dyn FnMut()>);

            if let Ok(id) = window.set_interval_with_callback_and_timeout_and_arguments_0(
                interval_closure.as_ref().unchecked_ref(),
                10,
            ) {
                interval_id.set(Some(id));
            }
            interval_closure.forget();
        });
    }

    let format_time = |value: f64| format!("{value:.2}");

    rsx! {
        div { class: "terminal-screen",
            TerminalWindow { aria_label: Some("Do Nothing Game".to_string()),
                TerminalHeader { display_cwd: "~/games/do-nothing".to_string(), label: None }
                div { class: "terminal-body terminal-stack",
                    TerminalPrompt {
                        path: Some("~/games".to_string()),
                        children: rsx! {
                            Link { to: Route::Games {}, class: "terminal-link text-terminal-yellow", "cd .." }
                        }
                    }
                    TerminalPrompt {
                        user: Some("user".to_string()),
                        host: Some("terminal".to_string()),
                        path: Some("~/games/do-nothing".to_string()),
                        command: Some("./start.sh".to_string()),
                        children: rsx! {}
                    }
                    div { class: "terminal-box",
                        pre { class: "terminal-ascii",
                            "╔══════════════════════════════════════╗\n║    DO NOTHING GAME v1.0              ║\n║  Rules: Don't move anything!         ║\n╚══════════════════════════════════════╝"
                        }
                        div { class: "terminal-stack",
                            p { class: "text-terminal-yellow",
                                "Status: "
                                span { class: if is_running() { "text-terminal-green" } else { "text-terminal-red" },
                                    if is_running() { "RUNNING" } else { "STOPPED" }
                                }
                            }
                            p { class: "text-terminal-cyan", "Time: {format_time(elapsed_time())}s" }
                            p { class: "text-terminal-magenta", "Best: {format_time(best_time())}s" }
                        }
                        if !is_running() {
                            button {
                                class: "terminal-button",
                                onclick: move |_| {
                                    elapsed_time.set(0.0);
                                    is_running.set(true);
                                },
                                if elapsed_time() > 0.0 { "RESTART" } else { "START" }
                            }
                        }
                    }
                    TerminalPrompt {
                        path: Some("~/games/do-nothing".to_string()),
                        children: rsx! {
                            Link { to: Route::Games {}, class: "terminal-link text-terminal-yellow", "cd .." }
                        }
                    }
                    TerminalPrompt { path: Some("~/games/do-nothing".to_string()), children: rsx! { TerminalCursor {} } }
                }
            }
        }
    }
}
