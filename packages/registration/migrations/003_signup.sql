ALTER TABLE cloud_credentials ADD COLUMN email_verified_at timestamptz;
ALTER TABLE organisations ADD COLUMN name text CHECK (length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE legal_businesses ADD COLUMN name text CHECK (length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE legal_businesses ADD COLUMN country_code text CHECK (country_code ~ '^[A-Z]{2}$');
ALTER TABLE organisation_memberships ADD COLUMN is_owner boolean NOT NULL DEFAULT false;

CREATE TABLE signup_requests (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX signup_requests_email_created_idx ON signup_requests(email, created_at DESC);
