CREATE TABLE backup_locations (
 venue_id uuid PRIMARY KEY REFERENCES venues(id),
 installation_id uuid NOT NULL UNIQUE REFERENCES installations(id),
 endpoint text NOT NULL, bucket text NOT NULL, region text NOT NULL,
 active_key_version integer NOT NULL DEFAULT 1 CHECK(active_key_version>0),
 UNIQUE(endpoint,bucket)
);
CREATE TABLE backup_key_versions (
 venue_id uuid NOT NULL REFERENCES backup_locations(venue_id),
 version integer NOT NULL CHECK(version>0), sealed text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(venue_id,version)
);
CREATE TABLE backup_captures (
 id uuid PRIMARY KEY, venue_id uuid NOT NULL REFERENCES backup_locations(venue_id),
 installation_id uuid NOT NULL REFERENCES installations(id), key_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(venue_id,key_version) REFERENCES backup_key_versions(venue_id,version)
);
CREATE TABLE backup_points (
 id uuid PRIMARY KEY REFERENCES backup_captures(id),
 venue_id uuid NOT NULL REFERENCES backup_locations(venue_id),
 installation_id uuid NOT NULL REFERENCES installations(id), key_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('snapshot','continuous')),
 object_key text NOT NULL, digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 size bigint NOT NULL CHECK(size>0), captured_at timestamptz NOT NULL,
 retention text NOT NULL CHECK(retention IN ('daily','monthly')),
 source_node_id uuid NOT NULL, modules jsonb NOT NULL,
 verification text NOT NULL DEFAULT 'pending' CHECK(verification IN ('pending','verified','failed')),
 deleting boolean NOT NULL DEFAULT false, deleted_at timestamptz,
 FOREIGN KEY(venue_id,key_version) REFERENCES backup_key_versions(venue_id,version),
 UNIQUE(venue_id,object_key)
);
CREATE TABLE backup_verifications (
 id uuid PRIMARY KEY, point_id uuid NOT NULL REFERENCES backup_points(id),
 digest text NOT NULL, verifier text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('verified','failed')),
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE backup_recoveries (
 id uuid PRIMARY KEY, venue_id uuid NOT NULL REFERENCES backup_locations(venue_id),
 point_id uuid NOT NULL REFERENCES backup_points(id), account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 target_public_key text NOT NULL UNIQUE, mode text NOT NULL CHECK(mode IN ('planned','failure')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','restored','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '1 hour'
);
CREATE UNIQUE INDEX backup_recoveries_active ON backup_recoveries(venue_id) WHERE status<>'closed';
