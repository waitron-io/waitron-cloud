CREATE TABLE venue_alert_episodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 incident_id uuid NOT NULL REFERENCES venue_incidents(id),
 installation_id uuid NOT NULL REFERENCES installations(id),
 opening_revision integer NOT NULL CHECK (opening_revision > 0),
 opened_at timestamptz NOT NULL,
 quiet_seconds integer NOT NULL CHECK (quiet_seconds BETWEEN 0 AND 604800),
 reminder_seconds integer NOT NULL CHECK (reminder_seconds BETWEEN 0 AND 604800),
 opening_due_at timestamptz NOT NULL,
 opening_processed_at timestamptz,
 recovery_revision integer,
 status text NOT NULL CHECK (status IN ('open','recovered','suppressed')),
 legacy boolean NOT NULL DEFAULT false,
 recovery_complete boolean NOT NULL DEFAULT false,
 UNIQUE (incident_id,opening_revision),
 CHECK (opening_due_at = opened_at + quiet_seconds * interval '1 second'),
 CHECK ((status = 'recovered' AND recovery_revision IS NOT NULL AND recovery_revision > opening_revision)
   OR (status IN ('open','suppressed') AND recovery_revision IS NULL)),
 CHECK (NOT recovery_complete OR status <> 'open'),
 CHECK (NOT legacy OR (quiet_seconds = 0 AND reminder_seconds = 0 AND opening_processed_at IS NOT NULL))
);
CREATE INDEX venue_alert_opening_due ON venue_alert_episodes (opening_due_at,incident_id)
 WHERE status = 'open' AND opening_processed_at IS NULL;
CREATE TABLE venue_alert_recipients (
 episode_id uuid NOT NULL REFERENCES venue_alert_episodes(id),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 reminder_due_at timestamptz,
 reminder_status text NOT NULL CHECK (reminder_status IN ('waiting','queued','cancelled','done')),
 recovery_status text NOT NULL CHECK (recovery_status IN ('waiting','queued','cancelled','done')),
 PRIMARY KEY (episode_id,account_id),
 CHECK (reminder_status NOT IN ('queued','done') OR reminder_due_at IS NOT NULL)
);
CREATE INDEX venue_alert_reminder_due ON venue_alert_recipients (reminder_due_at,episode_id)
 WHERE reminder_status = 'waiting' AND reminder_due_at IS NOT NULL;
ALTER TABLE service_alert_deliveries ADD COLUMN episode_id uuid REFERENCES venue_alert_episodes(id);
ALTER TABLE service_alert_deliveries ADD COLUMN notification text NOT NULL DEFAULT 'transition'
 CHECK (notification IN ('transition','reminder'));
ALTER TABLE service_alert_deliveries ADD CONSTRAINT service_alert_reminder_state CHECK (notification <> 'reminder' OR state = 'open');
ALTER TABLE service_alert_deliveries DROP CONSTRAINT service_alert_deliveries_incident_id_revision_account_id_key;
ALTER TABLE service_alert_deliveries ADD UNIQUE (incident_id,revision,account_id,notification);
CREATE UNIQUE INDEX service_alert_episode_slot ON service_alert_deliveries (episode_id,account_id,state,notification)
 WHERE episode_id IS NOT NULL;

-- Legacy schedules only watch deliveries already admitted. They cannot create a
-- historical opening or reminder when a new process enables a timing option.
DO $$
DECLARE
 incident record;
 episode uuid;
 opening integer;
 after_account uuid;
 batch_accounts uuid[];
 batch_outbox uuid[];
BEGIN
 FOR incident IN
  SELECT v.*,i.id AS installation_id FROM venue_incidents v
  JOIN installations i ON i.venue_id=v.venue_id AND i.superseded_by IS NULL
  WHERE v.status IN ('open','recovered') AND (v.status='open' OR v.revision>1)
  ORDER BY v.id
 LOOP
  opening := CASE WHEN incident.status='open' THEN incident.revision ELSE incident.revision-1 END;
  INSERT INTO venue_alert_episodes(incident_id,installation_id,opening_revision,opened_at,
   quiet_seconds,reminder_seconds,opening_due_at,opening_processed_at,recovery_revision,status,legacy)
  VALUES(incident.id,incident.installation_id,opening,incident.opened_at,0,0,incident.opened_at,
   clock_timestamp(),CASE WHEN incident.status='recovered' THEN incident.revision END,incident.status,true)
  RETURNING id INTO episode;
  after_account := NULL;
  LOOP
   SELECT array_agg(account_id ORDER BY account_id) INTO batch_accounts FROM (
    SELECT account_id FROM service_alert_deliveries
    WHERE incident_id=incident.id AND revision=opening AND state='open'
     AND (after_account IS NULL OR account_id>after_account)
    ORDER BY account_id LIMIT 100
   ) batch;
   EXIT WHEN batch_accounts IS NULL;
   INSERT INTO venue_alert_recipients(episode_id,account_id,reminder_status,recovery_status)
    SELECT episode,d.account_id,'cancelled',CASE
     WHEN incident.status='open' THEN 'waiting'
     WHEN recovery.outbox_id IS NOT NULL THEN CASE WHEN recovered.status IN ('pending','processing') THEN 'queued' ELSE 'done' END
     WHEN opened.status IN ('pending','processing') THEN 'waiting'
     ELSE 'cancelled' END
    FROM service_alert_deliveries d JOIN email_outbox opened ON opened.id=d.outbox_id
    LEFT JOIN service_alert_deliveries recovery ON recovery.incident_id=d.incident_id
     AND recovery.revision=incident.revision AND recovery.state='recovered' AND recovery.account_id=d.account_id
    LEFT JOIN email_outbox recovered ON recovered.id=recovery.outbox_id
    WHERE d.incident_id=incident.id AND d.revision=opening AND d.state='open' AND d.account_id=ANY(batch_accounts);
   after_account := batch_accounts[array_length(batch_accounts,1)];
  END LOOP;
  LOOP
   SELECT array_agg(outbox_id) INTO batch_outbox FROM (
    SELECT d.outbox_id FROM service_alert_deliveries d
    JOIN venue_alert_recipients r ON r.episode_id=episode AND r.account_id=d.account_id
    WHERE d.incident_id=incident.id AND d.episode_id IS NULL
     AND ((d.state='open' AND d.revision=opening)
      OR (incident.status='recovered' AND d.state='recovered' AND d.revision=incident.revision))
    ORDER BY d.outbox_id LIMIT 100
   ) batch;
   EXIT WHEN batch_outbox IS NULL;
   UPDATE service_alert_deliveries SET episode_id=episode WHERE outbox_id=ANY(batch_outbox);
  END LOOP;
  UPDATE venue_alert_episodes SET recovery_complete = incident.status='recovered' AND NOT EXISTS (
   SELECT 1 FROM venue_alert_recipients WHERE episode_id=episode AND recovery_status IN ('waiting','queued')
  ) WHERE id=episode;
 END LOOP;
END $$;
