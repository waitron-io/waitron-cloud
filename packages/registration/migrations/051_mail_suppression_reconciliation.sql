ALTER TABLE relay_suppressions ADD COLUMN block_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE relay_suppressions ADD UNIQUE(block_id);
CREATE TRIGGER relay_suppression_identity_immutable BEFORE UPDATE ON relay_suppressions
 FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();

CREATE TABLE mail_legacy_suppression_lifetimes (
 block_id uuid NOT NULL,
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 key_id text NOT NULL,
 digest text NOT NULL,
 legacy_key_id text NOT NULL,
 legacy_digest text NOT NULL,
 PRIMARY KEY(block_id,country,provider_account_id,region,key_id,digest,legacy_key_id,legacy_digest),
 FOREIGN KEY(country,provider_account_id,region,key_id,digest,legacy_key_id,legacy_digest)
  REFERENCES mail_legacy_suppression_scopes(country,provider_account_id,region,key_id,digest,legacy_key_id,legacy_digest)
);
INSERT INTO mail_legacy_suppression_lifetimes
 SELECT b.block_id,s.country,s.provider_account_id,s.region,s.key_id,s.digest,s.legacy_key_id,s.legacy_digest
 FROM mail_legacy_suppression_scopes s JOIN relay_suppressions b
 ON b.key_id=s.legacy_key_id AND b.digest=s.legacy_digest;
CREATE TRIGGER mail_legacy_lifetimes_immutable BEFORE UPDATE OR DELETE ON mail_legacy_suppression_lifetimes
 FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_legacy_lifetimes_no_truncate BEFORE TRUNCATE ON mail_legacy_suppression_lifetimes
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();

CREATE TABLE mail_unblock_requests (
 id uuid PRIMARY KEY,
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 revision integer NOT NULL CHECK(revision>=0),
 operator_id uuid NOT NULL REFERENCES cloud_accounts(id),
 reason text NOT NULL CHECK(reason ~ '^[a-z][a-z0-9_-]{2,63}$'),
 recipient_refs jsonb NOT NULL CHECK(jsonb_typeof(recipient_refs)='array'),
 prior_evidence jsonb NOT NULL CHECK(jsonb_typeof(prior_evidence)='object'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(country ~ '^[A-Z]{2}$' AND provider_account_id ~ '^[0-9]{12}$' AND region IN ('eu-north-1','eu-west-3'))
);
ALTER TABLE mail_suppression_actions ADD COLUMN operation_id uuid REFERENCES mail_unblock_requests(id);
CREATE TRIGGER mail_unblock_requests_immutable BEFORE UPDATE OR DELETE ON mail_unblock_requests
 FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_unblock_requests_no_truncate BEFORE TRUNCATE ON mail_unblock_requests
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();

CREATE TABLE mail_suppression_revisions (
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 PRIMARY KEY(country,provider_account_id,region),
 CHECK(country ~ '^[A-Z]{2}$' AND provider_account_id ~ '^[0-9]{12}$' AND region IN ('eu-north-1','eu-west-3'))
);
CREATE TABLE mail_unblock_outcomes (
 operation_id uuid PRIMARY KEY REFERENCES mail_unblock_requests(id),
 operator_id uuid NOT NULL REFERENCES cloud_accounts(id),
 result text NOT NULL CHECK(result IN ('cleared','blocked')),
 diagnostic text NOT NULL CHECK(diagnostic IN ('cleared','provider_unconfirmed','evidence_changed','legacy_unreconciled')),
 provider_evidence jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER mail_unblock_outcomes_immutable BEFORE UPDATE OR DELETE ON mail_unblock_outcomes
 FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_unblock_outcomes_no_truncate BEFORE TRUNCATE ON mail_unblock_outcomes
 FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
