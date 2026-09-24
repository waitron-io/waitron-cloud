CREATE TABLE account_alert_preferences (
 account_id uuid PRIMARY KEY REFERENCES cloud_accounts(id),
 enabled boolean NOT NULL DEFAULT false,
 locale text NOT NULL DEFAULT 'en' CHECK(locale IN ('en','es'))
);
CREATE TABLE venue_monitors (
 venue_id uuid PRIMARY KEY REFERENCES venues(id),
 next_check_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 checked_at timestamptz,
 contact_since timestamptz,
 snapshot_since timestamptz,
 failure_point_id uuid,
 failure_since timestamptz
);
CREATE INDEX venue_monitors_due ON venue_monitors(next_check_at,venue_id);
CREATE TABLE venue_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 venue_id uuid NOT NULL REFERENCES venues(id),
 kind text NOT NULL CHECK(kind IN ('disconnected','snapshot_stale','verification_failed')),
 status text NOT NULL CHECK(status IN ('open','recovered','suppressed')),
 revision integer NOT NULL CHECK(revision>0),
 opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(venue_id,kind)
);
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK(kind IN ('verification','password_reset','password_changed','service_alert'));
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_check1;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_notice_token_check CHECK((kind IN ('password_changed','service_alert'))=(token_hash IS NULL));
CREATE TABLE service_alert_deliveries (
 outbox_id uuid PRIMARY KEY REFERENCES email_outbox(id),
 incident_id uuid NOT NULL REFERENCES venue_incidents(id),
 revision integer NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('open','recovered')),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 UNIQUE(incident_id,revision,account_id)
);
