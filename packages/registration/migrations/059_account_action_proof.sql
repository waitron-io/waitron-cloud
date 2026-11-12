ALTER TABLE cloud_sessions ADD COLUMN action_proved_at timestamptz;
ALTER TABLE cloud_sessions ADD COLUMN action_proof_method text
  CHECK (action_proof_method IN ('email','app','passkey','recovery'));
ALTER TABLE cloud_sign_in_checks ADD COLUMN action_session_token_hash text
  CHECK (action_session_token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE cloud_webauthn_ceremonies ADD COLUMN action_session_token_hash text
  CHECK (action_session_token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE cloud_sessions ADD COLUMN action_security_revision integer NOT NULL DEFAULT 0 CHECK(action_security_revision>=0);
ALTER TABLE cloud_sessions ADD COLUMN action_credential_fingerprint text CHECK(action_credential_fingerprint ~ '^[0-9a-f]{64}$');
