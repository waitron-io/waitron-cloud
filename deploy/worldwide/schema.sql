-- Session columns must match identity createSession/resolveSession/endSession; rate limits share AccountRateLimiter.
CREATE TABLE IF NOT EXISTS cloud_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  user_handle bytea NOT NULL,
  disabled_at timestamptz,
  bootstrap_hash text,
  bootstrap_expires_at timestamptz
);
CREATE TABLE IF NOT EXISTS cloud_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  absolute_expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '12 hours',
  ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS account_rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS console_passkeys (
  credential_id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  public_key bytea NOT NULL,
  counter bigint NOT NULL,
  transports text[] NOT NULL
);
CREATE TABLE IF NOT EXISTS console_ceremonies (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  account_id uuid REFERENCES cloud_accounts(id),
  bootstrap_hash text,
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '5 minutes'
);
