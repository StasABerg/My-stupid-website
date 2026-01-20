CREATE TABLE IF NOT EXISTS radio_stream_validation_cache (
  stream_url TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS radio_stream_validation_cache_expires_at_idx
  ON radio_stream_validation_cache (expires_at);
