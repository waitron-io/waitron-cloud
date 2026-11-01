CREATE TABLE data_lifecycles (
 venue_id uuid PRIMARY KEY REFERENCES venues(id),
 revision integer NOT NULL CHECK(revision>=1),
 state text NOT NULL CHECK(state IN ('active','exit preparing','read-only until deadline','purging','purged')),
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at)),
 effective_end_at timestamptz CHECK(isfinite(effective_end_at)),
 deadline_at timestamptz CHECK(isfinite(deadline_at)),
 CHECK((effective_end_at IS NULL AND deadline_at IS NULL) OR
  (effective_end_at IS NOT NULL AND deadline_at IS NOT NULL AND deadline_at=effective_end_at+interval '2160 hours'))
);
CREATE TABLE data_lifecycle_operations (
 venue_id uuid NOT NULL REFERENCES data_lifecycles(venue_id),
 operation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('cancel','delete','resubscribe','export')),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 expected_revision integer NOT NULL CHECK(expected_revision>=0),
 revision integer NOT NULL CHECK(revision=expected_revision+1),
 requested_effective_end_at timestamptz CHECK(isfinite(requested_effective_end_at)),
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at)),
 effective_end_at timestamptz,
 deadline_at timestamptz,
 claim_revision integer NOT NULL DEFAULT 0 CHECK(claim_revision>=0),
 claim_lifecycle_revision integer,
 lease_until timestamptz,
 PRIMARY KEY(venue_id,operation_id),
 UNIQUE(venue_id,revision),
 CHECK((claim_lifecycle_revision IS NULL AND lease_until IS NULL) OR
  (claim_lifecycle_revision IS NOT NULL AND claim_lifecycle_revision>0 AND lease_until IS NOT NULL AND isfinite(lease_until)))
);
CREATE TABLE data_lifecycle_effects (
 venue_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 effect_id uuid NOT NULL,
 request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
 phase text NOT NULL CHECK(phase IN ('intent','uncertain','confirmed','refused')),
 resource_reference text CHECK(resource_reference ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$'),
 PRIMARY KEY(venue_id,operation_id,effect_id),
 FOREIGN KEY(venue_id,operation_id) REFERENCES data_lifecycle_operations(venue_id,operation_id)
);
