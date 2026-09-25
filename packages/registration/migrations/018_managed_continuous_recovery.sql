CREATE TABLE backup_managed_streams (
 venue_id uuid PRIMARY KEY REFERENCES backup_locations(venue_id),
 installation_id uuid NOT NULL UNIQUE REFERENCES installations(id),
 requested_revision integer NOT NULL CHECK(requested_revision>=0),
 configuration_revision integer NOT NULL CHECK(configuration_revision=requested_revision+1),
 key_version integer NOT NULL CHECK(key_version>0),
 local_venue_id uuid NOT NULL,
 source_node_id uuid NOT NULL,
 pointer_signer_public_key text NOT NULL,
 object_prefix text NOT NULL CHECK(object_prefix ~ '^streams/[0-9a-f-]{36}/$'),
 writer_reference text NOT NULL,
 reader_reference text NOT NULL,
 generation text,
 recoverable_at timestamptz,
 observed_at timestamptz,
 FOREIGN KEY(venue_id,key_version) REFERENCES backup_key_versions(venue_id,version),
 CHECK((generation IS NULL)=(recoverable_at IS NULL)),
 CHECK((recoverable_at IS NULL)=(observed_at IS NULL))
);

ALTER TABLE backup_recoveries ALTER COLUMN point_id DROP NOT NULL;
ALTER TABLE backup_recoveries ADD COLUMN source_kind text NOT NULL DEFAULT 'snapshot'
 CHECK(source_kind IN ('snapshot','continuous'));
ALTER TABLE backup_recoveries ADD COLUMN stream_configuration_revision integer;
ALTER TABLE backup_recoveries ADD COLUMN stream_generation text;
ALTER TABLE backup_recoveries ADD COLUMN stream_recoverable_at timestamptz;
ALTER TABLE backup_recoveries ADD COLUMN stream_source_node_id uuid;
ALTER TABLE backup_recoveries ADD CONSTRAINT backup_recoveries_source_check CHECK(
 (source_kind='snapshot' AND point_id IS NOT NULL
  AND stream_configuration_revision IS NULL AND stream_generation IS NULL
  AND stream_recoverable_at IS NULL AND stream_source_node_id IS NULL)
 OR
 (source_kind='continuous' AND point_id IS NULL
  AND stream_configuration_revision IS NOT NULL AND stream_generation IS NOT NULL
  AND stream_recoverable_at IS NOT NULL AND stream_source_node_id IS NOT NULL)
);
