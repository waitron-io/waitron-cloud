ALTER TABLE backup_recovery_requests DROP CONSTRAINT backup_recovery_requests_code_hash_check;
ALTER TABLE backup_recovery_requests ADD CONSTRAINT backup_recovery_requests_code_hash_check
  CHECK (code_hash ~ '^([0-9a-f]{64}|v1:[A-Za-z0-9_-]{1,64}:[0-9a-f]{64})$');
