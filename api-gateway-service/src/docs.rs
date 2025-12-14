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
                "/api/config": {
                    "get": {
                        "tags": ["Configuration"],
                        "summary": "Get frontend configuration",
                        "description": "Returns configuration needed by the frontend, such as Turnstile site key.",
                        "responses": {
                            "200": {
                                "description": "Frontend configuration",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "turnstileSiteKey": {
                                                    "type": "string",
                                                    "nullable": true,
                                                    "description": "Cloudflare Turnstile site key for CAPTCHA verification. Null if Turnstile is disabled."
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                "/api/contact": {
                    "post": {
                        "tags": ["Contact"],
                        "summary": "Submit a contact form message",
                        "description": "Submit a contact form with name, optional email, and message. Requires session cookie and CSRF headers (x-gateway-csrf, x-gateway-csrf-proof). Get these from POST /api/session first. Includes spam protection via Turnstile (if enabled), honeypot, rate limiting, and deduplication.",
                        "requestBody": {
                            "required": true,
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "required": ["name", "message"],
                                        "properties": {
                                            "name": {
                                                "type": "string",
                                                "maxLength": 80,
                                                "description": "Sender's name (required)"
                                            },
                                            "email": {
                                                "type": "string",
                                                "maxLength": 120,
                                                "format": "email",
                                                "description": "Sender's email address (optional)"
                                            },
                                            "message": {
                                                "type": "string",
                                                "maxLength": 2000,
                                                "description": "Contact message (required)"
                                            },
                                            "turnstileToken": {
                                                "type": "string",
                                                "description": "Cloudflare Turnstile token (required if Turnstile enabled)"
                                            },
                                            "honeypot": {
                                                "type": "string",
                                                "description": "Honeypot field for spam detection (must be empty)"
                                            },
                                            "timestamp": {
                                                "type": "integer",
                                                "format": "int64",
                                                "description": "Unix timestamp when form was loaded (for timing validation)"
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "responses": {
                            "200": {
                                "description": "Message submitted successfully",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "requestId": {
                                                    "type": "string",
                                                    "description": "Unique request identifier"
                                                },
                                                "status": {
                                                    "type": "string",
                                                    "enum": ["received"],
                                                    "description": "Submission status"
                                                }
                                            },
                                            "required": ["requestId", "status"]
                                        }
                                    }
                                }
                            },
                            "400": {
                                "description": "Invalid request - validation failed, missing Turnstile token, or spam detected",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "error": {
                                                    "type": "string",
                                                    "description": "Error message"
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            "409": {
                                "description": "Duplicate submission - same message already submitted recently"
                            },
                            "429": {
                                "description": "Rate limit exceeded - too many requests from this IP"
                            },
                            "500": {
                                "description": "Internal server error - failed to send email"
                            },
                            "503": {
                                "description": "Service unavailable - contact form not configured"
                            }
                        }
                    }
                },
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
                { "name": "Configuration", "description": "Frontend configuration endpoints" },
                { "name": "Session", "description": "Session issuance endpoints" },
                { "name": "Health", "description": "Health and metrics endpoints" }
            ]
        })
        .to_string()
    })
}
