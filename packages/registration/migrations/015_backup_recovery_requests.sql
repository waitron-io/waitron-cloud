CREATE TABLE backup_recovery_requests (
 id uuid PRIMARY KEY,
 public_key text NOT NULL UNIQUE,
 code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 failed_codes integer NOT NULL DEFAULT 0 CHECK (failed_codes BETWEEN 0 AND 5),
 account_id uuid REFERENCES cloud_accounts(id),
 operation_id uuid UNIQUE REFERENCES backup_recoveries(id),
 CHECK ((account_id IS NULL) = (operation_id IS NULL)),
 CHECK (operation_id IS NULL OR operation_id=id)
);
