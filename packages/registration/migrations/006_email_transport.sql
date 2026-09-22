ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_last_error_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_last_error_check CHECK (last_error IN (
  'delivery_failed', 'payload_unavailable', 'attempts_exhausted',
  'delivery_timeout', 'delivery_deferred', 'delivery_rejected', 'delivery_configuration'
));
ALTER TABLE email_outbox ADD COLUMN transport text CHECK (transport = 'smtp');
ALTER TABLE email_outbox ADD COLUMN message_id text CHECK (length(message_id) BETWEEN 1 AND 512);
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_receipt_check CHECK (
  (transport IS NULL AND message_id IS NULL) OR (transport IS NOT NULL AND message_id IS NOT NULL AND status = 'sent')
);
