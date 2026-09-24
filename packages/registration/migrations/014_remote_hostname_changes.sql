CREATE TABLE remote_hostname_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 installation_id uuid NOT NULL REFERENCES installations(id),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 kind text NOT NULL CHECK (kind IN ('staff','public')),
 hostname text NOT NULL,
 configuration_revision integer NOT NULL CHECK (configuration_revision > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
