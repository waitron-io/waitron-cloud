CREATE TABLE account_rate_limits (
  key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts BETWEEN 0 AND 1000001),
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_rate_limits_expiry ON account_rate_limits (expires_at);
