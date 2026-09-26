CREATE INDEX cloud_sessions_history_cleanup_idx
  ON cloud_sessions (ended_at, absolute_expires_at, last_seen_at, token_hash);
CREATE INDEX signup_requests_history_cleanup_idx
  ON signup_requests (consumed_at, expires_at, token_hash);
CREATE INDEX password_reset_requests_history_cleanup_idx
  ON password_reset_requests (consumed_at, expires_at, token_hash);
CREATE INDEX cloud_webauthn_ceremonies_history_cleanup_idx
  ON cloud_webauthn_ceremonies (consumed_at, expires_at, id);
CREATE INDEX pairing_requests_history_cleanup_idx
  ON pairing_requests (expires_at, id);
CREATE INDEX connection_requests_history_cleanup_idx
  ON connection_requests (completed_at, expires_at, installation_key, operation_id);
CREATE INDEX installation_operations_history_cleanup_idx
  ON installation_operations (created_at, installation_id, operation_id);
CREATE INDEX email_outbox_history_cleanup_idx
  ON email_outbox (finished_at, id) WHERE status IN ('sent', 'expired', 'cancelled', 'failed');
CREATE INDEX backup_jobs_history_cleanup_idx
  ON backup_jobs (last_success_at, available_at, id) WHERE status = 'completed';
CREATE INDEX backup_recoveries_history_cleanup_idx
  ON backup_recoveries (expires_at, id) WHERE status = 'closed';
CREATE INDEX backup_points_history_cleanup_idx
  ON backup_points (deleted_at, id) WHERE deleted_at IS NOT NULL;
CREATE INDEX backup_captures_history_cleanup_idx
  ON backup_captures (cleaned_at, id) WHERE cleaned_at IS NOT NULL;
