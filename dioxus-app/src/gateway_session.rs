use gloo_net::http::Request;
use web_sys::RequestCredentials;
use gloo_storage::{LocalStorage, Storage};
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;

const TOKEN_STORAGE_KEY: &str = "gateway.session.token";
const SESSION_ENDPOINT: &str = "/api/session";

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CachedToken {
    value: String,
    proof: String,
    expires_at: i64,
}

fn read_cached_token() -> Option<CachedToken> {
    LocalStorage::get(TOKEN_STORAGE_KEY).ok()
}

fn write_cached_token(token: Option<&CachedToken>) {
    match token {
        Some(value) => {
            let _ = LocalStorage::set(TOKEN_STORAGE_KEY, value);
        }
        None => {
            LocalStorage::delete(TOKEN_STORAGE_KEY);
        }
    }
}

fn is_valid(token: &CachedToken) -> bool {
    if token.value.is_empty() || token.proof.is_empty() {
        return false;
    }
    let now = js_sys::Date::now() as i64;
    token.expires_at - now > 30_000
}

async fn request_new_session() -> Result<CachedToken, String> {
    let response = Request::post(SESSION_ENDPOINT)
        .header("Content-Type", "application/json")
        .credentials(RequestCredentials::Include)
        .send()
        .await
        .map_err(|err| format!("session request failed: {err}"))?;

    if !response.ok() {
        return Err(format!("session request failed: {}", response.status()));
    }

    #[derive(Deserialize)]
    struct SessionPayload {
        #[serde(rename = "csrfToken")]
        csrf_token: Option<String>,
        #[serde(rename = "csrfProof")]
        csrf_proof: Option<String>,
        #[serde(rename = "expiresAt")]
        expires_at: Option<i64>,
    }

    let payload = response
        .json::<SessionPayload>()
        .await
        .map_err(|err| format!("session decode failed: {err}"))?;

    let csrf_token = payload.csrf_token.ok_or("session missing csrfToken")?;
    let csrf_proof = payload.csrf_proof.ok_or("session missing csrfProof")?;
    let expires_at = payload
        .expires_at
        .unwrap_or_else(|| (js_sys::Date::now() as i64) + 1000 * 60 * 30);

    let token = CachedToken {
        value: csrf_token,
        proof: csrf_proof,
        expires_at,
    };
    write_cached_token(Some(&token));
    Ok(token)
}

pub async fn ensure_gateway_session() -> Result<(String, String), String> {
    if let Some(token) = read_cached_token() {
        if is_valid(&token) {
            return Ok((token.value, token.proof));
        }
        write_cached_token(None);
    }

    let token = request_new_session().await?;
    Ok((token.value, token.proof))
}

pub async fn authorized_post(url: &str, body: &str) -> Result<gloo_net::http::Response, String> {
    let (token, proof) = ensure_gateway_session().await?;
    let request = Request::post(url)
        .header("Content-Type", "application/json")
        .header("X-Gateway-CSRF", &token)
        .header("X-Gateway-CSRF-Proof", &proof)
        .credentials(RequestCredentials::Include)
        .body(body)
        .map_err(|err| format!("request failed: {err}"))?;
    let response = request
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;

    if response.status() == 401 || response.status() == 403 {
        write_cached_token(None);
    }
    Ok(response)
}

pub async fn authorized_get_with_headers(
    url: &str,
    headers: &[(String, String)],
) -> Result<gloo_net::http::Response, String> {
    let _ = ensure_gateway_session().await;
    let mut request = Request::get(url).credentials(RequestCredentials::Include);
    for (key, value) in headers {
        request = request.header(key, value);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;

    if response.status() == 401 || response.status() == 403 {
        write_cached_token(None);
        let _ = ensure_gateway_session().await;
        let mut retry_request = Request::get(url).credentials(RequestCredentials::Include);
        for (key, value) in headers {
            retry_request = retry_request.header(key, value);
        }
        let retry = retry_request
            .send()
            .await
            .map_err(|err| format!("request failed: {err}"))?;
        if retry.status() == 401 || retry.status() == 403 {
            write_cached_token(None);
        }
        return Ok(retry);
    }
    Ok(response)
}

pub async fn authorized_get_json_with_headers<T: DeserializeOwned>(
    url: &str,
    headers: &[(String, String)],
) -> Result<T, String> {
    let response = authorized_get_with_headers(url, headers).await?;
    if !response.ok() {
        return Err(format!("http {}", response.status()));
    }
    response
        .json::<T>()
        .await
        .map_err(|err| format!("decode failed: {err}"))
}
