CREATE TABLE email_outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('verification', 'password_reset', 'password_changed')),
  token_hash text CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  key_id text,
  payload bytea,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'expired', 'cancelled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_id uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND attempts),
  last_error text CHECK (last_error IN ('delivery_failed', 'payload_unavailable', 'attempts_exhausted')),
  finished_at timestamptz,
  CHECK ((kind = 'password_changed') = (token_hash IS NULL)),
  CHECK ((status = 'processing') = (claim_id IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((status IN ('pending', 'processing') AND payload IS NOT NULL AND key_id IS NOT NULL AND finished_at IS NULL)
    OR (status IN ('sent', 'expired', 'cancelled', 'failed') AND payload IS NULL AND key_id IS NULL AND finished_at IS NOT NULL))
);
CREATE INDEX email_outbox_due ON email_outbox (available_at, created_at) WHERE status = 'pending';
CREATE INDEX email_outbox_leases ON email_outbox (lease_until) WHERE status = 'processing';
