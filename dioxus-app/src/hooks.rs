use dioxus::prelude::*;
use serde::de::DeserializeOwned;

use crate::gateway_session::authorized_get_json_with_headers;

pub fn use_gateway_get_with_headers<T, F, H>(builder: F, headers: H) -> Resource<Result<T, String>>
where
    T: DeserializeOwned + 'static,
    F: Fn() -> String + 'static,
    H: Fn() -> Vec<(String, String)> + 'static,
{
    use_resource(move || {
        let url = builder();
        let headers = headers();
        async move { authorized_get_json_with_headers(&url, &headers).await }
    })
}
