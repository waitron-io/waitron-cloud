ALTER TABLE venue_incidents DROP CONSTRAINT venue_incidents_kind_check;
ALTER TABLE venue_incidents ADD CONSTRAINT venue_incidents_kind_check CHECK(kind IN (
 'disconnected','snapshot_stale','verification_failed',
 'public_route_failed','staff_route_failed','public_probe_stale','staff_probe_stale',
 'public_certificate_expiring','staff_certificate_expiring',
 'public_record_moved','staff_record_moved'
));
