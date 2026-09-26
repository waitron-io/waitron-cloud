ALTER TABLE backup_recoveries ADD COLUMN restored_at timestamptz;

CREATE TABLE usage_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES organisations(id),
 venue_id uuid REFERENCES venues(id),
 event_type text NOT NULL CHECK(event_type IN (
  'backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes','backup.restore_bytes',
  'operation.installation_completed','operation.monitoring_probe',
  'message.service_alert_sent','message.service_alert_failed','message.service_alert_expired','message.service_alert_cancelled'
 )),
 quantity bigint NOT NULL CHECK(quantity>0),
 source_kind text NOT NULL CHECK(source_kind IN (
  'backup_point','backup_recovery','installation_operation','monitoring_probe','service_alert'
 )),
 source_reference text NOT NULL CHECK(
  length(source_reference) BETWEEN 1 AND 256
  AND source_reference ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$'
 ),
 occurred_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(event_type,source_kind,source_reference)
);
CREATE INDEX usage_events_organisation_type_idx ON usage_events(organisation_id,event_type,occurred_at,id);

CREATE FUNCTION reject_usage_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'usage_event_immutable' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER usage_events_immutable BEFORE UPDATE OR DELETE ON usage_events
 FOR EACH ROW EXECUTE FUNCTION reject_usage_event_mutation();

CREATE TABLE usage_reconciliation_sources (
 source text PRIMARY KEY CHECK(source IN ('backup_points','backup_recoveries','installation_operations','service_alerts')),
 last_attempted_at timestamptz,
 caught_up_at timestamptz
);
INSERT INTO usage_reconciliation_sources(source) VALUES
 ('backup_points'),('backup_recoveries'),('installation_operations'),('service_alerts');
