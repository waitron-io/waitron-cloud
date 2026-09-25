CREATE TABLE cloud_passkey_users (
  account_id uuid PRIMARY KEY REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  user_handle bytea NOT NULL UNIQUE CHECK (octet_length(user_handle) = 32)
);

CREATE TABLE cloud_passkeys (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES cloud_passkey_users(account_id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE CHECK (
    length(credential_id) BETWEEN 1 AND 1364
    AND credential_id ~ '^[A-Za-z0-9_-]+$'
  ),
  public_key bytea NOT NULL CHECK (octet_length(public_key) BETWEEN 1 AND 8192),
  counter bigint NOT NULL CHECK (counter BETWEEN 0 AND 4294967295),
  transports text[] NOT NULL DEFAULT '{}',
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_used_at timestamptz
);
CREATE INDEX cloud_passkeys_account_idx ON cloud_passkeys(account_id, created_at, id);

ALTER TABLE cloud_sessions ADD CONSTRAINT cloud_sessions_token_account_unique UNIQUE (token_hash, account_id);

CREATE TABLE cloud_webauthn_ceremonies (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  challenge text NOT NULL CHECK (
    length(challenge) BETWEEN 1 AND 512
    AND challenge ~ '^[A-Za-z0-9_-]+$'
  ),
  account_id uuid REFERENCES cloud_accounts(id) ON DELETE CASCADE,
  session_token_hash text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (session_token_hash, account_id)
    REFERENCES cloud_sessions(token_hash, account_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CHECK (
    (kind = 'registration' AND account_id IS NOT NULL AND session_token_hash IS NOT NULL)
    OR (kind = 'authentication' AND account_id IS NULL AND session_token_hash IS NULL)
  )
);
CREATE INDEX cloud_webauthn_ceremonies_expiry_idx ON cloud_webauthn_ceremonies(expires_at)
  WHERE consumed_at IS NULL;
