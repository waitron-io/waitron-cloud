CREATE TABLE relay_grants (
 id uuid PRIMARY KEY,
 installation_id uuid NOT NULL UNIQUE REFERENCES installations(id),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 organisation_id uuid NOT NULL REFERENCES organisations(id),
 venue_id uuid NOT NULL REFERENCES venues(id),
 environment text NOT NULL CHECK (environment='test'),
 public_key text NOT NULL,
 management_origin text NOT NULL,
 consent_version text NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 origin_verified_until timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK (expires_at>created_at),
 CHECK (origin_verified_until>=expires_at),
 FOREIGN KEY (venue_id,organisation_id) REFERENCES venues(id,organisation_id)
);

CREATE TABLE relay_policies (
 version text PRIMARY KEY,
 definition jsonb NOT NULL
);
CREATE TABLE relay_account_policies (
 account_id uuid PRIMARY KEY REFERENCES cloud_accounts(id),
 policy_version text NOT NULL REFERENCES relay_policies(version)
);
CREATE TABLE relay_reservations (
 installation_id uuid NOT NULL REFERENCES installations(id),
 message_id uuid NOT NULL,
 grant_id uuid NOT NULL REFERENCES relay_grants(id),
 grant_revision integer NOT NULL CHECK (grant_revision>0),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 policy_version text NOT NULL REFERENCES relay_policies(version),
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL,
 binding text NOT NULL CHECK (length(binding) BETWEEN 1 AND 256),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (installation_id,message_id),
 CHECK (period_end>period_start)
);
CREATE INDEX relay_reservations_account_period_idx ON relay_reservations(account_id,period_start);
