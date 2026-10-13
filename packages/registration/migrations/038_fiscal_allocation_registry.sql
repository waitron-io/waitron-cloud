-- These counters project independently current history; they never confer allocation authority.
CREATE TABLE fiscal_registry_scopes (
 taxpayer_nif text NOT NULL CHECK(taxpayer_nif ~ '^[A-Z0-9]{9}$'),
 software_id text NOT NULL CHECK(software_id ~ '^[A-Z0-9]{2}$'),
 environment text NOT NULL CHECK(environment IN ('preproduction','production')),
 c_high_water integer NOT NULL CHECK(c_high_water BETWEEN 0 AND 999999),
 sequence numeric(78,0) NOT NULL CHECK(sequence>=0),
 history_digest text NOT NULL CHECK(history_digest ~ '^[0-9a-f]{64}$'),
 writer_fence numeric(78,0) NOT NULL CHECK(writer_fence>=0),
 PRIMARY KEY(taxpayer_nif,software_id,environment)
);
CREATE TABLE fiscal_registry_allocations (
 allocation_id uuid PRIMARY KEY,
 taxpayer_nif text NOT NULL,
 software_id text NOT NULL,
 environment text NOT NULL,
 installation_identity text NOT NULL CHECK(
  (installation_identity ~ '^[SPC][0-9]{6}$' AND substring(installation_identity FROM 2)<>'000000')
  OR installation_identity ~ '^E[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}$'),
 venue_id uuid NOT NULL REFERENCES venues(id),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 allocation jsonb NOT NULL CHECK(jsonb_typeof(allocation)='object'),
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
 custody_version text NOT NULL CHECK(length(btrim(custody_version)) BETWEEN 1 AND 256),
 entitlement_version text NOT NULL CHECK(length(btrim(entitlement_version)) BETWEEN 1 AND 256),
 initial_receipt jsonb NOT NULL CHECK(jsonb_typeof(initial_receipt)='object'),
 FOREIGN KEY(taxpayer_nif,software_id,environment) REFERENCES fiscal_registry_scopes,
 UNIQUE(taxpayer_nif,software_id,environment,installation_identity),
 CHECK(allocation->>'allocationId' IS NOT NULL AND allocation->>'allocationId'=allocation_id::text),
 CHECK(allocation->>'installationIdentity' IS NOT NULL AND allocation->>'installationIdentity'=installation_identity),
 CHECK(allocation->>'taxpayerNif' IS NOT NULL AND allocation->>'taxpayerNif'=taxpayer_nif),
 CHECK(allocation->>'softwareId' IS NOT NULL AND allocation->>'softwareId'=software_id),
 CHECK(allocation->>'environment' IS NOT NULL AND allocation->>'environment'=environment)
);
CREATE TABLE fiscal_registry_events (
 event_id uuid PRIMARY KEY,
 taxpayer_nif text NOT NULL,
 software_id text NOT NULL,
 environment text NOT NULL,
 sequence numeric(78,0) NOT NULL CHECK(sequence>0),
 operation_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('reserve','consume','abandon','paper-import','report')),
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 allocation_id uuid REFERENCES fiscal_registry_allocations(allocation_id),
 event jsonb NOT NULL CHECK(jsonb_typeof(event)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 FOREIGN KEY(taxpayer_nif,software_id,environment) REFERENCES fiscal_registry_scopes,
 UNIQUE(taxpayer_nif,software_id,environment,sequence),
 UNIQUE(taxpayer_nif,software_id,environment,operation_id)
);
CREATE TABLE fiscal_registry_paper_events (
 event_id uuid PRIMARY KEY,
 taxpayer_nif text NOT NULL,
 software_id text NOT NULL,
 environment text NOT NULL,
 custodian_id text NOT NULL CHECK(length(btrim(custodian_id)) BETWEEN 1 AND 256),
 register_revision numeric(78,0) NOT NULL CHECK(register_revision>0),
 block_digest text NOT NULL CHECK(block_digest ~ '^[0-9a-f]{64}$'),
 event_digest text NOT NULL CHECK(event_digest ~ '^[0-9a-f]{64}$'),
 fact jsonb NOT NULL CHECK(jsonb_typeof(fact)='object'),
 FOREIGN KEY(taxpayer_nif,software_id,environment) REFERENCES fiscal_registry_scopes,
 UNIQUE(taxpayer_nif,software_id,environment,custodian_id,register_revision)
);
CREATE INDEX fiscal_events_venue_allocation_sequence ON fiscal_registry_events
 ((result->'payload'->>'venueId'),allocation_id,sequence DESC);
CREATE INDEX fiscal_events_operation ON fiscal_registry_events(operation_id);
-- Name claims and the signed facts survive abandonment, subscription end and incomplete restores.
CREATE FUNCTION reject_fiscal_registry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'fiscal_registry_immutable' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER fiscal_allocations_immutable BEFORE UPDATE OR DELETE ON fiscal_registry_allocations
 FOR EACH ROW EXECUTE FUNCTION reject_fiscal_registry_mutation();
CREATE TRIGGER fiscal_allocations_no_truncate BEFORE TRUNCATE ON fiscal_registry_allocations
 FOR EACH STATEMENT EXECUTE FUNCTION reject_fiscal_registry_mutation();
CREATE TRIGGER fiscal_events_immutable BEFORE UPDATE OR DELETE ON fiscal_registry_events
 FOR EACH ROW EXECUTE FUNCTION reject_fiscal_registry_mutation();
CREATE TRIGGER fiscal_events_no_truncate BEFORE TRUNCATE ON fiscal_registry_events
 FOR EACH STATEMENT EXECUTE FUNCTION reject_fiscal_registry_mutation();
CREATE TRIGGER fiscal_paper_immutable BEFORE UPDATE OR DELETE ON fiscal_registry_paper_events
 FOR EACH ROW EXECUTE FUNCTION reject_fiscal_registry_mutation();
CREATE TRIGGER fiscal_paper_no_truncate BEFORE TRUNCATE ON fiscal_registry_paper_events
 FOR EACH STATEMENT EXECUTE FUNCTION reject_fiscal_registry_mutation();
-- This routing hint commits before the outside append; it cannot confer a claim or currentness.
CREATE TABLE fiscal_registry_operation_routes (
 operation_id uuid PRIMARY KEY,
 venue_id uuid NOT NULL REFERENCES venues(id),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object'),
 action text NOT NULL CHECK(action IN ('reserve','consume','abandon','paper-import')),
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER fiscal_routes_immutable BEFORE UPDATE OR DELETE ON fiscal_registry_operation_routes
 FOR EACH ROW EXECUTE FUNCTION reject_fiscal_registry_mutation();
CREATE TRIGGER fiscal_routes_no_truncate BEFORE TRUNCATE ON fiscal_registry_operation_routes
 FOR EACH STATEMENT EXECUTE FUNCTION reject_fiscal_registry_mutation();
