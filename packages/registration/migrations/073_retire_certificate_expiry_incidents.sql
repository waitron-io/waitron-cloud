UPDATE venue_incidents
SET status='suppressed',revision=revision+1,changed_at=clock_timestamp()
WHERE status='open' AND kind IN ('public_certificate_expiring','staff_certificate_expiring');

UPDATE venue_alert_episodes e
SET status='suppressed',recovery_revision=NULL,
 opening_processed_at=COALESCE(e.opening_processed_at,clock_timestamp()),recovery_complete=true
FROM venue_incidents i
WHERE i.id=e.incident_id AND e.status='open'
 AND i.kind IN ('public_certificate_expiring','staff_certificate_expiring');

UPDATE email_outbox mail
SET status='cancelled',payload=NULL,key_id=NULL,claim_id=NULL,lease_until=NULL,finished_at=clock_timestamp()
FROM service_alert_deliveries d JOIN venue_incidents i ON i.id=d.incident_id
WHERE mail.id=d.outbox_id AND mail.status='pending'
 AND i.kind IN ('public_certificate_expiring','staff_certificate_expiring');

UPDATE venue_alert_recipients r
SET reminder_status=CASE WHEN r.reminder_status='waiting' OR r.reminder_status='queued' AND EXISTS(
 SELECT 1 FROM service_alert_deliveries d JOIN email_outbox mail ON mail.id=d.outbox_id
 WHERE d.episode_id=r.episode_id AND d.account_id=r.account_id AND d.state='open' AND d.notification='reminder' AND mail.status='cancelled'
) THEN 'cancelled' WHEN r.reminder_status='queued' AND EXISTS(
 SELECT 1 FROM service_alert_deliveries d JOIN email_outbox mail ON mail.id=d.outbox_id
 WHERE d.episode_id=r.episode_id AND d.account_id=r.account_id AND d.state='open' AND d.notification='reminder' AND mail.status IN ('sent','failed','expired')
) THEN 'done' ELSE r.reminder_status END,
 recovery_status=CASE WHEN r.recovery_status='waiting' OR r.recovery_status='queued' AND EXISTS(
 SELECT 1 FROM service_alert_deliveries d JOIN email_outbox mail ON mail.id=d.outbox_id
 WHERE d.episode_id=r.episode_id AND d.account_id=r.account_id AND d.state='recovered' AND d.notification='transition' AND mail.status='cancelled'
) THEN 'cancelled' WHEN r.recovery_status='queued' AND EXISTS(
 SELECT 1 FROM service_alert_deliveries d JOIN email_outbox mail ON mail.id=d.outbox_id
 WHERE d.episode_id=r.episode_id AND d.account_id=r.account_id AND d.state='recovered' AND d.notification='transition' AND mail.status IN ('sent','failed','expired')
) THEN 'done' ELSE r.recovery_status END
FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id
WHERE r.episode_id=e.id AND (e.status='suppressed' OR e.status='recovered' AND NOT e.recovery_complete)
 AND i.kind IN ('public_certificate_expiring','staff_certificate_expiring');

UPDATE venue_alert_episodes e
SET recovery_complete=NOT EXISTS(
 SELECT 1 FROM venue_alert_recipients r WHERE r.episode_id=e.id AND r.recovery_status IN ('waiting','queued')
) AND NOT EXISTS(
 SELECT 1 FROM service_alert_deliveries d JOIN email_outbox mail ON mail.id=d.outbox_id
 WHERE d.episode_id=e.id AND mail.status IN ('pending','processing')
)
FROM venue_incidents i
WHERE i.id=e.incident_id AND e.status='recovered' AND NOT e.recovery_complete
 AND i.kind IN ('public_certificate_expiring','staff_certificate_expiring');
