CREATE TABLE pairing_requests (
  id uuid PRIMARY KEY,
  public_key text NOT NULL,
  local_venue_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
  failed_codes integer NOT NULL DEFAULT 0 CHECK (failed_codes BETWEEN 0 AND 5),
  cloud_account_id uuid REFERENCES cloud_accounts(id),
  organisation_id uuid,
  legal_business_id uuid,
  result jsonb,
  FOREIGN KEY (legal_business_id,organisation_id) REFERENCES legal_businesses(id,organisation_id),
  CHECK ((cloud_account_id IS NULL AND organisation_id IS NULL AND legal_business_id IS NULL AND result IS NULL)
    OR (cloud_account_id IS NOT NULL AND organisation_id IS NOT NULL AND legal_business_id IS NOT NULL))
);
CREATE INDEX pairing_requests_expiry_idx ON pairing_requests(expires_at) WHERE result IS NULL;
