ALTER TABLE backup_jobs DROP CONSTRAINT backup_jobs_last_error_check;
ALTER TABLE backup_jobs ADD CONSTRAINT backup_jobs_last_error_check
 CHECK(last_error IN ('operation_failed','verification_failed','verification_unavailable','key_unavailable','attempts_exhausted'));
