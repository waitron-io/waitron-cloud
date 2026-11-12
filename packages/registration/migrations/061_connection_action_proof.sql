-- A deleted session invalidates its pending connection without blocking history cleanup.
ALTER TABLE pairing_requests ADD COLUMN cloud_session_id uuid;
ALTER TABLE pairing_requests ADD COLUMN cloud_security_revision integer CHECK(cloud_security_revision>=0);
