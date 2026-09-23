ALTER TABLE installations ADD COLUMN configuration_revision integer NOT NULL DEFAULT 0 CHECK (configuration_revision >= 0);
ALTER TABLE installations ADD COLUMN last_contact_at timestamptz;
ALTER TABLE installations ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE installation_services ADD COLUMN configuration jsonb NOT NULL DEFAULT '{}';
CREATE TABLE installation_operations (
  installation_id uuid NOT NULL REFERENCES installations(id),
  operation_id uuid NOT NULL,
  digest text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, operation_id)
);
CREATE TABLE installation_observations (
  installation_id uuid NOT NULL,
  service text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  health text NOT NULL CHECK (health IN ('unknown','healthy','degraded','failed')),
  failure text CHECK (failure IN ('unavailable','authentication','configuration','storage','capacity')),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, service),
  FOREIGN KEY (installation_id, service) REFERENCES installation_services(installation_id, service)
);
