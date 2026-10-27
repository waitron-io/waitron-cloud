CREATE TABLE remote_forward_reporters (
 cell_id uuid PRIMARY KEY REFERENCES remote_cells(id) ON DELETE CASCADE,
 gateway_id uuid NOT NULL,
 generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
 public_key text NOT NULL CHECK (length(public_key) BETWEEN 1 AND 256),
 minimum_manifest_sequence bigint NOT NULL CHECK (minimum_manifest_sequence BETWEEN 1 AND 9007199254740991),
 last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence BETWEEN 0 AND 9007199254740991),
 next_accept_at timestamptz NOT NULL DEFAULT '-infinity',
 revoked_at timestamptz
);

-- Latest causes are disposable: crash recovery must yield unknown, never durable incident history.
CREATE UNLOGGED TABLE remote_forward_observations (
 venue_id uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
 installation_id uuid NOT NULL UNIQUE REFERENCES installations(id) ON DELETE CASCADE,
 cell_id uuid NOT NULL REFERENCES remote_cells(id) ON DELETE CASCADE,
 gateway_id uuid NOT NULL,
 generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
 route_id text NOT NULL CHECK (route_id='public_availability'),
 configuration_revision bigint NOT NULL CHECK (configuration_revision BETWEEN 0 AND 9007199254740991),
 route_binding text NOT NULL CHECK (route_binding ~ '^[a-f0-9]{64}$'),
 manifest_sequence bigint NOT NULL CHECK (manifest_sequence BETWEEN 1 AND 9007199254740991),
 manifest_expires_at timestamptz NOT NULL CHECK (isfinite(manifest_expires_at) AND manifest_expires_at>='epoch'),
 observation_sequence bigint NOT NULL CHECK (observation_sequence BETWEEN 1 AND 9007199254740991),
 category text CHECK (category IN ('upstream_non_200','upstream_timeout','upstream_response_limit','upstream_transport','forward_internal')),
 observed_at timestamptz NOT NULL CHECK (isfinite(observed_at) AND observed_at>='epoch'),
 received_at timestamptz NOT NULL CHECK (isfinite(received_at) AND received_at>='epoch'),
 expires_at timestamptz NOT NULL CHECK (isfinite(expires_at) AND expires_at>='epoch')
);
CREATE INDEX remote_forward_observations_cell_expiry ON remote_forward_observations(cell_id,expires_at);
