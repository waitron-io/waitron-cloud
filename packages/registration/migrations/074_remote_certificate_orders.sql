CREATE TABLE remote_certificate_orders (
 hostname text PRIMARY KEY,
 claim_id uuid NOT NULL,
 expires_at timestamptz NOT NULL
);

ALTER TABLE remote_hostnames ADD COLUMN record_moved_at timestamptz;
