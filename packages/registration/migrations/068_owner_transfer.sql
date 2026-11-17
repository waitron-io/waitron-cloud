CREATE UNIQUE INDEX organisation_single_owner ON organisation_memberships(organisation_id) WHERE is_owner;
CREATE TABLE owner_transfers (
 id uuid PRIMARY KEY,
 organisation_id uuid NOT NULL REFERENCES organisations(id),
 sender_id uuid NOT NULL REFERENCES cloud_accounts(id),
 recipient_id uuid REFERENCES cloud_accounts(id),
 sender_email text NOT NULL,
 recipient_email text NOT NULL,
 recipient_needs_enrolment boolean NOT NULL,
 locale text NOT NULL CHECK(locale IN ('en','es')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','cancelled','expired')),
 CHECK(expires_at>created_at), CHECK(sender_id IS DISTINCT FROM recipient_id)
);
CREATE UNIQUE INDEX owner_transfer_pending ON owner_transfers(organisation_id) WHERE state='pending';
CREATE INDEX owner_transfer_sender ON owner_transfers(sender_id,created_at);
CREATE INDEX owner_transfer_recipient ON owner_transfers(recipient_id,created_at);

ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK(kind IN ('verification','password_reset','password_changed','service_alert','sign_in_check','email_change','email_changed','operator_notice','owner_transfer'));
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_notice_token_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_notice_token_check CHECK((kind IN ('password_changed','service_alert','email_changed','operator_notice','owner_transfer'))=(token_hash IS NULL));
