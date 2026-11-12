-- Retain revoked or deleted session references without preventing session-history cleanup.
ALTER TABLE billing_method_setups ADD COLUMN cloud_session_id uuid;
ALTER TABLE billing_method_setups ADD COLUMN cloud_security_revision integer CHECK(cloud_security_revision>=0);
