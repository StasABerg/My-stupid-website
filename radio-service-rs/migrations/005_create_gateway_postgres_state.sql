CREATE TABLE IF NOT EXISTS gateway_sessions (
  session_id TEXT PRIMARY KEY,
  record JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gateway_sessions_expires_at_idx
  ON gateway_sessions (expires_at);

CREATE TABLE IF NOT EXISTS gateway_csrf (
  csrf_token TEXT PRIMARY KEY,
  csrf_proof TEXT UNIQUE,
  record JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gateway_csrf_expires_at_idx
  ON gateway_csrf (expires_at);

CREATE TABLE IF NOT EXISTS gateway_contact_rate_limit (
  client_ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gateway_contact_rate_limit_expires_at_idx
  ON gateway_contact_rate_limit (expires_at);

CREATE TABLE IF NOT EXISTS gateway_contact_dedupe (
  fingerprint TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gateway_contact_dedupe_expires_at_idx
  ON gateway_contact_dedupe (expires_at);
