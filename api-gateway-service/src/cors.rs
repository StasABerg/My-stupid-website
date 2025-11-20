use http::{HeaderMap, HeaderValue, header::HeaderName};

#[derive(Clone)]
pub struct Cors {
    allowed: Vec<String>,
}

impl Cors {
    pub fn new(allowed: Vec<String>) -> Self {
        Self { allowed }
    }

    pub fn build_headers(&self, origin: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("vary"),
            HeaderValue::from_static("Origin"),
        );

        let wildcard = self.allowed.iter().any(|value| value == "*");

        if let Some(origin_value) = origin {
            let origin_allowed = if wildcard {
                true
            } else {
                self.allowed.iter().any(|value| value == origin_value)
            };

            if origin_allowed {
                headers.insert(
                    HeaderName::from_static("access-control-allow-origin"),
                    if wildcard {
                        HeaderValue::from_static("*")
                    } else {
                        HeaderValue::from_str(origin_value)
                            .unwrap_or_else(|_| HeaderValue::from_static("*"))
                    },
                );
                headers.insert(
                    HeaderName::from_static("access-control-allow-methods"),
                    HeaderValue::from_static("GET,POST,PUT,DELETE,PATCH,OPTIONS"),
                );
                headers.insert(
                    HeaderName::from_static("access-control-allow-headers"),
                    HeaderValue::from_static(
                        "authorization,content-type,x-gateway-csrf,x-gateway-csrf-proof",
                    ),
                );
                if !wildcard {
                    headers.insert(
                        HeaderName::from_static("access-control-allow-credentials"),
                        HeaderValue::from_static("true"),
                    );
                }
            }
        } else {
            headers.insert(
                HeaderName::from_static("access-control-allow-methods"),
                HeaderValue::from_static("GET,POST,PUT,DELETE,PATCH,OPTIONS"),
            );
        }

        headers
    }

    pub fn is_origin_allowed(&self, origin: Option<&str>) -> bool {
        if origin.is_none() {
            return true;
        }
        let wildcard = self.allowed.iter().any(|value| value == "*");
        origin.map(|value| wildcard || self.allowed.iter().any(|allowed| allowed == value)).unwrap_or(false)
    }
}
