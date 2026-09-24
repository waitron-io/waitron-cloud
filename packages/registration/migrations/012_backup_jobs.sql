CREATE TABLE backup_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('verify','retention','incoming')),
 venue_id uuid NOT NULL REFERENCES backup_locations(venue_id),
 target_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','failed','completed')),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_id uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 runs bigint NOT NULL DEFAULT 0 CHECK(runs>=0),
 failures bigint NOT NULL DEFAULT 0 CHECK(failures>=0),
 last_error text CHECK(last_error IN ('operation_failed','verification_failed','key_unavailable','attempts_exhausted')),
 last_success_at timestamptz,
 UNIQUE(kind,target_id),
 CHECK((status='running' AND claim_id IS NOT NULL AND lease_until IS NOT NULL)
  OR(status<>'running' AND claim_id IS NULL AND lease_until IS NULL))
);
CREATE INDEX backup_jobs_due ON backup_jobs(available_at,id) WHERE status='pending';
CREATE INDEX backup_jobs_expired_leases ON backup_jobs(lease_until) WHERE status='running';
ALTER TABLE backup_captures ADD COLUMN expired_at timestamptz;
ALTER TABLE backup_captures ADD COLUMN cleaned_at timestamptz;
CREATE INDEX backup_captures_uncleaned ON backup_captures(venue_id,created_at) WHERE cleaned_at IS NULL;
CREATE INDEX backup_points_catalogue ON backup_points(venue_id,captured_at DESC,id DESC) WHERE NOT deleting AND deleted_at IS NULL;
CREATE INDEX backup_verifications_success ON backup_verifications(point_id) WHERE outcome='verified';
