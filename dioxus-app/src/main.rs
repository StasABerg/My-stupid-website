mod config;
mod gateway_session;
mod radio;
mod routes;
mod swagger;
mod tools;

fn main() {
    dioxus::launch(routes::App);
}
