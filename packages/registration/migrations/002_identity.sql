CREATE TABLE cloud_credentials (
  account_id uuid PRIMARY KEY REFERENCES cloud_accounts(id),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  password_hash text
);
CREATE TABLE cloud_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  absolute_expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '12 hours'),
  ended_at timestamptz
);
CREATE INDEX cloud_sessions_account_idx ON cloud_sessions(account_id);
CREATE TABLE platform_permissions (
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  permission text NOT NULL CHECK (length(permission) BETWEEN 1 AND 100),
  PRIMARY KEY (account_id, permission)
);
