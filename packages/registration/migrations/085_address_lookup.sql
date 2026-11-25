CREATE TABLE address_lookup_calls (
 installation_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 workflow_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 account_id uuid NOT NULL,
 class text NOT NULL CHECK (class IN ('free','paid')),
 kind text NOT NULL CHECK (kind IN ('suggest','validate')),
 admitted_at timestamptz NOT NULL,
 PRIMARY KEY (installation_id, operation_id)
);
CREATE INDEX address_lookup_calls_period ON address_lookup_calls (admitted_at);
CREATE INDEX address_lookup_calls_workflow ON address_lookup_calls (installation_id, workflow_id, admitted_at);
CREATE UNIQUE INDEX address_lookup_calls_one_validation ON address_lookup_calls (installation_id, workflow_id) WHERE kind='validate';

CREATE TABLE address_lookup_stopped_venues (
 venue_id uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE
);
