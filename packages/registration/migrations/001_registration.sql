CREATE TABLE cloud_accounts (
  id uuid PRIMARY KEY,
  disabled_at timestamptz
);
CREATE TABLE organisations (id uuid PRIMARY KEY);
CREATE TABLE legal_businesses (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  UNIQUE (id, organisation_id)
);
CREATE TABLE organisation_memberships (
  account_id uuid NOT NULL REFERENCES cloud_accounts(id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  can_register_venues boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, organisation_id)
);
CREATE TABLE venues (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  legal_business_id uuid NOT NULL,
  local_venue_id uuid NOT NULL,
  environment text NOT NULL CHECK (length(environment) BETWEEN 1 AND 64),
  FOREIGN KEY (legal_business_id, organisation_id) REFERENCES legal_businesses(id, organisation_id),
  UNIQUE (environment, local_venue_id)
);
CREATE TABLE installations (
  id uuid PRIMARY KEY,
  venue_id uuid NOT NULL UNIQUE REFERENCES venues(id),
  public_key text NOT NULL UNIQUE CHECK (length(public_key) BETWEEN 1 AND 256),
  revoked_at timestamptz
);
CREATE TABLE installation_services (
  installation_id uuid NOT NULL REFERENCES installations(id),
  service text NOT NULL CHECK (service IN ('remote_access', 'continuous_backup', 'retained_snapshots')),
  state text NOT NULL DEFAULT 'unconfigured' CHECK (state IN ('unconfigured', 'provisioning', 'ready', 'failed')),
  PRIMARY KEY (installation_id, service)
);
CREATE TABLE connection_requests (
  operation_id uuid NOT NULL,
  installation_key text NOT NULL CHECK (length(installation_key) BETWEEN 1 AND 256),
  local_venue_id uuid NOT NULL,
  environment text NOT NULL CHECK (length(environment) BETWEEN 1 AND 64),
  organisation_id uuid NOT NULL,
  legal_business_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '10 minutes'),
  local_receipt_id uuid UNIQUE,
  cloud_account_id uuid REFERENCES cloud_accounts(id),
  completed_installation_id uuid REFERENCES installations(id),
  completed_at timestamptz,
  result jsonb,
  PRIMARY KEY (installation_key, operation_id),
  FOREIGN KEY (legal_business_id, organisation_id) REFERENCES legal_businesses(id, organisation_id),
  CHECK ((result IS NULL AND completed_at IS NULL AND completed_installation_id IS NULL)
    OR (result IS NOT NULL AND completed_at IS NOT NULL AND completed_installation_id IS NOT NULL
      AND local_receipt_id IS NOT NULL AND cloud_account_id IS NOT NULL))
);
