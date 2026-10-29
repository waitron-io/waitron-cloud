-- Numeric domains reject fractional input instead of silently rounding it to an integer.
CREATE DOMAIN billing_whole AS numeric CHECK(VALUE=trunc(VALUE) AND VALUE BETWEEN 0 AND 9007199254740991);
CREATE DOMAIN billing_price_cents AS numeric CHECK(VALUE=trunc(VALUE) AND VALUE BETWEEN 0 AND 900719925474);
CREATE DOMAIN billing_date AS date CHECK(VALUE BETWEEN DATE '0001-01-01' AND DATE '9999-12-31');
CREATE DOMAIN billing_reference AS text CHECK(length(VALUE) BETWEEN 1 AND 256 AND VALUE ~ '^[ -~]+$');

CREATE TABLE billing_prices (
 revision billing_whole PRIMARY KEY CHECK(revision>0),
 effective_from billing_date NOT NULL UNIQUE,
 currency text NOT NULL CHECK(currency='EUR'),
 connected_monthly_cents billing_price_cents NOT NULL,
 hosted_monthly_cents billing_price_cents NOT NULL,
 vat_rate_basis_points billing_whole NOT NULL CHECK(vat_rate_basis_points<=10000),
 UNIQUE(revision,effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points)
);
CREATE TABLE billing_businesses (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 anchor_date billing_date,
 anchor_day billing_whole CHECK(anchor_day BETWEEN 1 AND 31),
 revision billing_whole NOT NULL DEFAULT 0,
 current_method_id uuid,
 PRIMARY KEY(organisation_id,legal_business_id),
 FOREIGN KEY(legal_business_id,organisation_id) REFERENCES legal_businesses(id,organisation_id),
 CHECK((anchor_date IS NULL AND anchor_day IS NULL) OR
  (anchor_date IS NOT NULL AND anchor_day IS NOT NULL AND anchor_day=extract(day FROM anchor_date)))
);
CREATE TABLE billing_events (
 id uuid PRIMARY KEY,
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('internal','provider')),
 provider text CHECK(provider IN ('sumup','stripe')),
 provider_account_id billing_reference,
 event_key billing_reference NOT NULL,
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 UNIQUE(organisation_id,legal_business_id,id),
 FOREIGN KEY(organisation_id,legal_business_id) REFERENCES billing_businesses,
 CHECK((source='internal' AND provider IS NULL AND provider_account_id IS NULL) OR
  (source='provider' AND provider IS NOT NULL AND provider_account_id IS NOT NULL))
);
CREATE UNIQUE INDEX billing_internal_event_identity ON billing_events(organisation_id,legal_business_id,event_key) WHERE source='internal';
CREATE UNIQUE INDEX billing_provider_event_identity ON billing_events(provider,provider_account_id,event_key) WHERE source='provider';

CREATE TABLE billing_payment_methods (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('card','direct_debit')),
 provider text NOT NULL CHECK(provider IN ('sumup','stripe')),
 provider_account_id billing_reference NOT NULL,
 customer_id billing_reference NOT NULL,
 method_id billing_reference NOT NULL,
 mandate_id billing_reference,
 event_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,legal_business_id,id),
 UNIQUE(organisation_id,legal_business_id,id,provider,provider_account_id),
 UNIQUE(provider,provider_account_id,method_id),
 FOREIGN KEY(organisation_id,legal_business_id) REFERENCES billing_businesses,
 FOREIGN KEY(organisation_id,legal_business_id,event_id) REFERENCES billing_events(organisation_id,legal_business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((kind='card' AND mandate_id IS NULL) OR (kind='direct_debit' AND provider='stripe' AND mandate_id IS NOT NULL))
);
ALTER TABLE billing_businesses ADD FOREIGN KEY(organisation_id,legal_business_id,current_method_id) REFERENCES billing_payment_methods(organisation_id,legal_business_id,id);
ALTER TABLE venues ADD UNIQUE(id,organisation_id,legal_business_id);
CREATE TABLE billing_venues (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 level text NOT NULL DEFAULT 'registered' CHECK(level IN ('registered','connected','hosted')),
 revision billing_whole NOT NULL DEFAULT 0,
 connected_from billing_date,
 lapsed_on billing_date,
 scheduled_level text CHECK(scheduled_level IN ('registered','connected')),
 scheduled_on billing_date,
 PRIMARY KEY(organisation_id,legal_business_id,venue_id),
 FOREIGN KEY(organisation_id,legal_business_id) REFERENCES billing_businesses,
 FOREIGN KEY(venue_id,organisation_id,legal_business_id) REFERENCES venues(id,organisation_id,legal_business_id),
 CHECK((scheduled_level IS NULL AND scheduled_on IS NULL) OR (scheduled_level IS NOT NULL AND scheduled_on IS NOT NULL))
);
CREATE TABLE billing_trials (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 level text NOT NULL CHECK(level IN ('connected','hosted')),
 started_on billing_date NOT NULL,
 ends_on billing_date NOT NULL,
 extended boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','converted','lapsed')),
 event_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,legal_business_id,venue_id,level),
 FOREIGN KEY(organisation_id,legal_business_id,venue_id) REFERENCES billing_venues,
 FOREIGN KEY(organisation_id,legal_business_id,event_id) REFERENCES billing_events(organisation_id,legal_business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(ends_on>started_on),
 CHECK(NOT extended OR level='connected')
);
CREATE TABLE billing_charges (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('renewal','hosted_comeback')),
 renewal_date billing_date NOT NULL,
 connected_until billing_date,
 hosted_from billing_date NOT NULL,
 hosted_through billing_date NOT NULL,
 price_revision billing_whole NOT NULL,
 price_effective_from billing_date NOT NULL,
 currency text NOT NULL CHECK(currency='EUR'),
 connected_monthly_cents billing_price_cents NOT NULL,
 hosted_monthly_cents billing_price_cents NOT NULL,
 vat_rate_basis_points billing_whole NOT NULL CHECK(vat_rate_basis_points<=10000),
 net_cents billing_whole NOT NULL,
 vat_cents billing_whole NOT NULL,
 gross_cents billing_whole NOT NULL CHECK(gross_cents>0),
 event_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,legal_business_id,id),
 FOREIGN KEY(organisation_id,legal_business_id) REFERENCES billing_businesses,
 FOREIGN KEY(organisation_id,legal_business_id,event_id) REFERENCES billing_events(organisation_id,legal_business_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(price_revision,price_effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points)
  REFERENCES billing_prices(revision,effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points),
 CHECK((kind='renewal' AND connected_until IS NOT NULL AND connected_until>renewal_date) OR (kind='hosted_comeback' AND connected_until IS NULL)),
 CHECK(hosted_through>=hosted_from),
 CHECK(gross_cents=net_cents+vat_cents)
);
CREATE UNIQUE INDEX billing_one_renewal ON billing_charges(organisation_id,legal_business_id,renewal_date) WHERE kind='renewal';
CREATE TABLE billing_charge_lines (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 charge_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('connected_month','hosted_days')),
 quantity billing_whole NOT NULL CHECK(quantity>0),
 cents billing_whole NOT NULL CHECK(cents>0),
 PRIMARY KEY(organisation_id,legal_business_id,charge_id,venue_id,kind),
 FOREIGN KEY(organisation_id,legal_business_id,charge_id) REFERENCES billing_charges(organisation_id,legal_business_id,id),
 FOREIGN KEY(organisation_id,legal_business_id,venue_id) REFERENCES billing_venues,
 CHECK(kind<>'connected_month' OR quantity=1)
);
CREATE TABLE billing_hosted_days (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 on_date billing_date NOT NULL,
 covered_by_charge_id uuid,
 coverage_kind text NOT NULL DEFAULT 'connected_month' CHECK(coverage_kind='connected_month'),
 consumed_by_charge_id uuid,
 event_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,legal_business_id,venue_id,on_date),
 FOREIGN KEY(organisation_id,legal_business_id,venue_id) REFERENCES billing_venues,
 FOREIGN KEY(organisation_id,legal_business_id,covered_by_charge_id,venue_id,coverage_kind)
  REFERENCES billing_charge_lines(organisation_id,legal_business_id,charge_id,venue_id,kind),
 FOREIGN KEY(organisation_id,legal_business_id,consumed_by_charge_id) REFERENCES billing_charges(organisation_id,legal_business_id,id),
 FOREIGN KEY(organisation_id,legal_business_id,event_id) REFERENCES billing_events(organisation_id,legal_business_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE billing_payment_attempts (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 id uuid NOT NULL,
 charge_id uuid NOT NULL,
 method_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('sumup','stripe')),
 provider_account_id billing_reference NOT NULL,
 request_key billing_reference NOT NULL,
 provider_payment_id billing_reference,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','succeeded','failed','refunded')),
 revision billing_whole NOT NULL DEFAULT 0,
 succeeded_at timestamptz CHECK(isfinite(succeeded_at)),
 event_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,legal_business_id,id),
 UNIQUE(organisation_id,legal_business_id,id,charge_id),
 UNIQUE(provider,provider_account_id,request_key),
 UNIQUE(provider,provider_account_id,provider_payment_id),
 FOREIGN KEY(organisation_id,legal_business_id,charge_id) REFERENCES billing_charges(organisation_id,legal_business_id,id),
 FOREIGN KEY(organisation_id,legal_business_id,method_id,provider,provider_account_id) REFERENCES billing_payment_methods(organisation_id,legal_business_id,id,provider,provider_account_id),
 FOREIGN KEY(organisation_id,legal_business_id,event_id) REFERENCES billing_events(organisation_id,legal_business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state IN ('succeeded','refunded') AND succeeded_at IS NOT NULL) OR (state IN ('pending','failed') AND succeeded_at IS NULL))
);
CREATE TABLE billing_payment_observations (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 event_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','succeeded','failed','refunded')),
 occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
 PRIMARY KEY(organisation_id,legal_business_id,attempt_id,event_id),
 FOREIGN KEY(organisation_id,legal_business_id,attempt_id) REFERENCES billing_payment_attempts(organisation_id,legal_business_id,id),
 FOREIGN KEY(organisation_id,legal_business_id,event_id) REFERENCES billing_events(organisation_id,legal_business_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE billing_paid_periods (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 level text NOT NULL CHECK(level IN ('connected','hosted')),
 charge_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 from_date billing_date NOT NULL,
 until_date billing_date NOT NULL,
 line_kind text GENERATED ALWAYS AS (CASE level WHEN 'connected' THEN 'connected_month' ELSE 'hosted_days' END) STORED,
 PRIMARY KEY(organisation_id,legal_business_id,venue_id,level,charge_id),
 FOREIGN KEY(organisation_id,legal_business_id,venue_id) REFERENCES billing_venues,
 FOREIGN KEY(organisation_id,legal_business_id,attempt_id,charge_id) REFERENCES billing_payment_attempts(organisation_id,legal_business_id,id,charge_id),
 FOREIGN KEY(organisation_id,legal_business_id,charge_id,venue_id,line_kind) REFERENCES billing_charge_lines(organisation_id,legal_business_id,charge_id,venue_id,kind),
 CHECK(until_date>from_date)
);

CREATE FUNCTION reject_billing_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'billing_fact_immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER billing_prices_immutable BEFORE UPDATE OR DELETE ON billing_prices FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();
CREATE TRIGGER billing_events_immutable BEFORE UPDATE OR DELETE ON billing_events FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();
CREATE TRIGGER billing_methods_immutable BEFORE UPDATE OR DELETE ON billing_payment_methods FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();
CREATE TRIGGER billing_charges_immutable BEFORE UPDATE OR DELETE ON billing_charges FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();
CREATE TRIGGER billing_lines_immutable BEFORE UPDATE OR DELETE ON billing_charge_lines FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();
CREATE TRIGGER billing_observations_immutable BEFORE UPDATE OR DELETE ON billing_payment_observations FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();
CREATE TRIGGER billing_paid_immutable BEFORE UPDATE OR DELETE ON billing_paid_periods FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();

-- Consumption freezes coverage too: later refunds must not rewrite a saved bill.
CREATE FUNCTION protect_billing_hosted_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
  (to_jsonb(OLD)-ARRAY['covered_by_charge_id','consumed_by_charge_id']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['covered_by_charge_id','consumed_by_charge_id']) OR
  (OLD.covered_by_charge_id IS NOT NULL AND OLD.covered_by_charge_id IS DISTINCT FROM NEW.covered_by_charge_id) OR
  (OLD.consumed_by_charge_id IS NOT NULL AND
   (OLD.consumed_by_charge_id IS DISTINCT FROM NEW.consumed_by_charge_id OR OLD.covered_by_charge_id IS DISTINCT FROM NEW.covered_by_charge_id)) THEN
  RAISE EXCEPTION 'billing_hosted_day_immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_hosted_day_immutable BEFORE UPDATE OR DELETE ON billing_hosted_days FOR EACH ROW EXECUTE FUNCTION protect_billing_hosted_day();

-- A provider reference and first success belong to the original attempt for its lifetime.
CREATE FUNCTION protect_billing_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
  (to_jsonb(OLD)-ARRAY['provider_payment_id','state','revision','succeeded_at']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['provider_payment_id','state','revision','succeeded_at']) OR
  (OLD.provider_payment_id IS NOT NULL AND OLD.provider_payment_id IS DISTINCT FROM NEW.provider_payment_id) OR
  (OLD.succeeded_at IS NOT NULL AND OLD.succeeded_at IS DISTINCT FROM NEW.succeeded_at) OR
  (NEW.state IN ('pending','failed','succeeded','refunded') AND NOT (
   OLD.state=NEW.state OR
   (OLD.state='pending' AND NEW.state IN ('failed','succeeded')) OR
   (OLD.state='failed' AND NEW.state='succeeded') OR
   (OLD.state='succeeded' AND NEW.state='refunded'))) THEN
  RAISE EXCEPTION 'billing_attempt_immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_attempt_immutable BEFORE UPDATE OR DELETE ON billing_payment_attempts FOR EACH ROW EXECUTE FUNCTION protect_billing_attempt();
