CREATE TABLE country_policy_versions (
 country text NOT NULL CHECK(country<>'' AND country=btrim(country)),
 revision integer NOT NULL CHECK(revision>0),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 PRIMARY KEY(country,revision)
);
CREATE TABLE country_policy_heads (
 country text PRIMARY KEY,
 revision integer NOT NULL CHECK(revision>0),
 FOREIGN KEY(country,revision) REFERENCES country_policy_versions
);
CREATE TABLE venue_country_bindings (
 venue_id uuid NOT NULL REFERENCES venues(id),
 service_id text NOT NULL CHECK(service_id<>'' AND service_id=btrim(service_id)),
 placement_revision integer NOT NULL CHECK(placement_revision>0),
 country text NOT NULL,
 policy_revision integer NOT NULL CHECK(policy_revision>0),
 supplier_id text NOT NULL CHECK(supplier_id<>'' AND supplier_id=btrim(supplier_id)),
 account_id text NOT NULL CHECK(account_id<>'' AND account_id=btrim(account_id)),
 endpoint text NOT NULL CHECK(endpoint<>'' AND endpoint=btrim(endpoint)),
 data_class text NOT NULL CHECK(data_class<>'' AND data_class=btrim(data_class)),
 region text NOT NULL CHECK(region<>'' AND region=btrim(region)),
 PRIMARY KEY(venue_id,service_id,placement_revision),
 FOREIGN KEY(country,policy_revision) REFERENCES country_policy_versions
);
CREATE TABLE venue_country_binding_heads (
 venue_id uuid NOT NULL,
 service_id text NOT NULL,
 placement_revision integer NOT NULL CHECK(placement_revision>0),
 PRIMARY KEY(venue_id,service_id),
 FOREIGN KEY(venue_id,service_id,placement_revision) REFERENCES venue_country_bindings
);

-- Version rows preserve the exact policy and destination an admission inspected.
CREATE FUNCTION guard_country_flow_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'country_flow_version_immutable' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER country_policy_version_guard BEFORE UPDATE OR DELETE ON country_policy_versions
 FOR EACH ROW EXECUTE FUNCTION guard_country_flow_version();
CREATE TRIGGER country_binding_version_guard BEFORE UPDATE OR DELETE ON venue_country_bindings
 FOR EACH ROW EXECUTE FUNCTION guard_country_flow_version();
CREATE TRIGGER country_policy_version_truncate_guard BEFORE TRUNCATE ON country_policy_versions
 FOR EACH STATEMENT EXECUTE FUNCTION guard_country_flow_version();
CREATE TRIGGER country_binding_version_truncate_guard BEFORE TRUNCATE ON venue_country_bindings
 FOR EACH STATEMENT EXECUTE FUNCTION guard_country_flow_version();

-- Keeping the head row makes its admission lock conflict with every policy change.
CREATE FUNCTION guard_country_policy_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN
  RAISE EXCEPTION 'country_flow_head_immutable' USING ERRCODE='55000';
 END IF;
 IF NEW.country<>OLD.country OR NEW.revision<=OLD.revision THEN
  RAISE EXCEPTION 'country_flow_head_must_advance' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION guard_country_binding_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN
  RAISE EXCEPTION 'country_flow_head_immutable' USING ERRCODE='55000';
 END IF;
 IF NEW.venue_id<>OLD.venue_id OR NEW.service_id<>OLD.service_id OR NEW.placement_revision<=OLD.placement_revision THEN
  RAISE EXCEPTION 'country_flow_head_must_advance' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER country_policy_head_guard BEFORE UPDATE OR DELETE ON country_policy_heads
 FOR EACH ROW EXECUTE FUNCTION guard_country_policy_head();
CREATE TRIGGER country_binding_head_guard BEFORE UPDATE OR DELETE ON venue_country_binding_heads
 FOR EACH ROW EXECUTE FUNCTION guard_country_binding_head();
CREATE TRIGGER country_policy_head_truncate_guard BEFORE TRUNCATE ON country_policy_heads
 FOR EACH STATEMENT EXECUTE FUNCTION guard_country_policy_head();
CREATE TRIGGER country_binding_head_truncate_guard BEFORE TRUNCATE ON venue_country_binding_heads
 FOR EACH STATEMENT EXECUTE FUNCTION guard_country_binding_head();
