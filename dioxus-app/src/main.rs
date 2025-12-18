mod config;
mod radio;
mod routes;

fn main() {
    dioxus::launch(routes::App);
}
