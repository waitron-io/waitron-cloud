CREATE TABLE setup_pairing_attempts (
  id uuid PRIMARY KEY,
  public_key text NOT NULL,
  redirect_uri text NOT NULL,
  state text NOT NULL,
  code_challenge text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '10 minutes'),
  cloud_account_id uuid REFERENCES cloud_accounts(id),
  cloud_session_id uuid,
  cloud_security_revision integer,
  credential_hash text,
  code_hash text,
  code_expires_at timestamptz,
  redeemed_at timestamptz,
  cancelled_at timestamptz,
  details_hash text,
  result jsonb
);

CREATE INDEX setup_pairing_attempts_expiry_idx ON setup_pairing_attempts(expires_at, id);
ALTER TABLE venues ADD COLUMN setup_address jsonb;
