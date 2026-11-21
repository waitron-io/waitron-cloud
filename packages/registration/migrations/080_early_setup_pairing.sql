ALTER TABLE setup_pairing_attempts
  ADD COLUMN version smallint NOT NULL DEFAULT 4 CHECK (version IN (4, 5)),
  ADD COLUMN provisional_registration jsonb;

ALTER TABLE installations
  ADD COLUMN setup_pairing_account_id uuid REFERENCES cloud_accounts(id) ON DELETE SET NULL;
