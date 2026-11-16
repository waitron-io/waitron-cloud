CREATE TABLE cloud_action_requests (
 id uuid PRIMARY KEY,
 occurrence text NOT NULL CHECK (length(occurrence) BETWEEN 1 AND 160),
 version integer NOT NULL CHECK (version > 0),
 action_id text NOT NULL,
 policy text NOT NULL CHECK (policy IN ('ask-first','act-and-report')),
 cell text NOT NULL CHECK (length(cell) BETWEEN 1 AND 160),
 target text NOT NULL CHECK (length(target) BETWEEN 1 AND 160),
 proposal text NOT NULL CHECK (length(proposal) BETWEEN 1 AND 1000),
 evidence text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 1000),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','superseded')),
 effect_id uuid NOT NULL UNIQUE,
 dispatch_started_at timestamptz,
 outcome jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decided_at timestamptz,
 approval_expires_at timestamptz,
 UNIQUE(occurrence,version),
 CHECK ((state IN ('approved','rejected')) = (decided_at IS NOT NULL) OR state='superseded'),
 CHECK (approval_expires_at IS NULL OR decided_at IS NOT NULL AND approval_expires_at=decided_at+interval '15 minutes'),
 CHECK (state<>'rejected' OR approval_expires_at IS NULL),
 CHECK (state<>'approved' OR approval_expires_at IS NOT NULL)
);
CREATE TABLE cloud_action_events (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES cloud_action_requests(id),
 kind text NOT NULL CHECK (kind IN ('proposed','approved','rejected','superseded','notice')),
 actor_account_id uuid REFERENCES cloud_accounts(id),
 -- Notice identity outlives the outbox delivery retention.
 notice_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(request_id,kind),
 CHECK ((kind='notice')=(notice_id IS NOT NULL))
);
CREATE FUNCTION guard_cloud_action_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='cloud_action_events' THEN
  RAISE EXCEPTION 'cloud_action_history_immutable';
 END IF;
 IF ROW(NEW.id,NEW.occurrence,NEW.version,NEW.action_id,NEW.policy,NEW.cell,NEW.target,NEW.proposal,NEW.evidence,NEW.effect_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.occurrence,OLD.version,OLD.action_id,OLD.policy,OLD.cell,OLD.target,OLD.proposal,OLD.evidence,OLD.effect_id,OLD.created_at) THEN
  RAISE EXCEPTION 'cloud_action_binding_immutable';
 END IF;
 IF (NEW.state<>OLD.state AND NOT (OLD.state='pending' AND NEW.state IN ('approved','rejected','superseded')
  OR OLD.state IN ('approved','rejected') AND NEW.state='superseded'))
  OR (ROW(NEW.decided_at,NEW.approval_expires_at) IS DISTINCT FROM ROW(OLD.decided_at,OLD.approval_expires_at)
   AND NOT (OLD.state='pending' AND NEW.state IN ('approved','rejected'))) THEN
  RAISE EXCEPTION 'cloud_action_decision_immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER cloud_action_request_binding BEFORE UPDATE OR DELETE ON cloud_action_requests FOR EACH ROW EXECUTE FUNCTION guard_cloud_action_history();
CREATE TRIGGER cloud_action_event_history BEFORE UPDATE OR DELETE ON cloud_action_events FOR EACH ROW EXECUTE FUNCTION guard_cloud_action_history();
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check
 CHECK (kind IN ('verification','password_reset','password_changed','service_alert','sign_in_check','email_change','email_changed','operator_notice'));
ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_notice_token_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_notice_token_check
 CHECK ((kind IN ('password_changed','service_alert','email_changed','operator_notice'))=(token_hash IS NULL));
