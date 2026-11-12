-- Session history can be removed; credential delivery rechecks the saved identifier.
ALTER TABLE backup_recoveries ADD COLUMN cloud_session_id uuid;
ALTER TABLE backup_recoveries ADD COLUMN cloud_security_revision integer CHECK(cloud_security_revision>=0);
