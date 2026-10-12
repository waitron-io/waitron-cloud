CREATE TABLE relay_bounds_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 definition jsonb NOT NULL
);
CREATE TABLE relay_bounds_windows (
 window_start timestamptz PRIMARY KEY,
 ends_at timestamptz NOT NULL CHECK(ends_at>window_start),
 key_id text NOT NULL,
 key_verifier text NOT NULL
);
CREATE INDEX relay_bounds_window_expiry_idx ON relay_bounds_windows(ends_at);
CREATE TABLE relay_bounds_counters (
 window_start timestamptz NOT NULL REFERENCES relay_bounds_windows(window_start),
 kind text NOT NULL CHECK(kind IN ('recipient','grant')),
 subject text NOT NULL,
 count bigint NOT NULL CHECK(count>0),
 PRIMARY KEY(window_start,kind,subject)
);
-- Apply with consumers stopped: old ciphertext contributes bytes, not invented counters.
LOCK TABLE relay_messages IN ACCESS EXCLUSIVE MODE;
CREATE TABLE relay_queue_bytes (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 bytes bigint NOT NULL CHECK(bytes>=0)
);
INSERT INTO relay_queue_bytes(singleton,bytes)
 SELECT true,COALESCE(sum(COALESCE(octet_length(payload),0)),0) FROM relay_messages;
CREATE FUNCTION relay_account_payload_bytes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta bigint; cap bigint;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  UPDATE relay_queue_bytes SET bytes=0 WHERE singleton;
  IF NOT FOUND THEN RAISE EXCEPTION 'relay_bytes_unavailable' USING ERRCODE='P0001'; END IF;
  RETURN NULL;
 END IF;
 delta:=CASE WHEN TG_OP='DELETE' THEN 0 ELSE COALESCE(octet_length(NEW.payload),0) END
       -CASE WHEN TG_OP='INSERT' THEN 0 ELSE COALESCE(octet_length(OLD.payload),0) END;
 IF delta=0 THEN RETURN NULL; END IF;
 IF delta>0 THEN
  SELECT (definition->>'queuedPayloadBytes')::bigint INTO cap FROM relay_bounds_policy WHERE singleton;
  IF cap IS NULL THEN RAISE EXCEPTION 'relay_bytes_unavailable' USING ERRCODE='P0001'; END IF;
  UPDATE relay_queue_bytes SET bytes=bytes+delta WHERE singleton AND bytes<=cap-delta;
  IF NOT FOUND THEN
   IF NOT EXISTS(SELECT 1 FROM relay_queue_bytes WHERE singleton) THEN
    RAISE EXCEPTION 'relay_bytes_unavailable' USING ERRCODE='P0001';
   END IF;
   RAISE EXCEPTION 'relay_bytes_exhausted' USING ERRCODE='P0001';
  END IF;
 ELSE
  UPDATE relay_queue_bytes SET bytes=bytes+delta WHERE singleton AND bytes>=-delta;
  IF NOT FOUND THEN RAISE EXCEPTION 'relay_bytes_unavailable' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER relay_payload_bytes AFTER INSERT OR UPDATE OR DELETE ON relay_messages
 FOR EACH ROW EXECUTE FUNCTION relay_account_payload_bytes();
CREATE TRIGGER relay_payload_bytes_truncate AFTER TRUNCATE ON relay_messages
 FOR EACH STATEMENT EXECUTE FUNCTION relay_account_payload_bytes();
