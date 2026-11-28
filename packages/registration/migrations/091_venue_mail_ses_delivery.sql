ALTER TABLE venue_mail_signing ADD COLUMN verified_at timestamptz, ADD COLUMN ses_identity_arn text;
ALTER TABLE mail_attempts ADD COLUMN sender_identity_arn text;
ALTER TABLE relay_messages ADD COLUMN use_waitron_sender boolean NOT NULL DEFAULT false;
