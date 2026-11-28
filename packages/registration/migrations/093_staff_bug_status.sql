ALTER TABLE installation_error_reports
  ADD COLUMN bug_issue_repository text,
  ADD COLUMN bug_issue_number integer,
  ADD COLUMN bug_status text,
  ADD COLUMN fixed_version text,
  ADD CONSTRAINT installation_error_reports_bug_status_check CHECK (
    (bug_issue_repository IS NULL AND bug_issue_number IS NULL AND bug_status IS NULL AND fixed_version IS NULL)
    OR (
      kind = 'staff' AND environment = 'test'
      AND bug_issue_repository IS NOT NULL AND bug_issue_repository IN ('clintongormley/waitron', 'waitron-io/waitron-cloud')
      AND bug_issue_number IS NOT NULL AND bug_issue_number > 0
      AND bug_status IS NOT NULL AND bug_status IN ('open', 'in_progress', 'fixed')
      AND (bug_status = 'fixed') = (fixed_version IS NOT NULL)
    )
  );
