CREATE TABLE cloud_email_changes (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  session_token_hash text NOT NULL REFERENCES cloud_sessions(token_hash) ON DELETE CASCADE,
  email text NOT NULL,
  previous_email text NOT NULL,
  password_fingerprint text NOT NULL CHECK (password_fingerprint ~ '^[0-9a-f]{64}$'),
  security_revision integer NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en','es')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes')
);
CREATE INDEX cloud_email_changes_account_idx ON cloud_email_changes(account_id);
CREATE INDEX cloud_email_changes_email_time_idx ON cloud_email_changes(email,created_at);
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('verification','password_reset','password_changed','service_alert','sign_in_check','email_change','email_changed'));
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_notice_token_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_notice_token_check
  CHECK ((kind IN ('password_changed','service_alert','email_changed')) = (token_hash IS NULL));
