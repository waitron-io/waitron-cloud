CREATE TABLE password_reset_requests (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  account_id uuid REFERENCES cloud_accounts(id),
  password_fingerprint text CHECK (password_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((account_id IS NULL AND password_fingerprint IS NULL)
    OR (account_id IS NOT NULL AND password_fingerprint IS NOT NULL))
);
CREATE INDEX password_reset_requests_email_created_idx ON password_reset_requests(email, created_at DESC);
CREATE INDEX password_reset_requests_account_idx ON password_reset_requests(account_id);
