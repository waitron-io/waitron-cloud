CREATE TABLE remote_probe_observations (
 installation_id uuid NOT NULL REFERENCES installations(id),
 venue_id uuid NOT NULL REFERENCES venues(id),
 service text NOT NULL CHECK(service IN ('public','staff')),
 configuration_revision integer NOT NULL CHECK(configuration_revision>=0),
 hostname text NOT NULL,
 status text NOT NULL CHECK(status IN ('healthy','failed')),
 checked_at timestamptz NOT NULL,
 elapsed_ms integer NOT NULL CHECK(elapsed_ms>=0),
 failure text CHECK(failure IN ('dns','address_forbidden','timeout','tls','challenge','http','response_limit','cancelled')),
 certificate_not_before timestamptz,
 certificate_not_after timestamptz,
 certificate_fingerprint256 text,
 last_success_at timestamptz,
 last_failure_at timestamptz,
 last_failure text CHECK(last_failure IN ('dns','address_forbidden','timeout','tls','challenge','http','response_limit','cancelled')),
 PRIMARY KEY(installation_id,service),
 CHECK((status='healthy')=(failure IS NULL)),
 CHECK((certificate_not_before IS NULL)=(certificate_not_after IS NULL)),
 CHECK((certificate_not_after IS NULL)=(certificate_fingerprint256 IS NULL)),
 CHECK((last_failure_at IS NULL)=(last_failure IS NULL))
);
CREATE INDEX remote_probe_observations_venue ON remote_probe_observations(venue_id,service);
ALTER TABLE venue_incidents DROP CONSTRAINT venue_incidents_kind_check;
ALTER TABLE venue_incidents ADD CONSTRAINT venue_incidents_kind_check CHECK(kind IN (
 'disconnected','snapshot_stale','verification_failed',
 'public_route_failed','staff_route_failed','public_probe_stale','staff_probe_stale',
 'public_certificate_expiring','staff_certificate_expiring'
));
