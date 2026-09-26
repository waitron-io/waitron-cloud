CREATE TABLE security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  venue_id uuid REFERENCES venues(id),
  event_type text NOT NULL CHECK (event_type IN (
    'pairing.cloud_approved',
    'pairing.local_approved',
    'installation.credentials_renewed',
    'installation.revoked',
    'recovery.approved',
    'replacement.approved'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('account', 'installation', 'local_authority')),
  actor_id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('pairing_request', 'installation', 'recovery', 'replacement')),
  subject_id uuid NOT NULL,
  source_id uuid NOT NULL,
  UNIQUE (event_type, source_id)
);

CREATE INDEX security_audit_events_organisation_page_idx
  ON security_audit_events (organisation_id, occurred_at DESC, id DESC);

CREATE FUNCTION reject_security_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security_audit_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER security_audit_events_immutable
BEFORE UPDATE OR DELETE ON security_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_security_audit_mutation();
