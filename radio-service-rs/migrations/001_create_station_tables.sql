CREATE TABLE IF NOT EXISTS station_payloads (
  id BIGSERIAL PRIMARY KEY,
  schema_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  source TEXT,
  requests JSONB NOT NULL DEFAULT '[]'::jsonb,
  total INTEGER NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS station_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  payload_id BIGINT REFERENCES station_payloads(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  payload_id BIGINT NOT NULL REFERENCES station_payloads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stream_url TEXT NOT NULL,
  homepage TEXT,
  favicon TEXT,
  country TEXT,
  country_code TEXT,
  state TEXT,
  languages TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  coordinates JSONB,
  bitrate INTEGER,
  codec TEXT,
  hls BOOLEAN NOT NULL DEFAULT FALSE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  last_checked_at TEXT,
  last_changed_at TEXT,
  click_count INTEGER NOT NULL DEFAULT 0,
  click_trend INTEGER NOT NULL DEFAULT 0,
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stations_payload_id_idx ON stations(payload_id);
CREATE INDEX IF NOT EXISTS stations_country_code_idx ON stations(country_code);
CREATE INDEX IF NOT EXISTS stations_country_idx ON stations(country);
CREATE INDEX IF NOT EXISTS stations_tags_idx ON stations USING GIN (tags);
CREATE INDEX IF NOT EXISTS stations_languages_idx ON stations USING GIN (languages);

INSERT INTO station_state (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;
