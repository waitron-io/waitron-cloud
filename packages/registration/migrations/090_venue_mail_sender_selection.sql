ALTER TABLE venue_mail_signing ADD COLUMN verified boolean NOT NULL DEFAULT false;

ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check CHECK(kind IN
 ('verification','password_reset','password_changed','service_alert','sign_in_check','email_change','email_changed','operator_notice','owner_transfer','venue_signing_lost'));
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_notice_token_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_notice_token_check CHECK((kind IN
 ('password_changed','service_alert','email_changed','operator_notice','owner_transfer','venue_signing_lost'))=(token_hash IS NULL));
