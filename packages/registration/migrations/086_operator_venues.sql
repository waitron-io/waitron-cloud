ALTER TABLE security_audit_events
  DROP CONSTRAINT security_audit_events_event_type_check,
  ADD CONSTRAINT security_audit_events_event_type_check CHECK (event_type IN (
    'pairing.cloud_approved',
    'pairing.local_approved',
    'installation.credentials_renewed',
    'installation.revoked',
    'recovery.approved',
    'replacement.approved',
    'support.granted',
    'support.revoked',
    'support.accessed',
    'venue.viewed',
    'venue.address_lookup_stopped',
    'venue.address_lookup_allowed'
  )),
  DROP CONSTRAINT security_audit_events_subject_kind_check,
  ADD CONSTRAINT security_audit_events_subject_kind_check CHECK (subject_kind IN (
    'pairing_request', 'installation', 'recovery', 'replacement', 'support_grant', 'venue'
  ));
