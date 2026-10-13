CREATE TABLE cloud_authenticator_factors (
  account_id uuid PRIMARY KEY REFERENCES cloud_accounts(id),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  secret_generation uuid,
  secret_envelope text CHECK (length(secret_envelope) BETWEEN 1 AND 512),
  CHECK ((secret_generation IS NULL AND secret_envelope IS NULL)
    OR (secret_generation IS NOT NULL AND secret_envelope IS NOT NULL AND version > 0))
);
ALTER TABLE cloud_sessions ADD CONSTRAINT cloud_sessions_factor_account_unique UNIQUE (id, account_id);
CREATE TABLE cloud_factor_enrolments (
  id uuid NOT NULL UNIQUE,
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  session_id uuid NOT NULL,
  password_fingerprint text NOT NULL CHECK (password_fingerprint ~ '^[0-9a-f]{64}$'),
  base_version integer NOT NULL CHECK (base_version >= 0),
  secret_envelope text NOT NULL CHECK (length(secret_envelope) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  attempt_limit integer NOT NULL CHECK (attempt_limit > 0 AND attempts <= attempt_limit),
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  FOREIGN KEY (session_id, account_id) REFERENCES cloud_sessions(id, account_id)
);
CREATE INDEX cloud_factor_enrolments_account_idx ON cloud_factor_enrolments(account_id);
CREATE INDEX cloud_factor_enrolments_expiry_idx ON cloud_factor_enrolments(expires_at);
CREATE TABLE cloud_factor_login_challenges (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  password_fingerprint text NOT NULL CHECK (password_fingerprint ~ '^[0-9a-f]{64}$'),
  factor_version integer NOT NULL CHECK (factor_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  attempt_limit integer NOT NULL CHECK (attempt_limit > 0 AND attempts <= attempt_limit),
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX cloud_factor_login_challenges_account_idx ON cloud_factor_login_challenges(account_id);
CREATE INDEX cloud_factor_login_challenges_expiry_idx ON cloud_factor_login_challenges(expires_at);
CREATE TABLE cloud_factor_recovery_codes (
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  secret_generation uuid NOT NULL,
  factor_version integer NOT NULL CHECK (factor_version > 0),
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  consumed_at timestamptz,
  PRIMARY KEY (account_id, secret_generation, code_hash)
);
CREATE TABLE cloud_factor_replays (
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  secret_generation uuid NOT NULL,
  time_step bigint NOT NULL CHECK (time_step >= 0),
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  valid_until timestamptz NOT NULL,
  PRIMARY KEY (account_id, secret_generation, time_step)
);
CREATE INDEX cloud_factor_replays_code_idx ON cloud_factor_replays(account_id, secret_generation, code_hash);
