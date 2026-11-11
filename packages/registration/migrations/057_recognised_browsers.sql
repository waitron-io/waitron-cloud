CREATE TABLE cloud_recognised_browsers (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX cloud_recognised_browsers_account_idx ON cloud_recognised_browsers(account_id);
