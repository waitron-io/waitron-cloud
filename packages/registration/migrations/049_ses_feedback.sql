CREATE TABLE mail_queue_scopes (
 purpose text NOT NULL CHECK (purpose IN ('cloud-account-email','venue-email')),
 installation_id uuid NOT NULL,
 queue_id uuid NOT NULL,
 country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
 provider_account_id text NOT NULL CHECK (provider_account_id ~ '^[0-9]{12}$'),
 region text NOT NULL CHECK (region IN ('eu-north-1','eu-west-3')),
 PRIMARY KEY(purpose,installation_id,queue_id),
 UNIQUE(purpose,installation_id,queue_id,country,provider_account_id,region),
 CHECK ((purpose='cloud-account-email')=(installation_id='00000000-0000-0000-0000-000000000000'))
);
CREATE TABLE mail_recipient_key_versions (
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 key_id text NOT NULL CHECK (key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 commitment text NOT NULL CHECK (commitment ~ '^[0-9a-f]{64}$'),
 revoked boolean NOT NULL DEFAULT false,
 PRIMARY KEY(country,provider_account_id,region,key_id),
 CHECK (country ~ '^[A-Z]{2}$' AND provider_account_id ~ '^[0-9]{12}$' AND region IN ('eu-north-1','eu-west-3'))
);
CREATE TABLE mail_attempts (
 attempt_tag text PRIMARY KEY CHECK (attempt_tag ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
 purpose text NOT NULL,
 installation_id uuid NOT NULL,
 queue_id uuid NOT NULL,
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 policy_revision integer NOT NULL CHECK (policy_revision>0),
 configuration_revision text NOT NULL CHECK (configuration_revision ~ '^[A-Za-z0-9_-]{1,128}$'),
 configuration_set text NOT NULL CHECK (configuration_set ~ '^[A-Za-z0-9_-]{1,128}$'),
 claim_id uuid NOT NULL,
 attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 8),
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 one_recipient boolean NOT NULL DEFAULT true CHECK (one_recipient),
 recipient_refs_sealed boolean NOT NULL DEFAULT false,
 provider_message_id text CHECK (provider_message_id ~ '^[!-~]+$' AND length(provider_message_id) BETWEEN 1 AND 256),
 FOREIGN KEY(purpose,installation_id,queue_id,country,provider_account_id,region)
   REFERENCES mail_queue_scopes(purpose,installation_id,queue_id,country,provider_account_id,region),
 UNIQUE(purpose,installation_id,queue_id,attempt),
 UNIQUE(provider_account_id,region,provider_message_id),
 UNIQUE(attempt_tag,country,provider_account_id,region)
);
CREATE TABLE mail_attempt_recipients (
 attempt_tag text NOT NULL,
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 key_id text NOT NULL,
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(attempt_tag,key_id),
 FOREIGN KEY(attempt_tag,country,provider_account_id,region) REFERENCES mail_attempts(attempt_tag,country,provider_account_id,region),
 FOREIGN KEY(country,provider_account_id,region,key_id) REFERENCES mail_recipient_key_versions(country,provider_account_id,region,key_id)
);
CREATE TABLE mail_feedback_receipts (
 country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
 topic_arn text NOT NULL CHECK (topic_arn ~ '^arn:aws:sns:(eu-north-1|eu-west-3):[0-9]{12}:[A-Za-z0-9_-]{1,80}$'),
 sns_id text NOT NULL CHECK (sns_id ~ '^[!-~]+$' AND length(sns_id) BETWEEN 1 AND 256),
 content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
 result text NOT NULL CHECK (result IN ('applied','ignored','conflict')),
 diagnostic text NOT NULL CHECK (diagnostic IN ('applied','unresolved','binding_conflict','non_blocking')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(country,topic_arn,sns_id),
 CHECK ((result='applied' AND diagnostic='applied') OR (result='conflict' AND diagnostic='binding_conflict')
   OR (result='ignored' AND diagnostic IN ('unresolved','non_blocking')))
);
CREATE TABLE mail_feedback_events (
 id uuid PRIMARY KEY,
 attempt_tag text NOT NULL,
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 recipient_identity text NOT NULL CHECK (recipient_identity ~ '^[0-9a-f]{64}$'),
 event_identity text NOT NULL CHECK (length(event_identity) BETWEEN 1 AND 1024),
 kind text NOT NULL CHECK (kind IN ('delivery','hard_bounce','complaint','provider_suppressed','temporary','unclassified')),
 event_time timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(attempt_tag,recipient_identity,event_identity),
 UNIQUE(id,country,provider_account_id,region),
 FOREIGN KEY(attempt_tag,country,provider_account_id,region) REFERENCES mail_attempts(attempt_tag,country,provider_account_id,region)
);
CREATE TABLE mail_suppressions (
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 key_id text NOT NULL,
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 reason text NOT NULL CHECK (reason IN ('hard_bounce','complaint','provider_suppressed')),
 event_id uuid NOT NULL,
 blocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(country,provider_account_id,region,key_id,digest,reason,event_id),
 FOREIGN KEY(country,provider_account_id,region,key_id) REFERENCES mail_recipient_key_versions(country,provider_account_id,region,key_id),
 FOREIGN KEY(event_id,country,provider_account_id,region) REFERENCES mail_feedback_events(id,country,provider_account_id,region)
);
CREATE TABLE mail_suppression_actions (
 id uuid PRIMARY KEY,
 country text NOT NULL,
 provider_account_id text NOT NULL,
 region text NOT NULL,
 key_id text NOT NULL,
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 operator_id uuid NOT NULL,
 action text NOT NULL CHECK (action IN ('remove','reconcile')),
 reconciliation text NOT NULL CHECK (reconciliation IN ('pending','confirmed','failed')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(country,provider_account_id,region,key_id) REFERENCES mail_recipient_key_versions(country,provider_account_id,region,key_id)
);

CREATE FUNCTION preserve_mail_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'mail_binding_immutable'; END IF;
 IF TG_TABLE_NAME='mail_attempts' THEN
  IF (OLD.recipient_refs_sealed AND NOT NEW.recipient_refs_sealed) OR (to_jsonb(NEW)-'provider_message_id'-'recipient_refs_sealed') IS DISTINCT FROM (to_jsonb(OLD)-'provider_message_id'-'recipient_refs_sealed')
    OR (OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id)
    THEN RAISE EXCEPTION 'mail_binding_immutable'; END IF;
  IF NEW.recipient_refs_sealed AND NOT OLD.recipient_refs_sealed THEN
   PERFORM check_mail_recipient_set(TG_TABLE_SCHEMA,NEW.attempt_tag,NEW.country,NEW.provider_account_id,NEW.region);
  END IF;
 ELSIF TG_TABLE_NAME='mail_recipient_key_versions' THEN
  IF (to_jsonb(NEW)-'revoked') IS DISTINCT FROM (to_jsonb(OLD)-'revoked') OR (OLD.revoked AND NOT NEW.revoked)
    THEN RAISE EXCEPTION 'mail_binding_immutable'; END IF;
 ELSE RAISE EXCEPTION 'mail_binding_immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mail_queue_scopes_immutable BEFORE UPDATE OR DELETE ON mail_queue_scopes FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_attempts_immutable BEFORE UPDATE OR DELETE ON mail_attempts FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_attempt_recipients_immutable BEFORE UPDATE OR DELETE ON mail_attempt_recipients FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_recipient_keys_immutable BEFORE UPDATE OR DELETE ON mail_recipient_key_versions FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_receipts_immutable BEFORE UPDATE OR DELETE ON mail_feedback_receipts FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_events_immutable BEFORE UPDATE OR DELETE ON mail_feedback_events FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();


CREATE FUNCTION check_mail_recipient_set(schema_name text,tag text,country_name text,provider_name text,region_name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refs bigint; required bigint;
BEGIN
 EXECUTE format('SELECT count(*) FROM %I.mail_attempt_recipients WHERE attempt_tag=$1',schema_name) INTO refs USING tag;
 EXECUTE format('SELECT count(*) FROM %I.mail_recipient_key_versions WHERE country=$1 AND provider_account_id=$2 AND region=$3',schema_name)
  INTO required USING country_name,provider_name,region_name;
 IF refs=0 OR refs<>required THEN RAISE EXCEPTION 'mail_attempt_incomplete'; END IF;
END $$;
CREATE FUNCTION preserve_mail_recipient_set() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sealed boolean;
BEGIN
 IF TG_TABLE_NAME='mail_attempts' THEN
  IF NEW.recipient_refs_sealed THEN RAISE EXCEPTION 'mail_binding_immutable'; END IF;
 ELSE
  EXECUTE format('SELECT recipient_refs_sealed FROM %I.mail_attempts WHERE attempt_tag=$1 FOR UPDATE',TG_TABLE_SCHEMA)
   INTO sealed USING NEW.attempt_tag;
  IF sealed IS DISTINCT FROM false THEN RAISE EXCEPTION 'mail_binding_immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mail_attempts_begin_unsealed BEFORE INSERT ON mail_attempts FOR EACH ROW EXECUTE FUNCTION preserve_mail_recipient_set();
CREATE TRIGGER mail_recipient_set_closed BEFORE INSERT ON mail_attempt_recipients FOR EACH ROW EXECUTE FUNCTION preserve_mail_recipient_set();
CREATE FUNCTION require_complete_mail_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sealed boolean;
BEGIN
 EXECUTE format('SELECT recipient_refs_sealed FROM %I.mail_attempts WHERE attempt_tag=$1',TG_TABLE_SCHEMA)
  INTO sealed USING NEW.attempt_tag;
 IF sealed IS DISTINCT FROM true THEN RAISE EXCEPTION 'mail_attempt_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER mail_attempts_complete AFTER INSERT OR UPDATE ON mail_attempts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_complete_mail_attempt();
CREATE TRIGGER mail_actions_immutable BEFORE UPDATE OR DELETE ON mail_suppression_actions FOR EACH ROW EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_queue_scopes_no_truncate BEFORE TRUNCATE ON mail_queue_scopes FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_attempts_no_truncate BEFORE TRUNCATE ON mail_attempts FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_attempt_recipients_no_truncate BEFORE TRUNCATE ON mail_attempt_recipients FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_feedback_receipts_no_truncate BEFORE TRUNCATE ON mail_feedback_receipts FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_feedback_events_no_truncate BEFORE TRUNCATE ON mail_feedback_events FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_suppressions_no_truncate BEFORE TRUNCATE ON mail_suppressions FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_recipient_key_versions_no_truncate BEFORE TRUNCATE ON mail_recipient_key_versions FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
CREATE TRIGGER mail_suppression_actions_no_truncate BEFORE TRUNCATE ON mail_suppression_actions FOR EACH STATEMENT EXECUTE FUNCTION preserve_mail_binding();
