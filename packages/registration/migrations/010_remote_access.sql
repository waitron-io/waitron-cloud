CREATE TABLE remote_cells (
 id uuid PRIMARY KEY,
 country text NOT NULL CHECK (country='ES'),
 provider text NOT NULL CHECK (provider='aws'),
 environment text NOT NULL CHECK (environment IN ('test','production')),
 suffix text NOT NULL UNIQUE,
 subnet integer NOT NULL UNIQUE CHECK (subnet BETWEEN 0 AND 255),
 public_key text NOT NULL UNIQUE,
 endpoint text NOT NULL,
 next_address integer NOT NULL DEFAULT 2 CHECK (next_address BETWEEN 2 AND 66),
 sequence bigint NOT NULL DEFAULT 0 CHECK (sequence>=0)
);
CREATE TABLE remote_placements (
 venue_id uuid PRIMARY KEY REFERENCES venues(id),
 installation_id uuid NOT NULL UNIQUE REFERENCES installations(id),
 cell_id uuid NOT NULL REFERENCES remote_cells(id),
 address inet NOT NULL UNIQUE,
 peer_public_key text NOT NULL UNIQUE,
 port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE remote_hostnames (
 hostname text PRIMARY KEY,
 venue_id uuid NOT NULL REFERENCES remote_placements(venue_id),
 kind text NOT NULL CHECK (kind IN ('staff','public')),
 UNIQUE (venue_id,kind)
);
