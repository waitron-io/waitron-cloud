-- These shape checks defend stored evidence. Wire parsing, digest recomputation and
-- child provenance remain the trusted admission boundary, before any pointer is set.
CREATE FUNCTION backup_verification_keys(value jsonb, names text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN value ?& names AND (SELECT count(*) FROM jsonb_object_keys(value))=cardinality(names);
END $$;

CREATE FUNCTION backup_verification_text(value jsonb, maximum integer, spaces boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_typeof(value)='string' AND length(value#>>'{}') BETWEEN 1 AND maximum
  AND (value#>>'{}') ~ CASE WHEN spaces THEN '^[ -~]+$' ELSE '^[!-~]+$' END,false)
$$;

CREATE FUNCTION backup_verification_hash(value jsonb, digits integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT COALESCE(jsonb_typeof(value)='string' AND length(value#>>'{}')=digits
  AND (value#>>'{}') ~ '^[0-9a-f]+$',false)
$$;

CREATE FUNCTION backup_verification_integer(value jsonb, minimum bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'number' OR (value#>>'{}') !~ '^(0|[1-9][0-9]{0,15})$' THEN RETURN false; END IF;
 RETURN (value#>>'{}')::numeric BETWEEN minimum AND 9007199254740991;
END $$;

CREATE FUNCTION backup_verification_target_shape(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m jsonb; dependency record; names text[]='{}'; tables text[]='{}';
BEGIN
 IF NOT backup_verification_keys(value,ARRAY['version','runtime','modules','compositionDigest','migrationDigest','policyDigest','digest'])
  OR value->'version' IS DISTINCT FROM '1'::jsonb
  OR NOT backup_verification_keys(value->'runtime',ARRAY['release','revision','fingerprint'])
  OR NOT backup_verification_text(value#>'{runtime,release}',256)
  OR NOT backup_verification_hash(value#>'{runtime,revision}',40)
  OR NOT backup_verification_hash(value#>'{runtime,fingerprint}',64)
  OR NOT backup_verification_hash(value->'compositionDigest',64)
  OR NOT backup_verification_hash(value->'migrationDigest',64)
  OR NOT backup_verification_hash(value->'policyDigest',64)
  OR NOT backup_verification_hash(value->'digest',64)
  OR jsonb_typeof(value->'modules') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(value->'modules') NOT BETWEEN 1 AND 64 THEN RETURN false; END IF;
 FOR m IN SELECT * FROM jsonb_array_elements(value->'modules') LOOP
  IF NOT backup_verification_keys(m,ARRAY['name','packageVersion','requires','schema','migrationTable','migrationDigest','semanticsVersion','policyDigest'])
   OR NOT COALESCE(m->>'name' ~ '^[a-z][a-z0-9-]{0,63}$',false)
   OR NOT backup_verification_text(m->'packageVersion',256)
   OR NOT backup_verification_integer(m->'schema',0)
   OR NOT backup_verification_integer(m->'semanticsVersion',1)
   OR NOT backup_verification_text(m->'migrationTable',256)
   OR NOT COALESCE(m->>'migrationTable' ~ '^__[a-z_][a-z0-9_]*$',false)
   OR NOT backup_verification_hash(m->'migrationDigest',64)
   OR NOT backup_verification_hash(m->'policyDigest',64)
   OR jsonb_typeof(m->'requires') IS DISTINCT FROM 'object'
   OR m->>'name'=ANY(names) OR m->>'migrationTable'=ANY(tables) THEN RETURN false; END IF;
  names=array_append(names,m->>'name'); tables=array_append(tables,m->>'migrationTable');
 END LOOP;
 FOR m IN SELECT * FROM jsonb_array_elements(value->'modules') LOOP
  IF (SELECT count(*) FROM jsonb_object_keys(m->'requires'))>64 THEN RETURN false; END IF;
  FOR dependency IN SELECT * FROM jsonb_each(m->'requires') LOOP
   IF NOT dependency.key=ANY(names)
    OR NOT backup_verification_text(dependency.value,256,true) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;

CREATE TABLE backup_verification_policy (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 target jsonb, verifier_image text,
 release_ready boolean NOT NULL DEFAULT false,
 CHECK((target IS NULL AND verifier_image IS NULL AND revision=0 AND NOT release_ready)
  OR (target IS NOT NULL AND backup_verification_target_shape(target)
   AND verifier_image IS NOT NULL AND length(verifier_image)<=256
   AND verifier_image ~ '^[!-~]+@sha256:[0-9a-f]{64}$' AND revision>0))
);
INSERT INTO backup_verification_policy(id) VALUES(1);

CREATE TABLE backup_verification_attempts (
 id uuid PRIMARY KEY,
 point_id uuid NOT NULL REFERENCES backup_points(id),
 job_id uuid NOT NULL REFERENCES backup_jobs(id),
 protocol text NOT NULL CHECK(protocol='backup-data-restore/v1'),
 request jsonb NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 point_metadata jsonb NOT NULL,
 target_digest text NOT NULL CHECK(target_digest ~ '^[0-9a-f]{64}$'),
 policy_revision bigint NOT NULL CHECK(policy_revision>0),
 verifier_image text NOT NULL CHECK(length(verifier_image)<=256 AND verifier_image ~ '^[!-~]+@sha256:[0-9a-f]{64}$'),
 claim_id uuid NOT NULL,
 attempt_number bigint NOT NULL CHECK(attempt_number>0),
 controller_scope text NOT NULL CHECK(length(controller_scope) BETWEEN 1 AND 128 AND controller_scope ~ '^[!-~]+$'),
 child_token text NOT NULL UNIQUE CHECK(length(child_token) BETWEEN 1 AND 128 AND child_token ~ '^[!-~]+$'),
 deadline timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','finished')),
 status text CHECK(status IN ('passed','invalid','needs_authority','unsupported','unavailable')),
 reason text,
 result jsonb,
 child_id text CHECK(length(child_id) BETWEEN 1 AND 256 AND child_id ~ '^[!-~]+$'),
 cleanup_confirmed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 admitted_at timestamptz,
 UNIQUE(point_id,id),
 UNIQUE(job_id,claim_id),
 CHECK(backup_verification_keys(request,ARRAY['protocol','captureId','pointId','venueId','sourceInstallationId','sourceNodeId','capturedAt','archive','backupKey','target','verifierImage','attempt'])
  AND backup_verification_keys(request->'archive',ARRAY['sha256','bytes','manifestVersion','environment','modules'])
  AND backup_verification_keys(request->'backupKey',ARRAY['version','reference'])
  AND backup_verification_keys(request->'attempt',ARRAY['jobId','number','claimId','controllerScope','childToken','deadline'])
  AND backup_verification_target_shape(request->'target')
  AND backup_verification_keys(point_metadata,ARRAY['objectKey','retention','venueId','installationId','keyVersion','digest','size','capturedAt','sourceNodeId','modules'])),
 CHECK((request->>'protocol'=protocol AND request->>'captureId'=point_id::text AND request->>'pointId'=point_id::text
  AND request->>'verifierImage'=verifier_image AND request#>>'{target,digest}'=target_digest
  AND request#>>'{attempt,jobId}'=job_id::text AND request#>>'{attempt,claimId}'=claim_id::text
  AND request#>'{attempt,number}'=to_jsonb(attempt_number)
  AND request#>>'{attempt,controllerScope}'=controller_scope AND request#>>'{attempt,childToken}'=child_token
  AND request#>>'{attempt,deadline}'=to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) IS TRUE),
 CHECK((state='running' AND status IS NULL AND reason IS NULL AND result IS NULL AND child_id IS NULL
   AND NOT cleanup_confirmed AND finished_at IS NULL AND admitted_at IS NULL)
  OR (state='finished' AND status IS NOT NULL AND reason IS NOT NULL AND finished_at IS NOT NULL
   AND (admitted_at IS NULL OR admitted_at>=finished_at))),
 CHECK((status IS NULL OR
  (status='passed' AND reason='none') OR
  (status='invalid' AND reason IN ('archive_digest_mismatch','archive_size_mismatch','archive_invalid','binding_mismatch','sqlite_integrity','module_integrity','secret_invalid')) OR
  (status='needs_authority' AND reason='module_data_check_requires_authority') OR
  (status='unsupported' AND reason IN ('archive_format_unsupported','module_missing','target_incompatible','semantics_missing','secret_format_unsupported')) OR
  (status='unavailable' AND reason IN ('request_invalid','secret_unavailable','decryption_unavailable','cancelled','deadline','resource_limit','cleanup_uncertain','unexpected'))) IS TRUE),
 CHECK(status IS NULL OR status='unavailable' OR (result IS NOT NULL AND child_id IS NOT NULL AND cleanup_confirmed)),
 CHECK(result IS NULL OR (backup_verification_keys(result,ARRAY['protocol','requestDigest','attemptToken','measuredArchive','targetDigest','policyDigest','modules','status','reason','activation'])
  AND result->>'protocol'=protocol AND result->>'requestDigest'=request_digest AND result->>'attemptToken'=child_token
  AND result->>'targetDigest'=target_digest AND result->>'policyDigest'=request#>>'{target,policyDigest}'
  AND result->>'activation'='not_attempted' AND result->>'status'=status AND result->>'reason'=reason
  AND jsonb_typeof(result->'modules')='array') IS TRUE)
);
CREATE INDEX backup_verification_attempts_point ON backup_verification_attempts(point_id,created_at);

-- A running row may acquire its final outcome once; its original binding never changes.
CREATE FUNCTION backup_verification_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='finished' OR
  (to_jsonb(OLD)-ARRAY['state','status','reason','result','child_id','cleanup_confirmed','finished_at','admitted_at']) IS DISTINCT FROM
  (to_jsonb(NEW)-ARRAY['state','status','reason','result','child_id','cleanup_confirmed','finished_at','admitted_at']) THEN
  RAISE EXCEPTION 'backup_verification_evidence_immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER backup_verification_attempt_immutable BEFORE UPDATE ON backup_verification_attempts
 FOR EACH ROW EXECUTE FUNCTION backup_verification_attempt_immutable();

ALTER TABLE backup_points ADD COLUMN current_evidence_id uuid;
ALTER TABLE backup_points ADD COLUMN last_attempt_id uuid;
ALTER TABLE backup_points ADD FOREIGN KEY(id,current_evidence_id) REFERENCES backup_verification_attempts(point_id,id);
ALTER TABLE backup_points ADD FOREIGN KEY(id,last_attempt_id) REFERENCES backup_verification_attempts(point_id,id);
ALTER TABLE backup_recovery_requests ADD COLUMN protocol_version integer;
ALTER TABLE backup_recovery_requests ADD COLUMN verification_target jsonb;
ALTER TABLE backup_recovery_requests ADD CHECK(
 (protocol_version IS NULL AND verification_target IS NULL)
 OR (protocol_version IS NOT NULL AND protocol_version=2 AND verification_target IS NOT NULL AND backup_verification_target_shape(verification_target)));
ALTER TABLE backup_recoveries ADD COLUMN verification_attempt_id uuid;
ALTER TABLE backup_recoveries ADD COLUMN verification_target jsonb;
ALTER TABLE backup_recoveries ADD FOREIGN KEY(point_id,verification_attempt_id) REFERENCES backup_verification_attempts(point_id,id);
ALTER TABLE backup_recoveries ADD CHECK(
 (verification_attempt_id IS NULL AND verification_target IS NULL)
 OR (verification_attempt_id IS NOT NULL AND verification_target IS NOT NULL AND source_kind='snapshot'
  AND point_id IS NOT NULL AND backup_verification_target_shape(verification_target)));

-- Success needs the complete declared owner coverage. This is structural evidence,
-- never a substitute for Waitron's own module checks or the trusted child receipt.
CREATE FUNCTION backup_verification_passed_modules(result jsonb, target jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m jsonb; expected jsonb; check_result jsonb; names text[]='{}'; codes text[];
BEGIN
 IF jsonb_typeof(result->'modules') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(result->'modules')<>jsonb_array_length(target->'modules') THEN RETURN false; END IF;
 FOR m IN SELECT * FROM jsonb_array_elements(result->'modules') LOOP
  SELECT value INTO expected FROM jsonb_array_elements(target->'modules') WHERE value->>'name'=m->>'name';
  IF NOT backup_verification_keys(m,ARRAY['name','semanticsVersion','status','checks']) OR expected IS NULL
   OR m->>'name'=ANY(names) OR m->'semanticsVersion' IS DISTINCT FROM expected->'semanticsVersion'
   OR m->>'status' IS DISTINCT FROM 'passed' OR jsonb_typeof(m->'checks') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(m->'checks') NOT BETWEEN 1 AND 16 THEN RETURN false; END IF;
  names=array_append(names,m->>'name'); codes='{}';
  FOR check_result IN SELECT * FROM jsonb_array_elements(m->'checks') LOOP
   IF NOT backup_verification_keys(check_result,ARRAY['code','status'])
    OR NOT COALESCE(check_result->>'code'=ANY(ARRAY['data','immutable','chain','head','history','source','secret','entries','effects','not_applicable']),false)
    OR check_result->>'code'=ANY(codes) OR check_result->>'status' IS DISTINCT FROM 'passed' THEN RETURN false; END IF;
   codes=array_append(codes,check_result->>'code');
  END LOOP;
 END LOOP;
 RETURN true;
END $$;

CREATE VIEW backup_point_qualification AS
 WITH evidence AS (
 SELECT p.id AS point_id,a.id AS attempt_id,a.status,a.reason,
  CASE WHEN last.state='finished' AND last.admitted_at IS NOT NULL THEN last.reason END AS last_reason,
  a.target_digest,
  COALESCE(a.state='finished' AND a.admitted_at IS NOT NULL AND a.cleanup_confirmed AND a.child_id IS NOT NULL
   AND a.point_metadata=jsonb_build_object('objectKey',p.object_key,'retention',p.retention,'venueId',p.venue_id,
    'installationId',p.installation_id,'keyVersion',p.key_version,'digest',p.digest,'size',p.size,
    'capturedAt',to_char(p.captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceNodeId',p.source_node_id,'modules',p.modules)
   AND c.venue_id=p.venue_id AND c.installation_id=p.installation_id AND c.key_version=p.key_version
   AND a.request->>'venueId'=p.venue_id::text AND a.request->>'sourceInstallationId'=p.installation_id::text
   AND a.request->>'sourceNodeId'=p.source_node_id::text
   AND a.request->>'capturedAt'=to_char(p.captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   AND a.request#>>'{archive,sha256}'=p.digest AND a.request#>'{archive,bytes}'=to_jsonb(p.size)
   AND a.request#>'{archive,modules}'=p.modules AND a.request#>'{backupKey,version}'=to_jsonb(p.key_version)
   AND a.request#>>'{backupKey,reference}'='cloud-backup:'||p.venue_id::text||':'||p.key_version::text
   AND a.request#>>'{archive,environment}'=CASE v.environment WHEN 'test' THEN 'preproduction' ELSE v.environment END
   AND a.request#>'{archive,manifestVersion}'='1'::jsonb
   AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL,false) AS bound,
  COALESCE(policy.release_ready AND policy.revision=a.policy_revision AND policy.verifier_image=a.verifier_image
   AND policy.target=a.request->'target' AND policy.target->>'digest'=a.target_digest,false) AS current_policy,
  a.id=p.last_attempt_id AS latest,a.result,a.request,a.request->'target' AS target
 FROM backup_points p
 JOIN backup_captures c ON c.id=p.id JOIN venues v ON v.id=p.venue_id
 LEFT JOIN backup_verification_attempts a ON a.point_id=p.id AND a.id=p.current_evidence_id
 LEFT JOIN backup_verification_attempts last ON last.point_id=p.id AND last.id=p.last_attempt_id
 LEFT JOIN backup_verification_policy policy ON policy.id=1
 ), verdicts AS (
 SELECT *,CASE WHEN bound AND status='invalid' THEN 'failed'
  WHEN bound AND current_policy AND latest AND status='passed'
   AND result->'measuredArchive'=jsonb_build_object('sha256',request#>>'{archive,sha256}','bytes',request#>'{archive,bytes}')
   AND backup_verification_passed_modules(result,target) THEN 'verified'
  ELSE 'pending' END AS verdict
 FROM evidence
 )
 SELECT point_id,verdict AS current_verification,
  CASE WHEN verdict='verified' THEN target_digest END AS qualified_target_digest,
  CASE WHEN verdict IN ('verified','failed') THEN attempt_id END AS verification_id,
  last_reason
 FROM verdicts;
