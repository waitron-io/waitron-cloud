CREATE TABLE billing_service_authority (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 setup_grant_active boolean NOT NULL DEFAULT false,
 setup_grant_until date,
 PRIMARY KEY(organisation_id,legal_business_id,venue_id),
 FOREIGN KEY(venue_id,organisation_id,legal_business_id) REFERENCES venues(id,organisation_id,legal_business_id),
 CHECK(setup_grant_active OR setup_grant_until IS NULL)
);

-- A durable generation never moves backwards or skips the next invalidation.
CREATE FUNCTION guard_billing_service_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'service authority cannot be deleted' USING ERRCODE='55000';
 END IF;
 IF NEW.organisation_id<>OLD.organisation_id OR NEW.legal_business_id<>OLD.legal_business_id
  OR NEW.venue_id<>OLD.venue_id OR NEW.revision<OLD.revision OR NEW.revision>OLD.revision+1 THEN
  RAISE EXCEPTION 'service authority identity and generation must be preserved' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER billing_service_authority_guard BEFORE UPDATE OR DELETE ON billing_service_authority
 FOR EACH ROW EXECUTE FUNCTION guard_billing_service_authority();
