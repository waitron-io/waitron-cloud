CREATE TABLE mail_legacy_suppression_scopes (
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 key_id text NOT NULL,
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 legacy_key_id text NOT NULL CHECK (legacy_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 legacy_digest text NOT NULL CHECK (legacy_digest ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(country,provider_account_id,region,key_id,digest,legacy_key_id,legacy_digest),
 FOREIGN KEY(country,provider_account_id,region,key_id)
  REFERENCES mail_recipient_key_versions(country,provider_account_id,region,key_id)
);
-- Keep attribution after a separately authorised reconciliation removes the local block.
CREATE TRIGGER mail_legacy_scopes_immutable BEFORE UPDATE OR DELETE ON mail_legacy_suppression_scopes
 FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_legacy_scopes_no_truncate BEFORE TRUNCATE ON mail_legacy_suppression_scopes
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
