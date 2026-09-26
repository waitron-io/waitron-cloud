CREATE TABLE remote_cell_moves (
 id uuid PRIMARY KEY,
 installation_id uuid NOT NULL REFERENCES installations(id),
 venue_id uuid NOT NULL REFERENCES venues(id),
 expected_revision integer NOT NULL CHECK (expected_revision >= 0),
 source_cell_id uuid NOT NULL REFERENCES remote_cells(id),
 source_address inet NOT NULL,
 source_peer_public_key text NOT NULL,
 source_port integer NOT NULL CHECK (source_port BETWEEN 1 AND 65535),
 target_cell_id uuid NOT NULL REFERENCES remote_cells(id),
 target_address inet NOT NULL,
 target_peer_public_key text NOT NULL,
 target_port integer NOT NULL CHECK (target_port BETWEEN 1 AND 65535),
 minimum_target_sequence bigint NOT NULL CHECK (minimum_target_sequence > 0),
 readiness_sequence bigint CHECK (readiness_sequence >= minimum_target_sequence),
 state text NOT NULL CHECK (state IN ('staged','ready','completed','cancelled')),
 completed_revision integer CHECK (completed_revision > expected_revision),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ready_at timestamptz,
 completed_at timestamptz,
 cancelled_at timestamptz,
 CHECK (source_cell_id <> target_cell_id),
 CHECK ((state='staged' AND readiness_sequence IS NULL AND completed_revision IS NULL AND ready_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL)
   OR (state='ready' AND readiness_sequence IS NOT NULL AND completed_revision IS NULL AND ready_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL)
   OR (state='completed' AND readiness_sequence IS NOT NULL AND completed_revision IS NOT NULL AND ready_at IS NOT NULL AND completed_at IS NOT NULL AND cancelled_at IS NULL)
   OR (state='cancelled' AND completed_revision IS NULL AND completed_at IS NULL AND cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX remote_cell_moves_active_installation ON remote_cell_moves(installation_id) WHERE state IN ('staged','ready');
