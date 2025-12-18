mod config;
mod routes;

fn main() {
    dioxus::launch(routes::App);
}
