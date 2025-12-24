use dioxus::prelude::*;
use dioxus_router::Link;
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsCast;

use crate::routes::Route;
use crate::terminal::{TerminalCursor, TerminalHeader, TerminalPrompt, TerminalWindow};

#[cfg(target_arch = "wasm32")]
struct IntervalHandle {
    id: i32,
    _closure: Rc<wasm_bindgen::closure::Closure<dyn FnMut()>>,
}

#[cfg(target_arch = "wasm32")]
struct MoveListener {
    closure: Rc<wasm_bindgen::closure::Closure<dyn FnMut(web_sys::Event)>>,
}

#[component]
pub fn DoNothingGamePage() -> Element {
    let mut is_running = use_signal(|| false);
    let mut elapsed_time = use_signal(|| 0.0f64);
    let best_time = use_signal(|| 0.0f64);
    #[cfg(target_arch = "wasm32")]
    let mut mounted = use_signal(|| false);
    #[cfg(not(target_arch = "wasm32"))]
    let _mounted = ();
    #[cfg(target_arch = "wasm32")]
    let mut interval_handle = use_signal(|| None::<IntervalHandle>);
    #[cfg(not(target_arch = "wasm32"))]
    let _interval_handle = ();
    #[cfg(target_arch = "wasm32")]
    let mut start_time = use_signal(|| None::<f64>);
    #[cfg(not(target_arch = "wasm32"))]
    let _start_time = ();
    #[cfg(target_arch = "wasm32")]
    let mut last_running = use_signal(|| None::<bool>);
    #[cfg(not(target_arch = "wasm32"))]
    let _last_running = ();

    #[cfg(target_arch = "wasm32")]
    let mut move_listener = use_signal(|| None::<MoveListener>);
    #[cfg(not(target_arch = "wasm32"))]
    let _move_listener = ();

    #[cfg(target_arch = "wasm32")]
    {
        use_effect(move || {
            if !mounted() {
                tracing::debug!("do-nothing: mount");
                mounted.set(true);
            }
            if move_listener.read().is_some() {
                return;
            }
            tracing::debug!("do-nothing: attach move listeners");
            let Some(window) = web_sys::window() else {
                return;
            };
            use wasm_bindgen::closure::Closure;
            use wasm_bindgen::JsCast;

            let mut on_move_running = is_running;
            let on_move_elapsed = elapsed_time;
            let mut on_move_best = best_time;
            let mut on_move_interval = interval_handle;
            let mut on_move_start = start_time;
            let move_closure = Rc::new(Closure::wrap(Box::new(move |_event: web_sys::Event| {
                if !on_move_running() {
                    return;
                }
                on_move_running.set(false);
                let current_id = on_move_interval.read().as_ref().map(|handle| handle.id);
                if let Some(id) = current_id {
                    if let Some(window) = web_sys::window() {
                        window.clear_interval_with_handle(id);
                    }
                    on_move_interval.set(None);
                }
                on_move_start.set(None);
                let elapsed = on_move_elapsed();
                if elapsed > on_move_best() {
                    on_move_best.set(elapsed);
                }
            }) as Box<dyn FnMut(_)>));

            let _ = window.add_event_listener_with_callback(
                "mousemove",
                move_closure.as_ref().as_ref().unchecked_ref(),
            );
            let _ = window.add_event_listener_with_callback(
                "touchmove",
                move_closure.as_ref().as_ref().unchecked_ref(),
            );
            move_listener.set(Some(MoveListener {
                closure: move_closure,
            }));
        });

        use_effect(move || {
            use wasm_bindgen::closure::Closure;
            use wasm_bindgen::JsCast;

            let running = is_running();
            if last_running() == Some(running) {
                return;
            }
            last_running.set(Some(running));
            if running {
                tracing::debug!("do-nothing: start timer");
            } else {
                tracing::debug!("do-nothing: stop timer");
            }
            let Some(window) = web_sys::window() else {
                return;
            };

            let current_id = interval_handle.read().as_ref().map(|handle| handle.id);
            if let Some(id) = current_id {
                window.clear_interval_with_handle(id);
                interval_handle.set(None);
            }

            if !running {
                return;
            }

            let mut interval_elapsed = elapsed_time;
            let interval_start = start_time;
            let interval_closure = Rc::new(Closure::wrap(Box::new(move || {
                let Some(start) = *interval_start.peek() else {
                    return;
                };
                let now = js_sys::Date::now();
                let next = (now - start) / 1000.0;
                interval_elapsed.set(next);
            }) as Box<dyn FnMut()>));

            if let Ok(id) = window.set_interval_with_callback_and_timeout_and_arguments_0(
                interval_closure.as_ref().as_ref().unchecked_ref(),
                100,
            ) {
                interval_handle.set(Some(IntervalHandle {
                    id,
                    _closure: interval_closure,
                }));
            }
        });

        let move_listener = move_listener;
        let interval_handle = interval_handle;
        use_drop(move || {
            if let Some(handle) = interval_handle.read().as_ref() {
                if let Some(window) = web_sys::window() {
                    window.clear_interval_with_handle(handle.id);
                }
            }
            if let Some(listener) = move_listener.read().as_ref() {
                if let Some(window) = web_sys::window() {
                    let _ = window.remove_event_listener_with_callback(
                        "mousemove",
                        listener.closure.as_ref().as_ref().unchecked_ref(),
                    );
                    let _ = window.remove_event_listener_with_callback(
                        "touchmove",
                        listener.closure.as_ref().as_ref().unchecked_ref(),
                    );
                }
            }
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
                                    #[cfg(target_arch = "wasm32")]
                                    start_time.set(Some(js_sys::Date::now()));
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
