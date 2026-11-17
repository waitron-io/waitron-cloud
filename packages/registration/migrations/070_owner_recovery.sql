ALTER TABLE cloud_accounts ADD COLUMN recovery_organisation_id uuid REFERENCES organisations(id);
ALTER TABLE password_reset_requests
  ADD COLUMN purpose text NOT NULL DEFAULT 'password_reset' CHECK(purpose IN ('password_reset','owner_recovery')),
  ADD COLUMN recovery_id uuid UNIQUE,
  ADD COLUMN mailbox_proven_at timestamptz,
  ADD COLUMN recovery_binding jsonb,
  ADD COLUMN recovery_decision text CHECK(recovery_decision IN ('approved','refused')),
  ADD COLUMN recovery_decision_digest text,
  ADD COLUMN recovery_decision_result jsonb,
  ADD CONSTRAINT owner_recovery_mailbox CHECK ((purpose='password_reset' AND recovery_id IS NULL AND mailbox_proven_at IS NULL)
    OR (purpose='owner_recovery' AND recovery_id IS NOT NULL AND mailbox_proven_at IS NOT NULL));
