ALTER TABLE organisation_memberships ADD COLUMN owner_since timestamptz;

-- Earlier handovers have no accepted-at time. Existing owners start at migration time.
UPDATE organisation_memberships SET owner_since = statement_timestamp() WHERE is_owner;

ALTER TABLE installation_error_reports
  ADD COLUMN staff_receipt_owner_id uuid,
  ADD COLUMN staff_report_body text,
  ADD COLUMN staff_description_body text,
  ADD COLUMN staff_description_at timestamptz;
