ALTER TABLE backup_recoveries ADD COLUMN selection_open boolean;
ALTER TABLE backup_recoveries DROP CONSTRAINT backup_recoveries_source_check;
ALTER TABLE backup_recoveries ADD CONSTRAINT backup_recoveries_source_check CHECK(
 (source_kind='snapshot' AND (point_id IS NOT NULL OR selection_open IS TRUE)
  AND stream_configuration_revision IS NULL AND stream_generation IS NULL
  AND stream_recoverable_at IS NULL AND stream_source_node_id IS NULL)
 OR
 (source_kind='continuous' AND point_id IS NULL AND selection_open IS NULL
  AND stream_configuration_revision IS NOT NULL AND stream_generation IS NOT NULL
  AND stream_recoverable_at IS NOT NULL AND stream_source_node_id IS NOT NULL)
);
