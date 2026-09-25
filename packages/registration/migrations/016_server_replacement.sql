ALTER TABLE installations DROP CONSTRAINT installations_venue_id_key;
ALTER TABLE installations ADD COLUMN superseded_by uuid REFERENCES installations(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE installations ADD CONSTRAINT installations_superseded_revoked CHECK (superseded_by IS NULL OR (revoked_at IS NOT NULL AND superseded_by<>id));
CREATE UNIQUE INDEX installations_current_venue_key ON installations(venue_id) WHERE superseded_by IS NULL;
CREATE TABLE installation_replacements (
 id uuid PRIMARY KEY REFERENCES backup_recoveries(id),
 venue_id uuid NOT NULL REFERENCES venues(id),
 old_installation_id uuid NOT NULL REFERENCES installations(id),
 public_key text NOT NULL UNIQUE,
 peer_public_key text NOT NULL UNIQUE,
 old_peer_public_key text,
 local_venue_id uuid NOT NULL,
 node_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 result jsonb,
 CHECK ((result IS NULL)=(completed_at IS NULL))
);

CREATE UNIQUE INDEX installation_replacements_completed_old_key
 ON installation_replacements(old_installation_id) WHERE result IS NOT NULL;
