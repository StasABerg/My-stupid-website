ALTER TABLE station_payloads
  ALTER COLUMN total TYPE BIGINT
  USING total::bigint;
