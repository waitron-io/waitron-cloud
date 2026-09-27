CREATE FUNCTION support_grant_actions_valid(value text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT cardinality(value) BETWEEN 1 AND 100
    AND value = ARRAY(
      SELECT action
      FROM unnest(value) AS action
      WHERE action ~ '^[a-z][a-z0-9_.:-]{0,99}$'
      GROUP BY action
      ORDER BY action
    )
$$;

ALTER TABLE venues ADD CONSTRAINT venues_id_organisation_key UNIQUE (id, organisation_id);

CREATE TABLE support_grants (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  venue_id uuid,
  platform_account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  approved_by_account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  actions text[] NOT NULL CHECK (support_grant_actions_valid(actions)),
  reason text NOT NULL CHECK (reason = btrim(reason) AND length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_account_id uuid REFERENCES cloud_accounts(id),
  FOREIGN KEY (venue_id, organisation_id) REFERENCES venues(id, organisation_id),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_by_account_id IS NULL))
);

CREATE INDEX support_grants_organisation_idx
  ON support_grants (organisation_id, created_at DESC, id DESC);
CREATE INDEX support_grants_platform_account_idx
  ON support_grants (platform_account_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE security_audit_events
  DROP CONSTRAINT security_audit_events_event_type_check,
  ADD CONSTRAINT security_audit_events_event_type_check CHECK (event_type IN (
    'pairing.cloud_approved',
    'pairing.local_approved',
    'installation.credentials_renewed',
    'installation.revoked',
    'recovery.approved',
    'replacement.approved',
    'support.granted',
    'support.revoked',
    'support.accessed'
  )),
  DROP CONSTRAINT security_audit_events_actor_kind_check,
  ADD CONSTRAINT security_audit_events_actor_kind_check CHECK (actor_kind IN (
    'account', 'installation', 'local_authority', 'platform_account'
  )),
  DROP CONSTRAINT security_audit_events_subject_kind_check,
  ADD CONSTRAINT security_audit_events_subject_kind_check CHECK (subject_kind IN (
    'pairing_request', 'installation', 'recovery', 'replacement', 'support_grant'
  ));
