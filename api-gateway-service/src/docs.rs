use serde_json::json;
use std::sync::OnceLock;

static OPENAPI_SPEC: OnceLock<String> = OnceLock::new();

const DOCS_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Gateway API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/docs/openapi.json",
          dom_id: "#swagger-ui",
          presets: [SwaggerUIBundle.presets.apis],
          layout: "BaseLayout"
        });
      };
    </script>
  </body>
</html>
"##;

pub fn docs_html() -> &'static str {
    DOCS_HTML
}

pub fn openapi_spec() -> &'static str {
    OPENAPI_SPEC.get_or_init(|| {
        json!({
            "openapi": "3.0.3",
            "info": {
                "title": "Gateway API",
                "version": "0.1.0",
                "description": "Session issuance, health checks, and proxy documentation."
            },
            "paths": {
                "/session": {
                    "post": {
                        "tags": ["Session"],
                        "summary": "Issue a session cookie",
                        "responses": {
                            "200": {
                                "description": "Session issued",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "csrfToken": { "type": "string" },
                                                "csrfProof": { "type": "string" },
                                                "expiresAt": { "type": "integer", "format": "int64" }
                                            },
                                            "required": ["csrfToken", "csrfProof", "expiresAt"]
                                        }
                                    }
                                }
                            },
                            "403": { "description": "Origin not allowed" },
                            "500": { "description": "Failed to initialize session" }
                        }
                    }
                },
                "/healthz": {
                    "get": {
                        "tags": ["Health"],
                        "summary": "Gateway readiness probe",
                        "responses": {
                            "200": {
                                "description": "Gateway is healthy",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "status": { "type": "string", "enum": ["ok"] }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "/internal/status": {
                    "get": {
                        "tags": ["Health"],
                        "summary": "Runtime metrics",
                        "responses": {
                            "200": {
                                "description": "Current gateway metrics",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "status": { "type": "string" },
                                                "uptimeMs": { "type": "integer", "format": "int64" },
                                                "eventLoopLagMs": { "type": "integer", "format": "int64" },
                                                "activeRequests": { "type": "integer", "format": "int64" },
                                                "totalRequests": { "type": "integer", "format": "int64" },
                                                "rssBytes": { "type": "integer", "format": "int64" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "tags": [
                { "name": "Session", "description": "Session issuance endpoints" },
                { "name": "Health", "description": "Health and metrics endpoints" }
            ]
        })
        .to_string()
    })
}
