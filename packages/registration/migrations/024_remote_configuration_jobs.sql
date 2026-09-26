CREATE TABLE remote_configuration_jobs (
 kind text NOT NULL CHECK (kind IN ('route','certificate_staff','certificate_public')),
 target_id uuid NOT NULL,
 desired_digest text NOT NULL CHECK (desired_digest ~ '^[a-f0-9]{64}$'),
 applied_digest text CHECK (applied_digest ~ '^[a-f0-9]{64}$'),
 enabled boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','failed')),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_id uuid,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
 runs bigint NOT NULL DEFAULT 0 CHECK (runs >= 0),
 failures bigint NOT NULL DEFAULT 0 CHECK (failures >= 0),
 last_error text,
 last_success_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (kind,target_id),
 CHECK ((status='running' AND claim_id IS NOT NULL AND lease_until IS NOT NULL)
   OR (status<>'running' AND claim_id IS NULL AND lease_until IS NULL)),
 CHECK (status<>'failed' OR attempts=8)
);
CREATE INDEX remote_configuration_jobs_due ON remote_configuration_jobs (available_at,kind,target_id)
 WHERE enabled AND status='pending';
CREATE INDEX remote_configuration_jobs_expired_leases ON remote_configuration_jobs (lease_until)
 WHERE enabled AND status='running';
