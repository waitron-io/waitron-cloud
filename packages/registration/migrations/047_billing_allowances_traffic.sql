-- Exact numeric quantities reject fractions before they can be rounded into a debit.
CREATE DOMAIN allowance_quantity AS numeric CHECK(VALUE=trunc(VALUE) AND VALUE BETWEEN 0 AND 9223372036854775807);
CREATE TABLE billing_allowance_versions (
 revision billing_whole PRIMARY KEY CHECK(revision>0),
 effective_from billing_date NOT NULL UNIQUE CHECK(extract(day FROM effective_from)=1),
 registered_transactional_email allowance_quantity NOT NULL,
 registered_address_lookup allowance_quantity NOT NULL,
 registered_sms allowance_quantity NOT NULL,
 registered_content_translation allowance_quantity NOT NULL,
 registered_rota_solver allowance_quantity NOT NULL,
 connected_transactional_email allowance_quantity NOT NULL,
 connected_address_lookup allowance_quantity NOT NULL,
 connected_sms allowance_quantity NOT NULL,
 connected_content_translation allowance_quantity NOT NULL,
 connected_rota_solver allowance_quantity NOT NULL,
 hosted_transactional_email allowance_quantity NOT NULL,
 hosted_address_lookup allowance_quantity NOT NULL,
 hosted_sms allowance_quantity NOT NULL,
 hosted_content_translation allowance_quantity NOT NULL,
 hosted_rota_solver allowance_quantity NOT NULL,
 trial_content_translation allowance_quantity NOT NULL,
 trial_rota_solver allowance_quantity NOT NULL,
 CHECK(trial_content_translation<=connected_content_translation AND trial_content_translation<=hosted_content_translation),
 CHECK(trial_rota_solver<=connected_rota_solver AND trial_rota_solver<=hosted_rota_solver)
);
CREATE TRIGGER billing_allowance_versions_immutable BEFORE UPDATE OR DELETE ON billing_allowance_versions FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();
CREATE TABLE billing_allowance_reservations (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 installation_id uuid NOT NULL,
 service text NOT NULL CHECK(service IN ('transactional_email','address_lookup','sms','content_translation','rota_solver')),
 operation_id uuid NOT NULL,
 binding billing_reference NOT NULL,
 units allowance_quantity NOT NULL CHECK(units>0),
 month billing_date NOT NULL CHECK(extract(day FROM month)=1),
 revision billing_whole NOT NULL REFERENCES billing_allowance_versions(revision),
 state text NOT NULL DEFAULT 'held' CHECK(state IN ('held','spent','released')),
 attempted_at timestamptz CHECK(isfinite(attempted_at)),
 FOREIGN KEY(venue_id,organisation_id,legal_business_id) REFERENCES venues(id,organisation_id,legal_business_id),
 FOREIGN KEY(installation_id,venue_id) REFERENCES installations(id,venue_id),
 UNIQUE(service,installation_id,operation_id),
 CHECK(service<>'transactional_email' OR units=1),
 CHECK(attempted_at IS NULL OR state='spent')
);
CREATE INDEX billing_allowance_account_month ON billing_allowance_reservations(account_id,service,month) WHERE state IN ('held','spent');
CREATE INDEX billing_allowance_venue_month ON billing_allowance_reservations(venue_id,service,month) WHERE state IN ('held','spent');
CREATE FUNCTION protect_allowance_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
  (to_jsonb(OLD)-ARRAY['state','attempted_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','attempted_at']) OR
  (OLD.attempted_at IS NOT NULL AND OLD.attempted_at IS DISTINCT FROM NEW.attempted_at) OR
  (NEW.state IN ('held','spent','released') AND NOT (OLD.state=NEW.state OR (OLD.state='held' AND NEW.state IN ('spent','released')))) THEN
  RAISE EXCEPTION 'allowance_reservation_immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_allowance_reservations_immutable BEFORE UPDATE OR DELETE ON billing_allowance_reservations FOR EACH ROW EXECUTE FUNCTION protect_allowance_reservation();
