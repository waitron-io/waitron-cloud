CREATE TABLE relay_messages (
 installation_id uuid NOT NULL,
 message_id uuid NOT NULL,
 grant_id uuid NOT NULL REFERENCES relay_grants(id),
 grant_revision integer NOT NULL CHECK (grant_revision>0),
 class text NOT NULL CHECK (class IN ('invitation','password_reset','email_change')),
 binding text NOT NULL,
 replay_key_id text NOT NULL,
 key_id text NOT NULL,
 payload bytea,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','accepted','uncertain','failed','expired','cancelled')),
 status_revision integer NOT NULL DEFAULT 1 CHECK (status_revision>0),
 reason text CHECK (reason IN ('expired','cancelled','payload_unavailable','refused','uncertain')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (installation_id,message_id),
 FOREIGN KEY (installation_id,message_id) REFERENCES relay_reservations(installation_id,message_id),
 CHECK ((state IN ('queued','sending') AND payload IS NOT NULL) OR (state NOT IN ('queued','sending') AND payload IS NULL))
);
CREATE INDEX relay_messages_queued_expiry_idx ON relay_messages(expires_at) WHERE state='queued';
