mod config;
mod cookie_consent;
mod contact;
mod date;
mod gateway_session;
mod howto;
mod blog;
mod do_nothing;
mod posts;
mod radio;
mod routes;
mod swagger;
mod terminal;
mod terminal_shell;
mod tools;

fn main() {
    dioxus::launch(routes::App);
}
