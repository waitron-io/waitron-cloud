ALTER TABLE remote_configuration_jobs DROP CONSTRAINT remote_configuration_jobs_kind_check;
ALTER TABLE remote_configuration_jobs ADD CONSTRAINT remote_configuration_jobs_kind_check
 CHECK (kind IN ('route','certificate_staff','certificate_public','name'));
