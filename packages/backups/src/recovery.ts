import { createHash, createPublicKey, verify } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { resolveSession } from "@waitron-cloud/identity";
import { transaction } from "@waitron-cloud/registration";
import { BackupKeyVault } from "./keys.ts";
import {
  backupFail,
  expireRecoveries,
  uniqueViolation,
  venuePoints,
  lockVenue,
  location,
  point,
  pointKeys,
  uuid,
} from "./catalogue.ts";
interface RecoveryBaseInput {
  id: string;
  mode: "planned" | "failure";
  targetPublicKey: string;
  oldServerUnavailable: boolean;
  acceptDataLoss: boolean;
}
export type RecoveryInput = RecoveryBaseInput & (
  | {source?:"snapshot";pointId:string;venueId?:never}
  | {source:"continuous";venueId:string;pointId?:never}
);
export type RecoveryApprovalInput=Pick<RecoveryBaseInput,"oldServerUnavailable"|"acceptDataLoss">&(
  | {source?:"snapshot";pointId:string;venueId?:never}
  | {source:"continuous";venueId:string;pointId?:never}
);
export interface SnapshotRecoverySource{kind:"snapshot";pointId:string}
export interface ContinuousRecoverySource{kind:"continuous";recoverableAt:string;sourceNodeId:string;sourceDigest:string}
export type RecoveryInfo=
 |{source:SnapshotRecoverySource;point:import("./catalogue.ts").BackupPoint;operationExpiresAt:string}
 |{source:ContinuousRecoverySource;operationExpiresAt:string};
export type RecoveryAccess=
 |{source:SnapshotRecoverySource;point:import("./catalogue.ts").BackupPoint;location:import("./storage.ts").StorageLocation;keys:import("./keys.ts").BackupKeys;operationExpiresAt:string}
 |{source:ContinuousRecoverySource;stream:{venueId:string;location:import("./storage.ts").StorageLocation;prefix:string;readerReference:string;pointerSignerPublicKey:string;recoveryKey:string;localVenueId:string;generation:string};operationExpiresAt:string};
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
  action: "info" | "read" | "restored",
  digest: string,
  key: string,
  proof: Proof,
) {
  try {
    const bytes = decode(proof.payload, 2048),
      v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (
      !Array.isArray(v) ||
      v.length !== 6 ||
      !Number.isSafeInteger(v[5]) ||
      Math.abs(Date.now() - v[5]) > 60000 ||
      !recoveryPayload(origin, id, action, digest, v[5]).equals(bytes) ||
      !verify(null, bytes, publicKey(key), decode(proof.signature, 86))
    )
      throw Error();
  } catch {
    backupFail("invalid_proof");
  }
}
async function permission(client: PoolClient, account: string, venue: string) {
  const allowed = await client.query(
    `SELECT m.account_id FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id JOIN cloud_accounts a ON a.id=m.account_id WHERE v.id=$1 AND m.account_id=$2 AND m.is_owner AND a.disabled_at IS NULL FOR SHARE OF m,a`,
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
async function operationCurrent(client:PoolClient,id:string):Promise<boolean>{
  return (await client.query("SELECT expires_at>clock_timestamp() AS valid FROM backup_recoveries WHERE id=$1",[id])).rows[0]?.valid === true;
}
interface StreamRow extends Record<string,unknown>{
 venue_id:string;installation_id:string;configuration_revision:number;key_version:number;local_venue_id:string;source_node_id:string;
 pointer_signer_public_key:string;object_prefix:string;reader_reference:string;generation:string|null;recoverable_at:Date|null;observed_at:Date|null;
 endpoint:string;bucket:string;region:string;current_revision:number;location_installation_id:string;revoked_at:Date|null;superseded_by:string|null;
}
async function currentStream(client:PoolClient,venueId:string,lock=false):Promise<StreamRow>{
 const row=(await client.query<StreamRow>(`SELECT s.*,l.endpoint,l.bucket,l.region,l.installation_id AS location_installation_id,
  i.configuration_revision AS current_revision,i.revoked_at,i.superseded_by
  FROM backup_managed_streams s JOIN backup_locations l ON l.venue_id=s.venue_id JOIN installations i ON i.id=s.installation_id
  WHERE s.venue_id=$1${lock?' FOR UPDATE OF s':''}`,[venueId])).rows[0];
 if(!row||row.revoked_at||row.superseded_by||row.location_installation_id!==row.installation_id||row.current_revision!==row.configuration_revision
  ||!row.generation||!row.recoverable_at||!row.observed_at||row.observed_at.getTime()<=Date.now()-300000)backupFail('unavailable');
 return row;
}
export function streamRecoveryDigest(generation:string){return createHash('sha256').update(`waitron-cloud-stream-generation-v1\0${generation}`).digest('hex');}
function source(row:Record<string,unknown>):SnapshotRecoverySource|Omit<ContinuousRecoverySource,"sourceDigest">{
 return row.source_kind==='continuous'
  ?{kind:'continuous' as const,recoverableAt:(row.stream_recoverable_at as Date).toISOString(),sourceNodeId:row.stream_source_node_id as string}
  :{kind:'snapshot' as const,pointId:row.point_id as string};
}
function continuousSource(row:Record<string,unknown>,digest:string):ContinuousRecoverySource{return {kind:'continuous',recoverableAt:(row.stream_recoverable_at as Date).toISOString(),sourceNodeId:row.stream_source_node_id as string,sourceDigest:digest};}
function snapshotSource(row:Record<string,unknown>):SnapshotRecoverySource{return {kind:'snapshot',pointId:row.point_id as string};}
function view(row: Record<string, unknown>) {
  return {
    id: row.id,
    venueId: row.venue_id,
    pointId: row.point_id,
    source:source(row),
    mode: row.mode,
    status: row.status,
    expiresAt: (row.expires_at as Date).toISOString(),
  };
}
/** Owner grants authorise data recovery; target reports never activate trading or change routing. */
export class BackupRecovery {
  readonly #pool: Pool;
  readonly #vault: BackupKeyVault;
  readonly #origin: string;
  readonly #client?: PoolClient;
  constructor(pool: Pool, vault: BackupKeyVault, origin: string, client?: PoolClient) {
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
      ||(continuous?!uuid(input.venueId):!uuid(input.pointId)))
      backupFail("invalid_input");
    publicKey(input.targetPublicKey);
    if (input.oldServerUnavailable !== true || input.acceptDataLoss !== true)
      backupFail("confirmation_required");
    return this.#transaction(async (client) => {
      const session = await resolveSession(client, token, {csrfToken,touch:false});
      let venueId:string,p:Awaited<ReturnType<typeof point>>|undefined,stream:StreamRow|undefined;
      if(continuous){venueId=input.venueId;await permission(client,session.accountId,venueId);await lockVenue(client,venueId);stream=await currentStream(client,venueId,true);}
      else{const first=await point(client,input.pointId);if(!first)backupFail('unavailable');venueId=first.venueId;await permission(client,session.accountId,venueId);await lockVenue(client,venueId);p=await point(client,input.pointId);if(!p||p.kind!=="snapshot"||p.deleting||p.deletedAt)backupFail("unavailable");if(p.verification!=="verified")backupFail("unverified");}
      await expireRecoveries(client,venueId);
      const prior = (
        await client.query("SELECT * FROM backup_recoveries WHERE id=$1", [
          input.id,
        ])
      ).rows[0];
      if (prior) {
        if (
          prior.source_kind !== (continuous?'continuous':'snapshot') ||
          prior.point_id !== (continuous?null:input.pointId) ||
          prior.venue_id !== venueId ||
          (continuous&&(prior.stream_configuration_revision!==stream!.configuration_revision||prior.stream_generation!==stream!.generation||prior.stream_recoverable_at.getTime()!==stream!.recoverable_at!.getTime()||prior.stream_source_node_id!==stream!.source_node_id))||
          prior.account_id !== session.accountId ||
          prior.target_public_key !== input.targetPublicKey ||
          prior.mode !== input.mode
        )
          backupFail("conflict");
        await resolveSession(client, token, { csrfToken, touch: false });
        return view(prior);
      }
      if (
        (
          await client.query(
            "SELECT 1 FROM backup_recoveries WHERE venue_id=$1 AND status<>'closed'",
            [venueId],
          )
        ).rowCount
      )
        backupFail("recovery_active");
      if (
        (
          await client.query(
            "SELECT 1 FROM installations WHERE public_key=$1 UNION ALL SELECT 1 FROM backup_recoveries WHERE target_public_key=$1",
            [input.targetPublicKey],
          )
        ).rowCount
      )
        backupFail("target_not_fresh");
      await resolveSession(client, token, { csrfToken });
      const row = (
        await client.query(
          `INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode,source_kind,
            stream_configuration_revision,stream_generation,stream_recoverable_at,stream_source_node_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            input.id,
            venueId,
            continuous?null:p!.id,
            session.accountId,
            input.targetPublicKey,
            input.mode,
            continuous?'continuous':'snapshot',
            continuous?stream!.configuration_revision:null,
            continuous?stream!.generation:null,
            continuous?stream!.recoverable_at:null,
            continuous?stream!.source_node_id:null,
          ],
        )
      ).rows[0];
      await resolveSession(client, token, { csrfToken, touch: false });
      return view(row);
    }).catch((error) => {
      if (uniqueViolation(error, "backup_recoveries_target_public_key_key"))
        backupFail("target_not_fresh");
      throw error;
    });
  }
  async authenticate(id:string,action:"info"|"read"|"restored",proof:Proof){
    if(!uuid(id)||!["info","read","restored"].includes(action))backupFail("invalid_proof");
    return this.#transaction(async client=>{
      const row=await operation(client,id),p=row.source_kind==='snapshot'?await point(client,row.point_id):undefined;
      if(row.source_kind==='snapshot'&&!p)backupFail("unavailable");
      const digest=row.source_kind==='continuous'?streamRecoveryDigest(row.stream_generation):p!.digest;
      validateProof(this.#origin,id,action,action==="info"?"":digest,row.target_public_key,proof);
      return {publicKey:row.target_public_key as string};
    });
  }
  async target(id:string,action:"info",proof:Proof):Promise<RecoveryInfo>;
  async target(id:string,action:"read"|"restored",proof:Proof):Promise<RecoveryAccess>;
  async target(id: string, action: "info" | "read" | "restored", proof: Proof):Promise<RecoveryInfo|RecoveryAccess> {
    if (!uuid(id) || !["info", "read", "restored"].includes(action))
      backupFail("invalid_proof");
    return this.#transaction(async (client) => {
      const first = await operation(client, id);
      await permission(client, first.account_id, first.venue_id);
      const l = await lockVenue(client, first.venue_id),row = await operation(client,id),continuous=row.source_kind==='continuous',p=continuous?undefined:await point(client,row.point_id),stream=continuous?await currentStream(client,row.venue_id,true):undefined;
      if (
        row.status === "closed" ||
        !(await operationCurrent(client,id)) ||
        (!continuous&&(!p||p.kind!=="snapshot"||p.deleting||p.deletedAt))||
        (continuous&&(stream!.configuration_revision!==row.stream_configuration_revision||stream!.generation!==row.stream_generation||stream!.recoverable_at!.getTime()!==row.stream_recoverable_at.getTime()||stream!.source_node_id!==row.stream_source_node_id))
      )
        backupFail("unavailable");
      const digest=continuous?streamRecoveryDigest(row.stream_generation):p!.digest;
      validateProof(
        this.#origin,
        id,
        action,
        action === "info" ? "" : digest,
        row.target_public_key,
        proof,
      );
      if (!continuous&&p!.verification !== "verified") backupFail("unverified");
      if (action === "info") return continuous
       ?{source:continuousSource(row,digest),operationExpiresAt:row.expires_at.toISOString() as string}
       :{source:snapshotSource(row),point:p!,operationExpiresAt:row.expires_at.toISOString() as string};
      if (action === "restored")
        await client.query(
          "UPDATE backup_recoveries SET status='restored' WHERE id=$1",
          [id],
        );
      const keys = await pointKeys(client,this.#vault,row.venue_id,continuous?stream!.key_version:p!.keyVersion);
      if (!(await operationCurrent(client,id))) backupFail("unavailable");
      validateProof(
        this.#origin,
        id,
        action,
        digest,
        row.target_public_key,
        proof,
      );
      const operationExpiresAt=row.expires_at.toISOString() as string;
      if(continuous)return {source:continuousSource(row,digest),stream:{venueId:row.venue_id,location:location(l),prefix:stream!.object_prefix,readerReference:stream!.reader_reference,pointerSignerPublicKey:stream!.pointer_signer_public_key,recoveryKey:keys.recoveryKey,localVenueId:stream!.local_venue_id,generation:stream!.generation!},operationExpiresAt};
      return {source:snapshotSource(row),point:p!,location:location(l),keys,operationExpiresAt};
    });
  }
  async catalogue(token: string, venueId: string) {
    if (!uuid(venueId)) backupFail("unavailable");
    return this.#transaction(async (client) => {
      const session = await resolveSession(client, token, { touch: false });
      await permission(client, session.accountId, venueId);
      await lockVenue(client, venueId);
      const points = await venuePoints(client, venueId),stream=await currentStream(client,venueId).catch(()=>undefined);
      await resolveSession(client, token, { touch: false });
      return {
        points,
        defaultPointId:
          points.find(
            (p) => p.kind === "snapshot" && p.verification === "verified",
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
      await permission(client, session.accountId, row.venue_id);
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
      await permission(client, session.accountId, first.venue_id);
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
