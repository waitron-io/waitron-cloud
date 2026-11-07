ALTER TABLE installation_error_reports
  ADD COLUMN kind text NOT NULL DEFAULT 'automatic',
  ADD COLUMN details jsonb,
  ADD COLUMN description text,
  ADD COLUMN description_operation_id uuid,
  ADD COLUMN description_digest text,
  ALTER COLUMN code DROP NOT NULL,
  ALTER COLUMN source DROP NOT NULL,
  ALTER COLUMN occurrences DROP NOT NULL;

ALTER TABLE installation_error_reports ADD CONSTRAINT installation_error_reports_kind CHECK (
  (kind = 'automatic' AND code IS NOT NULL AND source IS NOT NULL AND occurrences IS NOT NULL
    AND details IS NULL AND description IS NULL AND description_operation_id IS NULL AND description_digest IS NULL)
  OR
  (kind = 'staff' AND code IS NULL AND source IS NULL AND occurrences IS NULL
    AND details IS NOT NULL AND jsonb_typeof(details) = 'object'
    AND (description IS NULL OR (length(description) BETWEEN 1 AND 2000 AND octet_length(description) <= 8192))
    AND ((description_operation_id IS NULL AND description_digest IS NULL)
      OR (description_operation_id IS NOT NULL AND description IS NOT NULL AND description_digest IS NOT NULL AND description_digest ~ '^[a-f0-9]{64}$')))
);
CREATE UNIQUE INDEX installation_error_reports_description_operation ON installation_error_reports(installation_id,description_operation_id)
  WHERE description_operation_id IS NOT NULL;
