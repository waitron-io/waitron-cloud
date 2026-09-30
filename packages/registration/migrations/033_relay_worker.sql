ALTER TABLE relay_messages
 ADD COLUMN claim_id uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
 ADD COLUMN available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD CONSTRAINT relay_claim_pair CHECK ((claim_id IS NULL)=(lease_until IS NULL)),
 ADD CONSTRAINT relay_claim_state CHECK (state IN ('queued','sending') OR claim_id IS NULL),
 ADD CONSTRAINT relay_sending_claim CHECK (state<>'sending' OR claim_id IS NOT NULL),
 ADD CONSTRAINT relay_state_reason CHECK (
  (state IN ('queued','sending','accepted') AND reason IS NULL)
  OR (state='uncertain' AND reason IS NOT DISTINCT FROM 'uncertain')
  OR (state='failed' AND reason IS NOT NULL AND reason IN ('payload_unavailable','refused'))
  OR (state='expired' AND reason IS NOT DISTINCT FROM 'expired')
  OR (state='cancelled' AND reason IS NOT DISTINCT FROM 'cancelled')
 );
CREATE INDEX relay_worker_ready_idx ON relay_messages(available_at,created_at) WHERE state='queued';
CREATE INDEX relay_worker_sending_idx ON relay_messages(lease_until) WHERE state='sending';
CREATE TABLE relay_suppressions (
 key_id text NOT NULL,
 digest text NOT NULL,
 PRIMARY KEY(key_id,digest)
);
