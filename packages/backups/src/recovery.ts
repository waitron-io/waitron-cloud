import {organisationScopeSql} from '@waitron-cloud/identity';
export {readRecoveryMachineEnvelope,type RecoveryAction} from './recovery-v2.ts';
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { resolveSession } from "@waitron-cloud/identity";
import { type PlanMode, transaction, requireConnectionProof, requirePendingConnectionProof } from "@waitron-cloud/registration";
import { BackupKeyVault } from "./keys.ts";
import {
  backupPlan,
  checkedRecoveryPoints,
  type BackupPoint,
  backupFail,
  expireRecoveries,
  uniqueViolation,
  venuePoints,
  lockVenue,
  location,
  point,
  pointMetadata,
  pointKeys,
  uuid,
} from "./catalogue.ts";
import {lockVerificationPolicy} from './verification-admission.ts';
import {recoveryNegotiation,recoveryPayloadV2,snapshotRecoveryTarget,type RecoveryAction,type RecoveryMachineEnvelope,type RecoverySelectionAction,type SnapshotRecoveryVerification} from './recovery-v2.ts';
interface RecoveryBaseInput {
  id: string;
  mode: "planned" | "failure";
  targetPublicKey: string;
  oldServerUnavailable: boolean;
  acceptDataLoss: boolean;
}
export type RecoveryInput = RecoveryBaseInput & (
  | {source?:"snapshot";pointId:string;venueId?:never}
  | {source:"snapshot"|"continuous";venueId:string;pointId?:never}
);
export type RecoveryApprovalInput=Pick<RecoveryBaseInput,"oldServerUnavailable"|"acceptDataLoss">&(
  | {source?:"snapshot";pointId:string;venueId?:never}
  | {source:"snapshot"|"continuous";venueId:string;pointId?:never}
);
export interface SnapshotRecoverySource{kind:"snapshot";pointId:string}
export interface ContinuousRecoverySource{kind:"continuous";recoverableAt:string;sourceNodeId:string;sourceDigest:string}
type V2Response={version?:2;verification?:SnapshotRecoveryVerification};
export type RecoveryInfo=V2Response&(
 |{source:SnapshotRecoverySource;point:import("./catalogue.ts").BackupPoint;operationExpiresAt:string}
 |{source:ContinuousRecoverySource;operationExpiresAt:string});
export type RecoveryAccess=V2Response&(
 |{source:SnapshotRecoverySource;point:import("./catalogue.ts").BackupPoint;location:import("./storage.ts").StorageLocation;keys:import("./keys.ts").BackupKeys;operationExpiresAt:string}
 |{source:ContinuousRecoverySource;stream:{venueId:string;location:import("./storage.ts").StorageLocation;prefix:string;readerReference:string;pointerSignerPublicKey:string;recoveryKey:string;streamId:string;generation:string};operationExpiresAt:string});
export interface RecoveryView {
  id:string;venueId:string;pointId:string|null;source:{kind:"snapshot";pointId:string|null}|Omit<ContinuousRecoverySource,"sourceDigest">;
  mode:"planned"|"failure";status:string;expiresAt:string;
}
export class RecoveryActiveError extends Error {
  readonly recoveryExpiresAt: string;
  constructor(recoveryExpiresAt: string) {
    super("backup.recovery_active");
    this.recoveryExpiresAt = recoveryExpiresAt;
  }
}
export interface Proof {
  payload: string;
  signature: string;
}
export function recoveryPayload(
  origin: string,
  id: string,
  action: "info" | "read" | "restored",
  digest: string,
  issuedAt: number,
) {
  return Buffer.from(
    JSON.stringify([
      "waitron-cloud-recovery-v1",
      origin,
      id,
      action,
      digest,
      issuedAt,
    ]),
  );
}
export function decode(value: string, max: number) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    backupFail("invalid_proof");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) backupFail("invalid_proof");
  return bytes;
}
export function publicKey(value: string) {
  try {
    const bytes = decode(value, 128),
      key = createPublicKey({ key: bytes, type: "spki", format: "der" });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !key.export({ type: "spki", format: "der" }).equals(bytes)
    )
      throw Error();
    return key;
  } catch {
    return backupFail("invalid_proof");
  }
}
function validateProof(
  origin: string,
  id: string,
  action: RecoveryAction,
  value: string|undefined,
  key: string,
  proof: RecoveryMachineEnvelope,
  target:unknown=null,
) {
  try {
    const negotiation=recoveryNegotiation(proof),persisted=target===null?null:snapshotRecoveryTarget(target);
    if((persisted!==null)!==(negotiation.version===2)||(persisted&&persisted.digest!==negotiation.target!.digest))throw Error();
    const bytes=decode(proof.payload,2048),v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),time=persisted?6:5;
    if(!Array.isArray(v)||v.length!==(persisted?7:6)||!Number.isSafeInteger(v[time])||Math.abs(Date.now()-v[time])>60000)throw Error();
    const signedValue=action==='select'?v[4]:value;
    if(action==='select'&&!uuid(signedValue))throw Error();
    const expected=persisted?recoveryPayloadV2(origin,id,action,signedValue,persisted.digest,v[time]):recoveryPayload(origin,id,action as 'info'|'read'|'restored',signedValue,v[time]);
    if(!expected.equals(bytes)||!verify(null,bytes,publicKey(key),decode(proof.signature,86)))throw Error();
    return signedValue as string;
  } catch {backupFail('invalid_proof');}
}
async function permission(client: PoolClient, account: string, venue: string, sessionAuthority=false) {
  const allowed = await client.query(
    `SELECT m.account_id FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id JOIN cloud_accounts a ON a.id=m.account_id WHERE v.id=$1 AND m.account_id=$2 AND m.is_owner AND a.disabled_at IS NULL AND ${sessionAuthority?organisationScopeSql('m.account_id','m.organisation_id'):'true'} FOR SHARE OF m,a`,
    [venue, account],
  );
  if (!allowed.rowCount) backupFail("permission_denied");
}
async function operation(client: PoolClient, id: string) {
  const row = (
    await client.query("SELECT * FROM backup_recoveries WHERE id=$1", [id])
  ).rows[0];
  if (!row) backupFail("unavailable");
  return row;
}
async function requestCurrent(client:PoolClient,id:string):Promise<boolean>{
  return (await client.query('SELECT expires_at>clock_timestamp() AND failed_codes<5 AS valid FROM backup_recovery_requests WHERE id=$1',[id])).rows[0]?.valid===true;
}
async function operationCurrent(client:PoolClient,id:string):Promise<boolean>{
  return (await client.query("SELECT expires_at>clock_timestamp() AS valid FROM backup_recoveries WHERE id=$1",[id])).rows[0]?.valid === true;
}
interface StreamRow extends Record<string,unknown>{
 venue_id:string;installation_id:string;configuration_revision:number;key_version:number;source_node_id:string;
 pointer_signer_public_key:string;object_prefix:string;reader_reference:string;generation:string|null;recoverable_at:Date|null;observed_at:Date|null;
 endpoint:string;bucket:string;region:string;current_revision:number;location_installation_id:string;revoked_at:Date|null;superseded_by:string|null;
}
async function currentStream(client:PoolClient,venueId:string,lock=false,requireFresh=true):Promise<StreamRow>{
 const row=(await client.query<StreamRow>(`SELECT s.*,l.endpoint,l.bucket,l.region,l.installation_id AS location_installation_id,
  i.configuration_revision AS current_revision,i.revoked_at,i.superseded_by
  FROM backup_managed_streams s JOIN backup_locations l ON l.venue_id=s.venue_id JOIN installations i ON i.id=s.installation_id
  WHERE s.venue_id=$1${lock?' FOR UPDATE OF s':''}`,[venueId])).rows[0];
 if(!row||row.revoked_at||row.superseded_by||row.location_installation_id!==row.installation_id||row.current_revision!==row.configuration_revision
  ||!row.generation||!row.recoverable_at||!row.observed_at||(requireFresh&&row.observed_at.getTime()<=Date.now()-300000))backupFail('unavailable');
 return row;
}
export function streamRecoveryDigest(generation:string){return createHash('sha256').update(`waitron-cloud-stream-generation-v1\0${generation}`).digest('hex');}
function source(row:Record<string,unknown>):RecoveryView["source"]{
 return row.source_kind==='continuous'
  ?{kind:'continuous' as const,recoverableAt:(row.stream_recoverable_at as Date).toISOString(),sourceNodeId:row.stream_source_node_id as string}
  :{kind:'snapshot' as const,pointId:row.point_id as string|null};
}
function continuousSource(row:Record<string,unknown>,digest:string):ContinuousRecoverySource{return {kind:'continuous',recoverableAt:(row.stream_recoverable_at as Date).toISOString(),sourceNodeId:row.stream_source_node_id as string,sourceDigest:digest};}
function snapshotSource(row:Record<string,unknown>):SnapshotRecoverySource{return {kind:'snapshot',pointId:row.point_id as string};}
function view(row: Record<string, unknown>):RecoveryView {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    pointId: row.point_id as string|null,
    source:source(row),
    mode: row.mode as RecoveryView['mode'],
    status: row.status as string,
    expiresAt: (row.expires_at as Date).toISOString(),
  };
}
export async function snapshotBinding(client:PoolClient,row:Record<string,unknown>,refusal='unverified'):Promise<V2Response>{
 if(row.source_kind==='continuous')return {};
 if(!row.verification_attempt_id||!row.verification_target)backupFail(refusal);
 const target=snapshotRecoveryTarget(row.verification_target),attempt=(await client.query(`SELECT a.request,a.request_digest,q.verification_id,q.current_verification,q.qualified_target_digest
  FROM backup_point_qualification q JOIN backup_verification_attempts a ON a.id=q.verification_id
  WHERE q.point_id=$1`,[row.point_id])).rows[0];
 if(!attempt||attempt.current_verification!=='verified'||attempt.verification_id!==row.verification_attempt_id||attempt.qualified_target_digest!==target.digest||attempt.request.target.digest!==target.digest)backupFail(refusal);
 return {version:2,verification:{protocol:'backup-data-restore/v1',target,policyDigest:target.policyDigest,requestDigest:attempt.request_digest,archiveSha256:attempt.request.archive.sha256,archiveBytes:attempt.request.archive.bytes,pointId:row.point_id as string}};
}
/** Owner grants authorise data recovery; target reports never activate trading or change routing. */
export class BackupRecovery {
  readonly #planMode: PlanMode;
  readonly #pool: Pool;
  readonly #vault: BackupKeyVault;
  readonly #origin: string;
  readonly #client?: PoolClient;
  constructor(pool: Pool, vault: BackupKeyVault, origin: string, client?: PoolClient, planMode: PlanMode = 'existing') {
    this.#planMode = planMode;
    this.#pool = pool;
    this.#vault = vault;
    this.#origin = origin;
    this.#client = client;
  }
  #transaction<T>(action:(client:PoolClient)=>Promise<T>):Promise<T>{
    return this.#client ? action(this.#client) : transaction(this.#pool,action);
  }
  async start(token: string, csrfToken: string, input: RecoveryInput) {
    const continuous=input.source==='continuous';
    if (!uuid(input.id)||!["planned", "failure"].includes(input.mode)
      ||(input.pointId===undefined?(input.source===undefined||!uuid(input.venueId)):!uuid(input.pointId)))
      backupFail("invalid_input");
    const venueOnly=input.source==='snapshot'&&input.pointId===undefined;
    publicKey(input.targetPublicKey);
    if (input.oldServerUnavailable !== true || input.acceptDataLoss !== true)
      backupFail("confirmation_required");
    return this.#transaction(async (client) => {
      const request=(await client.query('SELECT * FROM backup_recovery_requests WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
      const session = await requireConnectionProof(client,token,csrfToken);
      let venueId:string,p:Awaited<ReturnType<typeof point>>|undefined,stream:StreamRow|undefined;
      if(input.pointId===undefined)venueId=input.venueId;
      else {
        const first=await point(client,input.pointId);
        if(!first)backupFail('unavailable');
        venueId=first.venueId;
      }
      await permission(client,session.accountId,venueId,true);
      await backupPlan(client,venueId,this.#planMode);
      if(!continuous)await lockVerificationPolicy(client);
      await lockVenue(client,venueId);
      if(continuous)stream=await currentStream(client,venueId,true);
      if(input.pointId!==undefined){
        p=await point(client,input.pointId);
        if(!p||p.kind!=='snapshot'||p.deleting||p.deletedAt)backupFail('unavailable');
        if(p.verification!=='verified')backupFail('unverified');
      }
      await expireRecoveries(client,venueId);
      const prior = (
        await client.query("SELECT * FROM backup_recoveries WHERE id=$1", [
          input.id,
        ])
      ).rows[0];
      if (prior) {
        if (
          prior.source_kind !== (continuous?'continuous':'snapshot') ||
          (!venueOnly && prior.point_id !== (input.pointId??null)) ||
          prior.venue_id !== venueId ||
          (continuous&&(prior.stream_configuration_revision!==stream!.configuration_revision||prior.stream_generation!==stream!.generation||prior.stream_recoverable_at.getTime()!==stream!.recoverable_at!.getTime()||prior.stream_source_node_id!==stream!.source_node_id))||
          prior.account_id !== session.accountId ||
          prior.target_public_key !== input.targetPublicKey ||
          prior.mode !== input.mode
        )
          backupFail("conflict");
        if(!continuous){
          if(request?.protocol_version!==2||request.public_key!==input.targetPublicKey)backupFail('conflict');
          if(prior.point_id!==null){
            if(request.verification_target?.digest!==prior.verification_target?.digest)backupFail('conflict');
            await snapshotBinding(client,prior,'conflict');
          }
        }
        if(continuous&&request?.protocol_version===2)backupFail('unverified');
        await requirePendingConnectionProof(client,session.accountId,session.sessionId,session.securityRevision);
        await client.query('UPDATE backup_recoveries SET cloud_session_id=$2,cloud_security_revision=$3 WHERE id=$1',[input.id,session.sessionId,session.securityRevision]);
        return view(prior);
      }
      const active = (
        await client.query<{ expires_at: Date }>(
          "SELECT expires_at FROM backup_recoveries WHERE venue_id=$1 AND status<>'closed'",
          [venueId],
        )
      ).rows[0];
      if (active) throw new RecoveryActiveError(active.expires_at.toISOString());
      if (
        (
          await client.query(
            "SELECT 1 FROM installations WHERE public_key=$1 UNION ALL SELECT 1 FROM backup_recoveries WHERE target_public_key=$1",
            [input.targetPublicKey],
          )
        ).rowCount
      )
        backupFail("target_not_fresh");
      let verificationId:string|null=null,verificationTarget:unknown=null;
      if(!continuous){
        if(request?.protocol_version!==2||request.public_key!==input.targetPublicKey||(request.account_id&&request.account_id!==session.accountId))backupFail('unverified');
        if(!request.operation_id&&!await requestCurrent(client,input.id))backupFail('unavailable');
        if(p){
          const target=snapshotRecoveryTarget(request.verification_target);
          const [checked]=await checkedRecoveryPoints(client,venueId,target.digest,p.id);
          if(!checked)backupFail('unverified');
          verificationId=checked.attemptId;
          verificationTarget=target;
        }
      }else if(request?.protocol_version===2)backupFail('unverified');
      await requirePendingConnectionProof(client,session.accountId,session.sessionId,session.securityRevision);
      const row = (
        await client.query(
          `INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,source_kind,
            stream_configuration_revision,stream_generation,stream_recoverable_at,stream_source_node_id,verification_attempt_id,verification_target,cloud_session_id,cloud_security_revision,selection_open)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
          [
            input.id,
            venueId,
            p?.id??null,
            session.accountId,
            input.targetPublicKey,
            input.mode,
            continuous?'continuous':'snapshot',
            continuous?stream!.configuration_revision:null,
            continuous?stream!.generation:null,
            continuous?stream!.recoverable_at:null,
            continuous?stream!.source_node_id:null,
            verificationId,verificationTarget,session.sessionId,session.securityRevision,continuous?null:true,
          ],
        )
      ).rows[0];
      if(!continuous){if(p)await snapshotBinding(client,row);if(!request.operation_id&&!await requestCurrent(client,input.id))backupFail('unavailable');}
      await requirePendingConnectionProof(client,session.accountId,session.sessionId,session.securityRevision);
      return view(row);
    }).catch((error) => {
      if (uniqueViolation(error, "backup_recoveries_target_public_key_key"))
        backupFail("target_not_fresh");
      throw error;
    });
  }
  async #requestProof(client:PoolClient,id:string,action:RecoveryAction,proof:RecoveryMachineEnvelope,lock=false){
    const request=(await client.query(
      `SELECT public_key,operation_id,verification_target FROM backup_recovery_requests WHERE id=$1${lock?' FOR UPDATE':''}`,[id],
    )).rows[0];
    if(!request)backupFail('unavailable');
    if(!request.verification_target)backupFail('invalid_proof');
    const value=validateProof(this.#origin,id,action,'',request.public_key,proof,request.verification_target);
    return {request,value};
  }

  async #approvedChoice(client:PoolClient,id:string,action:RecoverySelectionAction,proof:RecoveryMachineEnvelope){
    // Approval takes the request lock before account, membership, plan, policy and venue locks.
    const {request,value}=await this.#requestProof(client,id,action,proof,true);
    if(!request.operation_id){
      if(!await requestCurrent(client,id))backupFail('unavailable');
      backupFail('approval_required');
    }
    const first=await operation(client,id);
    if(first.source_kind!=='snapshot'||first.status==='closed'||!await operationCurrent(client,id))backupFail('unavailable');
    if(action==='select')await client.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[first.account_id]);
    await permission(client,first.account_id,first.venue_id);
    if(action==='select')await requirePendingConnectionProof(client,first.account_id,first.cloud_session_id??null,first.cloud_security_revision??null);
    await backupPlan(client,first.venue_id,this.#planMode);
    await lockVerificationPolicy(client);
    await lockVenue(client,first.venue_id);
    const row=await operation(client,id),target=snapshotRecoveryTarget(request.verification_target);
    const check=async()=>{
      if(!await operationCurrent(client,id))backupFail('unavailable');
      validateProof(this.#origin,id,action,value,request.public_key,proof,target);
    };
    if(row.status==='closed')backupFail('unavailable');
    return {row,target,value,check};
  }

  async #pointList(client:PoolClient,venueId:string,operationExpiresAt:string,digest:string) {
    const reply={version:2 as const,venueId,operationExpiresAt,points:[] as BackupPoint[]};
    const choices=await checkedRecoveryPoints(client,venueId,digest);
    let bytes=Buffer.byteLength(JSON.stringify(reply));
    for(const {point} of choices){
      bytes+=Buffer.byteLength(JSON.stringify(point))+(reply.points.length?1:0);
      if(bytes>65536)break;
      reply.points.push(point);
    }
    return {reply,choices:choices.slice(0,reply.points.length)};
  }

  async points(id:string,proof:RecoveryMachineEnvelope){
    if(!uuid(id))backupFail('invalid_proof');
    return this.#transaction(async client=>{
      const {row,target,check}=await this.#approvedChoice(client,id,'points',proof);
      const {reply}=await this.#pointList(client,row.venue_id,row.expires_at.toISOString(),target.digest);
      await check();
      return reply;
    });
  }

  async select(id:string,proof:RecoveryMachineEnvelope){
    if(!uuid(id))backupFail('invalid_proof');
    return this.#transaction(async client=>{
      const {row,target,value,check}=await this.#approvedChoice(client,id,'select',proof);
      const sameChoice=row.point_id===value;
      if(row.selection_open!==true&&!sameChoice)backupFail('conflict');
      const operationExpiresAt=row.expires_at.toISOString() as string;
      const checked=sameChoice
        ?(await checkedRecoveryPoints(client,row.venue_id,target.digest,value))[0]
        :(await this.#pointList(client,row.venue_id,operationExpiresAt,target.digest)).choices.find(choice=>choice.point.id===value);
      if(!checked)backupFail('invalid_input');
      if(!sameChoice){
        await client.query('UPDATE backup_recoveries SET point_id=$2,verification_attempt_id=$3,verification_target=$4 WHERE id=$1',[id,value,checked.attemptId,target]);
        Object.assign(row,{point_id:value,verification_attempt_id:checked.attemptId,verification_target:target});
      }
      const binding=await snapshotBinding(client,row,'invalid_input');
      await requirePendingConnectionProof(client,row.account_id,row.cloud_session_id??null,row.cloud_security_revision??null);
      await check();
      return {...binding,source:snapshotSource(row),point:checked.point,operationExpiresAt};
    });
  }

  async authenticate(id:string,action:RecoveryAction,proof:RecoveryMachineEnvelope){
    if(!uuid(id)||!["info","read","restored","points","select"].includes(action))backupFail("invalid_proof");
    return this.#transaction(async client=>{
      if(action==='points'||action==='select') {
        const {request}=await this.#requestProof(client,id,action,proof);
        return {publicKey:request.public_key as string};
      }
      const row=await operation(client,id);
      if(row.source_kind==='snapshot'&&row.point_id===null){
        if(action==='restored')backupFail('invalid_proof');
        await this.#requestProof(client,id,action,proof);
        return {publicKey:row.target_public_key as string};
      }
      const p=row.source_kind==='snapshot'?await pointMetadata(client,row.point_id):undefined;
      if(row.source_kind==='snapshot'&&!p)backupFail("unavailable");
      const digest=row.source_kind==='continuous'?streamRecoveryDigest(row.stream_generation):p!.digest;
      validateProof(this.#origin,id,action,action==="info"?"":digest,row.target_public_key,proof,row.verification_target);
      return {publicKey:row.target_public_key as string};
    });
  }
  async target(id:string,action:"info",proof:RecoveryMachineEnvelope):Promise<RecoveryInfo>;
  async target(id:string,action:"read"|"restored",proof:RecoveryMachineEnvelope):Promise<RecoveryAccess>;
  async target(id: string, action: "info" | "read" | "restored", proof: RecoveryMachineEnvelope):Promise<RecoveryInfo|RecoveryAccess> {
    if (!uuid(id) || !["info", "read", "restored"].includes(action))
      backupFail("invalid_proof");
    return this.#transaction(async (client) => {
      const first = await operation(client, id);
      if(first.source_kind==='snapshot'&&first.point_id===null){
        if(action==='restored')backupFail('invalid_proof');
        await this.#requestProof(client,id,action,proof);
      }else if(this.#planMode!=='existing') {
        const firstPoint=first.source_kind==='snapshot'?await pointMetadata(client,first.point_id):undefined;
        validateProof(this.#origin,id,action,action==='info'?'':first.source_kind==='continuous'?streamRecoveryDigest(first.stream_generation):firstPoint?.digest??'',first.target_public_key,proof,first.verification_target);
      }
      // Take the account before membership reads so the saved-session check never upgrades its shared lock.
      if(action!=='info')await client.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[first.account_id]);
      await permission(client, first.account_id, first.venue_id);
      if(action!=='info')await requirePendingConnectionProof(client,first.account_id,first.cloud_session_id??null,first.cloud_security_revision??null);
      await backupPlan(client,first.venue_id,this.#planMode);
      if(first.source_kind==='snapshot')await lockVerificationPolicy(client);
      // Approval outlives observation freshness; the comparison below still binds delivery to the exact frozen generation.
      const l = await lockVenue(client, first.venue_id),row = await operation(client,id),continuous=row.source_kind==='continuous',p=continuous||row.point_id===null?undefined:await pointMetadata(client,row.point_id),stream=continuous?await currentStream(client,row.venue_id,true,false):undefined;
      if (
        row.status === "closed" ||
        !(await operationCurrent(client,id)) ||
        (!continuous&&row.point_id!==null&&(!p||p.kind!=="snapshot"||p.deleting||p.deletedAt))||
        (continuous&&(stream!.configuration_revision!==row.stream_configuration_revision||stream!.generation!==row.stream_generation||stream!.recoverable_at!.getTime()!==row.stream_recoverable_at.getTime()||stream!.source_node_id!==row.stream_source_node_id))
      )
        backupFail("unavailable");
      if(!continuous&&row.point_id===null){
        await this.#requestProof(client,id,action,proof);
        backupFail('selection_required');
      }
      const digest=continuous?streamRecoveryDigest(row.stream_generation):p!.digest;
      validateProof(
        this.#origin,
        id,
        action,
        action === "info" ? "" : digest,
        row.target_public_key,
        proof,
        row.verification_target,
      );
      const binding=await snapshotBinding(client,row);
      if (action === "info") {
        if(!await operationCurrent(client,id))backupFail('unavailable');
        validateProof(this.#origin,id,action,'',row.target_public_key,proof,row.verification_target);
        return continuous
         ?{source:continuousSource(row,digest),operationExpiresAt:row.expires_at.toISOString() as string}
         :{...binding,source:snapshotSource(row),point:{...p!,verification:"verified" as const},operationExpiresAt:row.expires_at.toISOString() as string};
      }
      if (action === "restored")
        await client.query(
          "UPDATE backup_recoveries SET status='restored',restored_at=COALESCE(restored_at,clock_timestamp()) WHERE id=$1",
          [id],
        );
      const keys = await pointKeys(client,this.#vault,row.venue_id,continuous?stream!.key_version:p!.keyVersion);
      if(!continuous)await snapshotBinding(client,row);
      if (!(await operationCurrent(client,id))) backupFail("unavailable");
      validateProof(
        this.#origin,
        id,
        action,
        digest,
        row.target_public_key,
        proof,
        row.verification_target,
      );
      await requirePendingConnectionProof(client,row.account_id,row.cloud_session_id??null,row.cloud_security_revision??null);
      // Fix the selection under the venue lock before a caller can issue storage credentials.
      if(row.selection_open===true)await client.query('UPDATE backup_recoveries SET selection_open=false WHERE id=$1',[id]);
      const operationExpiresAt=row.expires_at.toISOString() as string;
      if(continuous)return {source:continuousSource(row,digest),stream:{venueId:row.venue_id,location:location(l),prefix:stream!.object_prefix,readerReference:stream!.reader_reference,pointerSignerPublicKey:stream!.pointer_signer_public_key,recoveryKey:keys.recoveryKey,streamId:stream!.venue_id,generation:stream!.generation!},operationExpiresAt};
      return {...binding,source:snapshotSource(row),point:{...p!,verification:"verified" as const},location:location(l),keys,operationExpiresAt};
    });
  }
  async catalogue(token: string, venueId: string) {
    if (!uuid(venueId)) backupFail("unavailable");
    return this.#transaction(async (client) => {
      const session = await resolveSession(client, token, { touch: false });
      await permission(client, session.accountId, venueId,true);
      await lockVerificationPolicy(client);
      await lockVenue(client, venueId);
      const points = await venuePoints(client, venueId),stream=await currentStream(client,venueId).catch(()=>undefined);
      const qualified=new Set((await client.query("SELECT q.point_id FROM backup_point_qualification q JOIN backup_points p ON p.id=q.point_id WHERE p.venue_id=$1 AND q.current_verification='verified'",[venueId])).rows.map(r=>r.point_id));
      await resolveSession(client, token, { touch: false });
      return {
        points,
        defaultPointId:
          points.find(
            (p) => p.kind === "snapshot" && qualified.has(p.id),
          )?.id ?? null,
        continuousRecovery:stream?{recoverableAt:stream.recoverable_at!.toISOString(),checkedAt:stream.observed_at!.toISOString(),sourceNodeId:stream.source_node_id}:null,
      };
    });
  }
  async status(token: string, id: string) {
    if (!uuid(id)) backupFail("unavailable");
    return this.#transaction(async (client) => {
      const session = await resolveSession(client, token, { touch: false }),
        row = await operation(client, id);
      await permission(client, session.accountId, row.venue_id,true);
      await resolveSession(client, token, { touch: false });
      return view(row);
    });
  }
  async close(token: string, csrfToken: string, id: string) {
    if (!uuid(id)) backupFail("unavailable");
    return this.#transaction(async (client) => {
      const session = await resolveSession(client, token, {
          csrfToken,
          touch: false,
        }),
        first = await operation(client, id);
      await permission(client, session.accountId, first.venue_id,true);
      await lockVenue(client, first.venue_id);
      await resolveSession(client, token, { csrfToken });
      await client.query(
        "UPDATE backup_recoveries SET status='closed' WHERE id=$1",
        [id],
      );
      await resolveSession(client, token, { csrfToken, touch: false });
    });
  }
}
