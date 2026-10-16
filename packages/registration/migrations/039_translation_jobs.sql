ALTER TABLE installations ADD CONSTRAINT installations_id_venue_id_key UNIQUE (id,venue_id);

ALTER TABLE installation_services DROP CONSTRAINT installation_services_service_check;
ALTER TABLE installation_services ADD CONSTRAINT installation_services_service_check
 CHECK (service IN ('remote_access','continuous_backup','retained_snapshots','content_translation'));

CREATE TABLE translation_prices (
 model text PRIMARY KEY CONSTRAINT translation_prices_model_check CHECK (length(model) BETWEEN 1 AND 100),
 provider text NOT NULL CONSTRAINT translation_prices_provider_check CHECK (provider IN ('openai','anthropic','google')),
 input_micro_usd_per_million bigint NOT NULL CONSTRAINT translation_prices_input_micro_usd_per_million_check CHECK (input_micro_usd_per_million>=0),
 output_micro_usd_per_million bigint NOT NULL CONSTRAINT translation_prices_output_micro_usd_per_million_check CHECK (output_micro_usd_per_million>=0),
 source text NOT NULL CONSTRAINT translation_prices_source_check CHECK (length(source) BETWEEN 1 AND 500)
);
INSERT INTO translation_prices VALUES ('gpt-6-luna','openai',100000,500000,
 'developers.openai.com/api/docs/pricing, standard tier, read 2026-10-14');

CREATE TABLE translation_policy (
 singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT translation_policy_singleton_check CHECK (singleton),
 monthly_cap_micro_usd bigint NOT NULL CONSTRAINT translation_policy_monthly_cap_micro_usd_check CHECK (monthly_cap_micro_usd>0),
 estimate_micro_usd_per_item bigint NOT NULL CONSTRAINT translation_policy_estimate_micro_usd_per_item_check CHECK (estimate_micro_usd_per_item>0)
);
INSERT INTO translation_policy VALUES (true,5000000,146);

CREATE TABLE translation_consents (
 id uuid PRIMARY KEY,
 venue_id uuid NOT NULL REFERENCES venues(id),
 organisation_id uuid NOT NULL REFERENCES organisations(id),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 consent_version text NOT NULL CONSTRAINT translation_consents_consent_version_check CHECK (consent_version ~ '^[a-zA-Z0-9_.:-]{1,100}$'),
 providers text[] NOT NULL CONSTRAINT translation_consents_providers_check CHECK (providers=ARRAY['openai','anthropic','google']),
 consented_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 withdrawn_at timestamptz,
 CONSTRAINT translation_consents_withdrawn_check CHECK (withdrawn_at IS NULL OR withdrawn_at>=consented_at),
 FOREIGN KEY (venue_id,organisation_id) REFERENCES venues(id,organisation_id)
);
CREATE UNIQUE INDEX translation_consents_current_idx ON translation_consents(venue_id) WHERE withdrawn_at IS NULL;

CREATE TABLE translation_jobs (
 id uuid PRIMARY KEY,
 installation_id uuid NOT NULL REFERENCES installations(id),
 venue_id uuid NOT NULL REFERENCES venues(id),
 operation_id uuid NOT NULL,
 job_sha256 text NOT NULL CONSTRAINT translation_jobs_job_sha256_check CHECK (job_sha256 ~ '^[0-9a-f]{64}$'),
 job_bytes integer NOT NULL CONSTRAINT translation_jobs_job_bytes_check CHECK (job_bytes BETWEEN 1 AND 1048576),
 state text NOT NULL DEFAULT 'queued' CONSTRAINT translation_jobs_state_check
  CHECK (state IN ('queued','running','done','partly_done','failed','collected','expired')),
 reason text CONSTRAINT translation_jobs_reason_check CHECK (reason IN ('limit_reached','provider_failed','provider_unavailable','consent_required')),
 total integer NOT NULL CONSTRAINT translation_jobs_total_check CHECK (total BETWEEN 1 AND 1000),
 done integer NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_done_check CHECK (done>=0),
 failed integer NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_failed_check CHECK (failed>=0),
 input_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_input_tokens_check CHECK (input_tokens>=0),
 output_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_output_tokens_check CHECK (output_tokens>=0),
 cost_micro_usd bigint NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_cost_micro_usd_check CHECK (cost_micro_usd>=0),
 review_applied integer NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_review_applied_check CHECK (review_applied>=0),
 review_dropped integer NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_review_dropped_check CHECK (review_dropped>=0),
 provider text NOT NULL CONSTRAINT translation_jobs_provider_check CHECK (provider IN ('openai','anthropic','google')),
 model text NOT NULL REFERENCES translation_prices(model),
 prompt_version text NOT NULL CONSTRAINT translation_jobs_prompt_version_check CHECK (prompt_version ~ '^[a-z0-9.-]{1,64}$'),
 lease_id uuid,
 lease_until timestamptz,
 lease_count integer NOT NULL DEFAULT 0 CONSTRAINT translation_jobs_lease_count_check CHECK (lease_count>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,
 finished_at timestamptz,
 collected_at timestamptz,
 UNIQUE (installation_id,operation_id),
 CONSTRAINT translation_jobs_installation_venue_fkey FOREIGN KEY (installation_id,venue_id) REFERENCES installations(id,venue_id),
 CONSTRAINT translation_jobs_counts_check CHECK (done+failed<=total),
 CONSTRAINT translation_jobs_finished_at_check CHECK ((state IN ('done','partly_done','failed')) <= (finished_at IS NOT NULL)),
 CONSTRAINT translation_jobs_reason_state_check CHECK ((reason IS NOT NULL) <= (state IN ('partly_done','failed','expired','collected'))),
 CONSTRAINT translation_jobs_reason_required_check CHECK ((state IN ('partly_done','failed')) <= (reason IS NOT NULL)),
 CONSTRAINT translation_jobs_partly_done_reason_check CHECK (state<>'partly_done' OR reason IN ('limit_reached','provider_failed')),
 CONSTRAINT translation_jobs_failed_reason_check CHECK (state<>'failed' OR reason IN ('provider_unavailable','consent_required','limit_reached'))
);
CREATE UNIQUE INDEX translation_jobs_one_open_idx ON translation_jobs(venue_id) WHERE state IN ('queued','running');
CREATE INDEX translation_jobs_venue_created_idx ON translation_jobs(venue_id,created_at);
CREATE INDEX translation_jobs_open_idx ON translation_jobs(created_at) WHERE state IN ('queued','running');

CREATE TABLE translation_job_bodies (
 job_id uuid PRIMARY KEY REFERENCES translation_jobs(id),
 body text NOT NULL,
 batch_results jsonb NOT NULL DEFAULT '{}' CONSTRAINT translation_job_bodies_batch_results_check CHECK (jsonb_typeof(batch_results)='object')
);

-- Replace only the enumerations and relationships being extended; retain other accounting rules.
ALTER TABLE usage_events
 DROP CONSTRAINT usage_events_event_type_check,
 DROP CONSTRAINT usage_events_source_kind_check,
 DROP CONSTRAINT usage_events_check,
 DROP CONSTRAINT usage_events_check1;
ALTER TABLE usage_events
 ADD CONSTRAINT usage_events_event_type_check CHECK (event_type IN (
  'backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes','backup.restore_bytes',
  'operation.installation_completed','operation.monitoring_probe',
  'message.service_alert_sent','message.service_alert_failed','message.service_alert_expired','message.service_alert_cancelled',
  'translation.items_completed','translation.input_tokens','translation.output_tokens','translation.cost_micro_usd')),
 ADD CONSTRAINT usage_events_source_kind_check CHECK (source_kind IN (
  'backup_point','backup_recovery','installation_operation','monitoring_probe','service_alert','translation_job')),
 ADD CONSTRAINT usage_events_source_match_check CHECK (
  (event_type IN ('backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes') AND source_kind='backup_point')
  OR (event_type='backup.restore_bytes' AND source_kind='backup_recovery')
  OR (event_type='operation.installation_completed' AND source_kind='installation_operation')
  OR (event_type='operation.monitoring_probe' AND source_kind='monitoring_probe')
  OR (event_type LIKE 'message.service_alert_%' AND source_kind='service_alert')
  OR (event_type LIKE 'translation.%' AND source_kind='translation_job')),
 ADD CONSTRAINT usage_events_unit_quantity_check CHECK (event_type LIKE 'backup.%' OR event_type LIKE 'translation.%' OR quantity=1);
