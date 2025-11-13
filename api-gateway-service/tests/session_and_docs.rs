use api_gateway_service::build_router_with_proxy;
use api_gateway_service::config::Config;
use api_gateway_service::logger::Logger;
use api_gateway_service::proxy::{GatewayProxy, ProxyOptions};
use async_trait::async_trait;
use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use bytes::Bytes;
use http::Response;
use http_body_util::BodyExt;
use serde_json::Value;
use std::net::SocketAddr;
use std::sync::Arc;
use tower::ServiceExt;

const ORIGIN: &str = "http://client.test";

#[tokio::test]
async fn session_and_docs_flow() {
    set_env();

    let logger = Logger::new("gateway-test");
    let config = Arc::new(Config::load(&logger).expect("config load"));
    let proxy = Arc::new(MockProxy);

    let router = build_router_with_proxy(config.clone(), logger.clone(), proxy)
        .await
        .unwrap();

    let mut session_request = Request::builder()
        .method(Method::POST)
        .uri("/session")
        .header("Origin", ORIGIN)
        .body(Body::empty())
        .unwrap();
    add_connect_info(&mut session_request);
    let session_resp = router.clone().oneshot(session_request).await.unwrap();
    assert_eq!(session_resp.status(), StatusCode::OK);
    let cookie_header = session_resp
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let session_body: Value =
        serde_json::from_slice(&body_bytes(session_resp.into_body()).await).unwrap();
    let csrf_token = session_body["csrfToken"].as_str().unwrap().to_string();
    let csrf_proof = session_body["csrfProof"].as_str().unwrap().to_string();

    let mut docs_req = Request::builder()
        .method(Method::GET)
        .uri("/docs")
        .body(Body::empty())
        .unwrap();
    add_connect_info(&mut docs_req);
    let docs_resp = router.clone().oneshot(docs_req).await.unwrap();
    let docs_text = body_string(docs_resp.into_body()).await;
    assert!(docs_text.contains("swagger-ui"));

    let mut spec_req = Request::builder()
        .method(Method::GET)
        .uri("/docs/json")
        .body(Body::empty())
        .unwrap();
    add_connect_info(&mut spec_req);
    let spec_resp = router.clone().oneshot(spec_req).await.unwrap();
    let spec_json: Value =
        serde_json::from_slice(&body_bytes(spec_resp.into_body()).await).unwrap();
    assert_eq!(spec_json["info"]["title"], "Gateway API");

    let radio_body = call_proxy_route(
        &router,
        "/radio/docs",
        &cookie_header,
        &csrf_token,
        &csrf_proof,
    )
    .await;
    assert_eq!(radio_body, "<html>radio docs</html>");

    let terminal_body = call_proxy_route(
        &router,
        "/terminal/docs",
        &cookie_header,
        &csrf_token,
        &csrf_proof,
    )
    .await;
    assert_eq!(terminal_body, "<html>terminal docs</html>");
}

async fn call_proxy_route(
    router: &Router,
    path: &str,
    cookie: &str,
    csrf_token: &str,
    csrf_proof: &str,
) -> String {
    let mut request = Request::builder()
        .method(Method::GET)
        .uri(path)
        .header("Origin", ORIGIN)
        .header(header::COOKIE, cookie)
        .header("x-gateway-csrf", csrf_token)
        .header("x-gateway-csrf-proof", csrf_proof)
        .body(Body::empty())
        .unwrap();
    add_connect_info(&mut request);
    let resp = router.clone().oneshot(request).await.unwrap();
    body_string(resp.into_body()).await
}

fn set_env() {
    unsafe {
        std::env::set_var("PORT", "18080");
        std::env::set_var("RADIO_SERVICE_URL", "http://radio.test");
        std::env::set_var("TERMINAL_SERVICE_URL", "http://terminal.test");
        std::env::set_var("CORS_ALLOW_ORIGINS", ORIGIN);
        std::env::set_var("INSTANCE_SECRET_SEED", "tests-secret-seed");
    }
}

fn add_connect_info(request: &mut Request<Body>) {
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40000))));
}

#[derive(Default)]
struct MockProxy;

#[async_trait]
impl GatewayProxy for MockProxy {
    async fn forward(
        &self,
        _parts: http::request::Parts,
        _body_bytes: Option<Bytes>,
        options: ProxyOptions<'_>,
    ) -> Response<Body> {
        let body = match options.target.service {
            "radio" => "<html>radio docs</html>",
            "terminal" => "<html>terminal docs</html>",
            other => panic!("unexpected target {other}"),
        };
        Response::builder()
            .status(StatusCode::OK)
            .body(Body::from(body))
            .unwrap()
    }
}

async fn body_bytes(body: Body) -> Bytes {
    body.collect().await.unwrap().to_bytes()
}

async fn body_string(body: Body) -> String {
    String::from_utf8(body_bytes(body).await.to_vec()).unwrap()
}
