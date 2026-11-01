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

-- Saved reporter keys and aggregate evidence outlive reporter rotation and parent retirement.
ALTER TABLE remote_cells ADD CONSTRAINT remote_cells_traffic_scope UNIQUE(id,country,environment);
CREATE DOMAIN traffic_instant AS timestamptz CHECK(isfinite(VALUE) AND VALUE>='epoch');
CREATE DOMAIN traffic_digest AS text CHECK(VALUE ~ '^[a-f0-9]{64}$');
CREATE DOMAIN traffic_payload AS text CHECK(length(VALUE) BETWEEN 1 AND 262144 AND VALUE ~ '^[A-Za-z0-9_-]+$');
CREATE DOMAIN traffic_signature AS text CHECK(VALUE ~ '^[A-Za-z0-9_-]{86}$');
CREATE TABLE remote_traffic_processes (
 cell_id uuid NOT NULL,
 country text NOT NULL DEFAULT 'ES' CHECK(country='ES'),
 environment text NOT NULL DEFAULT 'test' CHECK(environment='test'),
 gateway_id uuid NOT NULL,
 generation billing_whole NOT NULL CHECK(generation>0),
 process_id uuid NOT NULL UNIQUE,
 reporter_public_key text NOT NULL CHECK(length(reporter_public_key) BETWEEN 1 AND 256),
 start_manifest_digest traffic_digest NOT NULL,
 started_at traffic_instant NOT NULL,
 start_payload traffic_payload NOT NULL,
 start_signature traffic_signature NOT NULL,
 predecessor_id uuid CHECK(predecessor_id<>process_id),
 ended_at traffic_instant,
 final_sequence billing_whole,
 end_payload traffic_payload,
 end_signature traffic_signature,
 last_sequence billing_whole NOT NULL DEFAULT 0,
 last_until traffic_instant NOT NULL,
 has_gap boolean NOT NULL DEFAULT false,
 PRIMARY KEY(cell_id,gateway_id,generation,process_id),
 FOREIGN KEY(cell_id,country,environment) REFERENCES remote_cells(id,country,environment),
 CHECK(last_until>=started_at),
 CHECK((last_sequence=0 AND last_until=started_at) OR (last_sequence>0 AND last_until>started_at)),
 CHECK((ended_at IS NULL AND final_sequence IS NULL AND end_payload IS NULL AND end_signature IS NULL)
  OR (ended_at IS NOT NULL AND final_sequence IS NOT NULL AND end_payload IS NOT NULL AND end_signature IS NOT NULL
   AND ended_at>=last_until AND final_sequence>=last_sequence))
);
CREATE FUNCTION protect_traffic_process() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
  (to_jsonb(OLD)-ARRAY['ended_at','final_sequence','end_payload','end_signature','last_sequence','last_until','has_gap'])
   IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['ended_at','final_sequence','end_payload','end_signature','last_sequence','last_until','has_gap']) OR
  (OLD.has_gap AND NOT NEW.has_gap) OR
  ((OLD.last_sequence,OLD.last_until) IS DISTINCT FROM (NEW.last_sequence,NEW.last_until)
   AND NOT (NEW.last_sequence=OLD.last_sequence+1 AND NEW.last_until>OLD.last_until)) OR
  (OLD.ended_at IS NOT NULL AND (OLD.ended_at,OLD.final_sequence,OLD.end_payload,OLD.end_signature)
   IS DISTINCT FROM (NEW.ended_at,NEW.final_sequence,NEW.end_payload,NEW.end_signature)) THEN
  RAISE EXCEPTION 'traffic_process_immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER remote_traffic_processes_immutable BEFORE UPDATE OR DELETE ON remote_traffic_processes FOR EACH ROW EXECUTE FUNCTION protect_traffic_process();

CREATE TABLE remote_traffic_samples (
 cell_id uuid NOT NULL,
 gateway_id uuid NOT NULL,
 generation billing_whole NOT NULL CHECK(generation>0),
 process_id uuid NOT NULL,
 sequence billing_whole NOT NULL CHECK(sequence>0),
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 venue_id uuid NOT NULL,
 installation_id uuid NOT NULL,
 configuration_revision billing_whole NOT NULL,
 route_binding traffic_digest NOT NULL,
 channel text NOT NULL CHECK(channel IN ('staff','public')),
 from_at traffic_instant NOT NULL,
 until_at traffic_instant NOT NULL CHECK(until_at>from_at),
 day date GENERATED ALWAYS AS ((until_at AT TIME ZONE 'UTC')::date) STORED,
 complete boolean NOT NULL,
 ingress allowance_quantity NOT NULL,
 egress allowance_quantity NOT NULL,
 report_digest traffic_digest NOT NULL,
 report_payload traffic_payload NOT NULL,
 report_signature traffic_signature NOT NULL,
 source_reference text GENERATED ALWAYS AS (process_id::text||':'||trunc(sequence)::text||':'||installation_id::text||':'||channel) STORED UNIQUE,
 PRIMARY KEY(cell_id,gateway_id,generation,process_id,sequence,installation_id,channel),
 FOREIGN KEY(cell_id,gateway_id,generation,process_id) REFERENCES remote_traffic_processes,
 FOREIGN KEY(venue_id,organisation_id,legal_business_id) REFERENCES venues(id,organisation_id,legal_business_id),
 FOREIGN KEY(installation_id,venue_id) REFERENCES installations(id,venue_id),
 CHECK(ingress+egress<=9223372036854775807)
);
CREATE INDEX remote_traffic_samples_venue_day ON remote_traffic_samples(venue_id,day);
CREATE TRIGGER remote_traffic_samples_immutable BEFORE UPDATE OR DELETE ON remote_traffic_samples FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();

-- An empty publication is explicit evidence; absent journal rows never mean no route served.
CREATE TABLE remote_traffic_coverage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cell_id uuid NOT NULL,
 country text NOT NULL DEFAULT 'ES' CHECK(country='ES'),
 environment text NOT NULL DEFAULT 'test' CHECK(environment='test'),
 gateway_id uuid NOT NULL,
 generation billing_whole NOT NULL CHECK(generation>0),
 manifest_digest traffic_digest NOT NULL,
 manifest_sequence billing_whole NOT NULL CHECK(manifest_sequence>0),
 issued_at traffic_instant NOT NULL,
 expires_at traffic_instant NOT NULL CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes'),
 kind text NOT NULL CHECK(kind IN ('route','empty')),
 organisation_id uuid,
 legal_business_id uuid,
 venue_id uuid,
 installation_id uuid,
 configuration_revision billing_whole,
 route_binding traffic_digest,
 channel text CHECK(channel IN ('staff','public')),
 FOREIGN KEY(cell_id,country,environment) REFERENCES remote_cells(id,country,environment),
 FOREIGN KEY(venue_id,organisation_id,legal_business_id) REFERENCES venues(id,organisation_id,legal_business_id),
 FOREIGN KEY(installation_id,venue_id) REFERENCES installations(id,venue_id),
 CHECK((kind='empty' AND organisation_id IS NULL AND legal_business_id IS NULL AND venue_id IS NULL AND installation_id IS NULL
   AND configuration_revision IS NULL AND route_binding IS NULL AND channel IS NULL)
  OR (kind='route' AND organisation_id IS NOT NULL AND legal_business_id IS NOT NULL AND venue_id IS NOT NULL AND installation_id IS NOT NULL
   AND configuration_revision IS NOT NULL AND route_binding IS NOT NULL AND channel IS NOT NULL))
);
CREATE UNIQUE INDEX remote_traffic_coverage_identity ON remote_traffic_coverage
 (cell_id,gateway_id,generation,manifest_digest,coalesce(installation_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(channel,''));
CREATE INDEX remote_traffic_coverage_venue_lifetime ON remote_traffic_coverage(venue_id,issued_at,expires_at);
CREATE TRIGGER remote_traffic_coverage_immutable BEFORE UPDATE OR DELETE ON remote_traffic_coverage FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();

ALTER TABLE usage_events
 DROP CONSTRAINT usage_events_event_type_check,
 DROP CONSTRAINT usage_events_source_kind_check,
 DROP CONSTRAINT usage_events_source_match_check,
 DROP CONSTRAINT usage_events_unit_quantity_check;
ALTER TABLE usage_events
 ADD CONSTRAINT usage_events_event_type_check CHECK(event_type IN (
  'backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes','backup.restore_bytes',
  'operation.installation_completed','operation.monitoring_probe',
  'message.service_alert_sent','message.service_alert_failed','message.service_alert_expired','message.service_alert_cancelled',
  'translation.items_completed','translation.input_tokens','translation.output_tokens','translation.cost_micro_usd',
  'remote_access.traffic_bytes')),
 ADD CONSTRAINT usage_events_source_kind_check CHECK(source_kind IN (
  'backup_point','backup_recovery','installation_operation','monitoring_probe','service_alert','translation_job','remote_traffic_sample')),
 ADD CONSTRAINT usage_events_source_match_check CHECK(
  (event_type IN ('backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes') AND source_kind='backup_point')
  OR (event_type='backup.restore_bytes' AND source_kind='backup_recovery')
  OR (event_type='operation.installation_completed' AND source_kind='installation_operation')
  OR (event_type='operation.monitoring_probe' AND source_kind='monitoring_probe')
  OR (event_type LIKE 'message.service_alert_%' AND source_kind='service_alert')
  OR (event_type LIKE 'translation.%' AND source_kind='translation_job')
  OR (event_type='remote_access.traffic_bytes' AND source_kind='remote_traffic_sample' AND venue_id IS NOT NULL)),
 ADD CONSTRAINT usage_events_unit_quantity_check CHECK(event_type LIKE 'backup.%' OR event_type LIKE 'translation.%' OR event_type='remote_access.traffic_bytes' OR quantity=1);
