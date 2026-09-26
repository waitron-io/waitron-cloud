ALTER TABLE cloud_sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE cloud_sessions ADD CONSTRAINT cloud_sessions_id_unique UNIQUE (id);
