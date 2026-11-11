CREATE TABLE cloud_sign_in_checks (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  email text NOT NULL,
  password_fingerprint text NOT NULL CHECK (password_fingerprint ~ '^[0-9a-f]{64}$'),
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  attempt_limit integer NOT NULL CHECK (attempt_limit > 0 AND attempts <= attempt_limit),
  consumed_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE INDEX cloud_sign_in_checks_account_idx ON cloud_sign_in_checks(account_id);
CREATE INDEX cloud_sign_in_checks_expiry_idx ON cloud_sign_in_checks(expires_at);
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('verification','password_reset','password_changed','service_alert','sign_in_check'));
