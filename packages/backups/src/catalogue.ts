import {retentionExpirySql} from './retention.ts';
import type { Pool, PoolClient } from "pg";
import { readVenuePlan, type PlanMode, transaction } from "@waitron-cloud/registration";
import { BackupKeyVault, type BackupKeys } from "./keys.ts";
import {
  validateLocation,
  type ObjectReceipt,
  type StorageLocation,
} from "./storage.ts";
import { bufferObject, type ReplayableObject, type StageOptions } from "./object-transfer.ts";
import { isBackupCancellation } from "./cancellation.ts";
import {prepareVerification,admitVerification,recordVerificationUnavailable,lockVerificationPolicy,type VerificationClaim} from './verification-admission.ts';
import type {DataRestoreVerifier,VerifiedChildOutput} from './container-verifier.ts';
import type {BackupVerificationReason} from './verification-protocol.ts';
export type MutationFence = (client:PoolClient)=>Promise<void>;
interface StreamingObjectStore {
  stage(
    key: string,
    streamKey?: string,
    options?: StageOptions,
  ): Promise<ReplayableObject>;
  putStaged(key: string, source: ReplayableObject): Promise<ObjectReceipt>;
}
interface BufferedObjectStore {
  read(key: string): Promise<Buffer>;
  put(key: string, bytes: Uint8Array): Promise<ObjectReceipt>;
}
export type ObjectStore = (StreamingObjectStore | BufferedObjectStore) & {
  remove(key: string): Promise<void>;
};
export type ObjectFactory = (location: StorageLocation) => ObjectStore;
async function staged(objects:ObjectStore,key:string,signal?:AbortSignal){
  signal?.throwIfAborted();
  const source='stage' in objects?await objects.stage(key,undefined,{signal}):bufferObject(await objects.read(key));
  if(signal?.aborted){
    await source.dispose();
    signal.throwIfAborted();
  }
  return source;
}
async function putStaged(objects:ObjectStore,key:string,source:ReplayableObject){
  if('putStaged' in objects)return objects.putStaged(key,source);
  const chunks:Buffer[]=[];
  for await(const chunk of source.open())chunks.push(Buffer.from(chunk));
  return objects.put(key,Buffer.concat(chunks,source.receipt.size));
}
export interface PointMetadata extends ObjectReceipt {
  capturedAt: string;
  retention: "daily" | "monthly";
  sourceNodeId: string;
  modules: Record<string, number>;
}
export interface BackupPoint extends PointMetadata {
  id: string;
  venueId: string;
  installationId: string;
  keyVersion: number;
  kind: "snapshot" | "continuous";
  objectKey: string;
  verification: "pending" | "verified" | "failed";
  deleting: boolean;
  deletedAt: string | null;
}
export const uuid = (v: string) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export function backupFail(code: string): never {
  throw new Error("backup." + code);
}
export async function backupPlan(client: PoolClient, venueId: string, mode: PlanMode): Promise<void> {
  try { if (await readVenuePlan(client, venueId, mode) !== 'paid') backupFail('permission_denied'); }
  catch (error) { if (error instanceof Error && error.message === 'permission_denied') backupFail('permission_denied'); throw error; }
}
export async function lockVenue(client: PoolClient, id: string) {
  const row = (
    await client.query(
      "SELECT l.*,v.environment FROM backup_locations l JOIN venues v ON v.id=l.venue_id WHERE l.venue_id=$1 FOR UPDATE OF l",
      [id],
    )
  ).rows[0];
  if (!row) backupFail("unavailable");
  if (row.environment !== "test") backupFail("local_integration_only");
  return row;
}
export async function expireRecoveries(client: PoolClient, venueId: string) {
  await client.query(
    "UPDATE backup_recoveries SET status='closed' WHERE venue_id=$1 AND status<>'closed' AND expires_at<=clock_timestamp()",
    [venueId],
  );
}
export function uniqueViolation(error: unknown, constraint: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint
  );
}
export function location(row: {
  endpoint: string;
  bucket: string;
  region: string;
}): StorageLocation {
  return { endpoint: row.endpoint, bucket: row.bucket, region: row.region };
}
async function active(client: PoolClient, id: string, mode: PlanMode) {
  if (!uuid(id)) backupFail("unavailable");
  const initial=(await client.query('SELECT venue_id FROM installations WHERE id=$1',[id])).rows[0];
  if(!initial)backupFail('unavailable');
  await backupPlan(client,initial.venue_id,mode);
  const row = (
    await client.query(
      "SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR UPDATE OF i",
      [id],
    )
  ).rows[0];
  if (!row) backupFail("unavailable");
  if (row.revoked_at) backupFail("revoked");
  if (row.environment !== "test") backupFail("local_integration_only");
  return row;
}
const metadataColumns = `p.id,p.venue_id AS "venueId",p.installation_id AS "installationId",p.key_version AS "keyVersion",p.kind,p.object_key AS "objectKey",p.digest,p.size,p.captured_at AS "capturedAt",p.retention,p.source_node_id AS "sourceNodeId",p.modules,p.deleting,p.deleted_at AS "deletedAt"`;
const pointColumns = `${metadataColumns},CASE WHEN p.kind='snapshot' THEN COALESCE(q.current_verification,'pending') ELSE p.verification END AS verification`;
const qualifiedPoints = `backup_points p LEFT JOIN backup_point_qualification q ON q.point_id=p.id`;
type StoredPoint = Omit<BackupPoint, "size" | "capturedAt" | "deletedAt"> & {
  size: string | number;
  capturedAt: Date;
  deletedAt: Date | null;
};
function decodedPoint(row: StoredPoint): BackupPoint {
  return {
    ...row,
    size: Number(row.size),
    capturedAt: row.capturedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}
export async function point(
  client: PoolClient,
  id: string,
): Promise<BackupPoint | undefined> {
  const row = (
    await client.query(
      `SELECT ${pointColumns} FROM ${qualifiedPoints} WHERE p.id=$1`,
      [id],
    )
  ).rows[0];
  return row ? decodedPoint(row) : undefined;
}
// Recovery checks the signed proof before consulting evidence; metadata alone carries no verdict.
export async function pointMetadata(client:PoolClient,id:string):Promise<Omit<BackupPoint,'verification'>|undefined>{
  const row=(await client.query<Omit<StoredPoint,'verification'>>(`SELECT ${metadataColumns} FROM backup_points p WHERE p.id=$1`,[id])).rows[0];
  return row?{...row,size:Number(row.size),capturedAt:row.capturedAt.toISOString(),deletedAt:row.deletedAt?.toISOString()??null}:undefined;
}
export async function venuePoints(
  client: PoolClient,
  id: string,
): Promise<BackupPoint[]> {
  const rows = await client.query(
    `SELECT ${pointColumns} FROM ${qualifiedPoints} WHERE p.venue_id=$1 AND p.deleted_at IS NULL AND NOT p.deleting ORDER BY p.captured_at DESC,p.id DESC`,
    [id],
  );
  return rows.rows.map(decodedPoint);
}
export async function pointKeys(
  client: PoolClient,
  vault: BackupKeyVault,
  venue: string,
  version: number,
): Promise<BackupKeys> {
  const row = (
    await client.query(
      "SELECT sealed FROM backup_key_versions WHERE venue_id=$1 AND version=$2",
      [venue, version],
    )
  ).rows[0];
  if (!row) backupFail("key_unavailable");
  return vault.open(venue, version, row.sealed);
}
function validateMetadata(m: PointMetadata) {
  if (
    !m ||
    Object.keys(m).sort().join(",") !==
      "capturedAt,digest,modules,retention,size,sourceNodeId" ||
    !uuid(m.sourceNodeId) ||
    !/^[0-9a-f]{64}$/.test(m.digest) ||
    !Number.isSafeInteger(m.size) ||
    m.size < 1 ||
    m.size > 512 * 1024 * 1024 ||
    !["daily", "monthly"].includes(m.retention) ||
    !Number.isFinite(Date.parse(m.capturedAt)) ||
    new Date(m.capturedAt).toISOString() !== m.capturedAt ||
    Date.parse(m.capturedAt) > Date.now() + 60000 ||
    !m.modules ||
    typeof m.modules !== "object" ||
    Array.isArray(m.modules) ||
    Object.keys(m.modules).length > 100 ||
    Object.entries(m.modules).some(
      ([k, v]) =>
        !/^[a-z][a-z0-9_-]{0,63}$/.test(k) || !Number.isSafeInteger(v) || v < 0,
    )
  )
    backupFail("invalid_metadata");
}
function sameMetadata(p: BackupPoint, m: PointMetadata) {
  return (
    p.digest === m.digest &&
    p.size === m.size &&
    p.capturedAt === m.capturedAt &&
    p.retention === m.retention &&
    p.sourceNodeId === m.sourceNodeId &&
    JSON.stringify(Object.entries(p.modules).sort()) ===
      JSON.stringify(Object.entries(m.modules).sort())
  );
}
/** Trusted local control-plane API. There is no unauthenticated customer provisioning endpoint. */
export class BackupCatalogue {
  readonly #planMode: PlanMode;
  readonly #pool: Pool;
  readonly #vault: BackupKeyVault;
  readonly #objects: ObjectFactory;
  constructor(pool: Pool, vault: BackupKeyVault, objects: ObjectFactory, planMode: PlanMode = 'existing') {
    this.#planMode = planMode;
    this.#pool = pool;
    this.#vault = vault;
    this.#objects = objects;
  }
  async provision(installationId: string, l: StorageLocation) {
    validateLocation(l);
    return transaction(this.#pool, async (client) => {
      const install = await active(client, installationId, this.#planMode),
        prior = (
          await client.query(
            "SELECT * FROM backup_locations WHERE venue_id=$1",
            [install.venue_id],
          )
        ).rows[0];
      if (prior) {
        if (
          prior.endpoint !== l.endpoint || prior.bucket !== l.bucket || prior.region !== l.region ||
          prior.installation_id !== installationId
        )
          backupFail("conflict");
        const setup=(await client.query("SELECT state FROM installation_services WHERE installation_id=$1 AND service='retained_snapshots'",[installationId])).rows[0];
        if(this.#planMode==='test-free-paid' && setup?.state==='unconfigured') {
          await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='retained_snapshots'",[installationId,{version:1,provider:'local-s3',bucket:l.bucket}]);
          await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[installationId]);
        }
        return;
      }
      await client.query(
        "INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,$3,$4,$5)",
        [install.venue_id, installationId, l.endpoint, l.bucket, l.region],
      );
      await client.query(
        "INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,$2)",
        [install.venue_id, this.#vault.create(install.venue_id, 1)],
      );
      await client.query(
        "UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='retained_snapshots'",
        [
          installationId,
          { version: 1, provider: "local-s3", bucket: l.bucket },
        ],
      );
      await client.query(
        "UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1",
        [installationId],
      );
    }).catch((error) => {
      if (uniqueViolation(error, "backup_locations_endpoint_bucket_key"))
        backupFail("conflict");
      throw error;
    });
  }
  async rotate(installationId: string) {
    return transaction(this.#pool, async (client) => {
      const install = await active(client, installationId, this.#planMode),
        l = await lockVenue(client, install.venue_id),
        version = l.active_key_version + 1;
      await client.query(
        "INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,$2,$3)",
        [
          install.venue_id,
          version,
          this.#vault.create(install.venue_id, version),
        ],
      );
      await client.query(
        "UPDATE backup_locations SET active_key_version=$2 WHERE venue_id=$1",
        [install.venue_id, version],
      );
      return version;
    });
  }
  async reserveCapture(installationId: string, id: string, fence?: MutationFence) {
    if (!uuid(id)) backupFail("conflict");
    return transaction(this.#pool, async (client) => {
      const install = await active(client, installationId, this.#planMode),
        l = await lockVenue(client, install.venue_id);
      await fence?.(client);
      await client.query(
        "INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
        [id, install.venue_id, installationId, l.active_key_version],
      );
      const row = (
        await client.query("SELECT *,expired_at IS NOT NULL OR created_at+interval '24 hours'<=clock_timestamp() AS expired FROM backup_captures WHERE id=$1", [id])
      ).rows[0];
      if (
        row.installation_id !== installationId ||
        row.venue_id !== install.venue_id
      )
        backupFail("conflict");
      if(row.expired)backupFail("capture_expired");
      const keys=await pointKeys(client,this.#vault,install.venue_id,row.key_version);
      await fence?.(client);
      return {
        id,
        venueId: install.venue_id as string,
        keyVersion: row.key_version as number,
        location: location(l),
        incomingKey: "incoming/" + id,
        keys,
      };
    });
  }
  async publish(
    installationId: string,
    id: string,
    m: PointMetadata,
    fence?: MutationFence,
  ): Promise<BackupPoint> {
    if (!uuid(id)) backupFail("unavailable");
    validateMetadata(m);
    const published = await transaction(this.#pool, async (client) => {
      const install = await active(client, installationId, this.#planMode),
        l = await lockVenue(client, install.venue_id),
        capture = (
          await client.query(
            "SELECT *,expired_at IS NOT NULL OR created_at+interval '24 hours'<=clock_timestamp() AS expired FROM backup_captures WHERE id=$1 AND installation_id=$2",
            [id, installationId],
          )
        ).rows[0];
      if (!capture) backupFail("unavailable");
      await fence?.(client);
      const prior = await point(client, id);
      if (prior) {
        if (!sameMetadata(prior, m)) backupFail("conflict");
        return { point: prior, location: location(l) };
      }
      if(capture.expired)backupFail("capture_expired");
      const objects = this.#objects(location(l)),
        source = await staged(objects,"incoming/" + id);
      try {
        if (source.receipt.digest !== m.digest || source.receipt.size !== m.size)
          backupFail("object_mismatch");
        const objectKey = "snapshots/" + id;
        await putStaged(objects,objectKey, source);
        await fence?.(client);
        const finalCapture=(await client.query("SELECT expired_at IS NOT NULL OR created_at+interval '24 hours'<=clock_timestamp() AS expired FROM backup_captures WHERE id=$1",[id])).rows[0];
        if(!finalCapture)backupFail("unavailable");
        if(finalCapture.expired)backupFail("capture_expired");
        await client.query(
          `INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules) VALUES($1,$2,$3,$4,'snapshot',$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            install.venue_id,
            installationId,
            capture.key_version,
            objectKey,
            m.digest,
            m.size,
            m.capturedAt,
            m.retention,
            m.sourceNodeId,
            m.modules,
          ],
        );
        return { point: (await point(client, id))!, location: location(l) };
      } finally {
        await source.dispose();
      }
    });
    await this.#objects(published.location).remove("incoming/" + id);
    return published.point;
  }
  async verifyClaim(claim:VerificationClaim,verify:DataRestoreVerifier,signal:AbortSignal=new AbortController().signal) {
    const prepared=await transaction(this.#pool,async client=>{
      const attempt=await prepareVerification(client,claim);
      if(!attempt)return;
      const row=(await client.query('SELECT endpoint,bucket,region FROM backup_locations WHERE venue_id=$1',[claim.venueId])).rows[0];
      return {attempt,location:location(row)};
    });
    if(!prepared)return 'stale' as const;
    const {attempt}=prepared;
    let source:ReplayableObject|undefined,output:VerifiedChildOutput|undefined,reason:BackupVerificationReason|undefined;
    try {
      signal.throwIfAborted();
      let keys:BackupKeys;
      try {keys=await transaction(this.#pool,client=>pointKeys(client,this.#vault,attempt.point.venueId,attempt.point.keyVersion));}
      catch {reason='secret_unavailable';throw Error('backup.key_unavailable');}
      signal.throwIfAborted();
      const objects=this.#objects(prepared.location);
      source='stage' in objects?await objects.stage(attempt.point.objectKey,undefined,{signal}):bufferObject(await objects.read(attempt.point.objectKey));
      signal.throwIfAborted();
      const stagedReceipt={...source.receipt};
      output=await verify(source,{version:attempt.point.keyVersion,reference:attempt.request.backupKey.reference,secret:keys.recoveryKey},attempt.request,signal);
      // Independent stage and child measurements must agree before an archive verdict.
      const measured=output?.result?.measuredArchive;
      if(output?.result?.status==='invalid'&&stagedReceipt.size>0&&!measured)throw Error('backup.verifier_output');
      if(measured&&(measured.sha256!==stagedReceipt.digest||measured.bytes!==stagedReceipt.size))throw Error('backup.verifier_output');
      const mismatch=stagedReceipt.size!==attempt.point.size?'archive_size_mismatch':stagedReceipt.digest!==attempt.point.digest?'archive_digest_mismatch':undefined;
      if(output?.result?.status==='invalid'&&(mismatch||['archive_size_mismatch','archive_digest_mismatch'].includes(output.result.reason))&&output.result.reason!==mismatch)throw Error('backup.verifier_output');
    } catch(error) {
      if(!reason)reason=isBackupCancellation(error,signal)?'cancelled':error instanceof Error&&error.message==='backup.verifier_timeout'?'deadline':error instanceof Error&&error.message==='backup.verifier_resource'?'resource_limit':error instanceof Error&&error.message==='backup.verifier_cleanup'?'cleanup_uncertain':'unexpected';
    } finally {
      // A verdict becomes admissible only after the caller-owned encrypted stage is gone.
      try {await source?.dispose();}catch {reason='cleanup_uncertain';}
    }
    if(!reason&&signal.aborted)reason='cancelled';
    return transaction(this.#pool,client=>reason?recordVerificationUnavailable(client,attempt,reason):admitVerification(client,attempt,output!));
  }
  async cleanupOne(venueId: string, now = new Date(), fence?: MutationFence): Promise<string | null> {
    if (!uuid(venueId) || !Number.isFinite(now.getTime()))
      backupFail("unavailable");
    const selected = await transaction(this.#pool, async (client) => {
      if (await readVenuePlan(client,venueId,this.#planMode) !== 'paid') return null;
      await lockVerificationPolicy(client);
      const l = await lockVenue(client, venueId);
      await fence?.(client);
      await expireRecoveries(client, venueId);
      const result = await client.query(
        `SELECT p.id,p.object_key FROM backup_points p WHERE p.venue_id=$1 AND p.deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM backup_recoveries r WHERE r.point_id=p.id AND r.status<>'closed')
    AND (p.deleting OR ((${retentionExpirySql})<=$2
     AND p.id IS DISTINCT FROM (SELECT q.id FROM backup_points q WHERE q.venue_id=$1 AND q.kind='snapshot' AND NOT q.deleting AND q.deleted_at IS NULL ORDER BY EXISTS(SELECT 1 FROM backup_verifications v WHERE v.point_id=q.id AND v.outcome='verified') DESC,q.captured_at DESC,q.id DESC LIMIT 1)))
    ORDER BY p.deleting DESC,p.captured_at,p.id LIMIT 1`,
        [venueId, now],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0];
      await client.query("UPDATE backup_points SET deleting=true WHERE id=$1", [
        row.id,
      ]);
      return {
        id: row.id as string,
        key: row.object_key as string,
        location: location(l),
      };
    });
    if (!selected) return null;
    if(this.#planMode==='test-free-paid') {
      return transaction(this.#pool,async client=>{
        if(await readVenuePlan(client,venueId,this.#planMode)!=='paid')return null;
        await lockVerificationPolicy(client);await lockVenue(client,venueId);await fence?.(client);
        // Keep policy through deletion so a committed downgrade cannot be followed by expiry.
        await this.#objects(selected.location).remove(selected.key);
        await fence?.(client);
        await client.query('UPDATE backup_points SET deleted_at=COALESCE(deleted_at,clock_timestamp()) WHERE id=$1 AND deleting',[selected.id]);
        return selected.id;
      });
    }
    await this.#objects(selected.location).remove(selected.key);
    await transaction(this.#pool, async (client) => {
      await lockVerificationPolicy(client);
      await lockVenue(client, venueId);
      await fence?.(client);
      await client.query(
        "UPDATE backup_points SET deleted_at=COALESCE(deleted_at,clock_timestamp()) WHERE id=$1 AND deleting",
        [selected.id],
      );
    });
    return selected.id;
  }
  async cleanupCapture(venueId:string,fence?:MutationFence):Promise<string|null>{
    if(!uuid(venueId))backupFail('unavailable');
    const selected=await transaction(this.#pool,async client=>{
      const l=await lockVenue(client,venueId);await fence?.(client);
      const row=(await client.query(`SELECT c.id,EXISTS(SELECT 1 FROM backup_points p WHERE p.id=c.id) AS published
        FROM backup_captures c WHERE c.venue_id=$1 AND c.cleaned_at IS NULL
        AND(c.expired_at IS NOT NULL OR c.created_at+interval '24 hours 16 minutes'<=clock_timestamp())
        ORDER BY c.created_at,c.id LIMIT 1`,[venueId])).rows[0];
      if(!row)return null;
      // Tombstones block new publication before either object is removed; UUIDs cannot be reused.
      await client.query('UPDATE backup_captures SET expired_at=COALESCE(expired_at,clock_timestamp()) WHERE id=$1',[row.id]);
      return {id:row.id as string,published:row.published as boolean,location:location(l)};
    });
    if(!selected)return null;
    const objects=this.#objects(selected.location);await objects.remove('incoming/'+selected.id);
    if(!selected.published)await objects.remove('snapshots/'+selected.id);
    await transaction(this.#pool,async client=>{
      await lockVenue(client,venueId);await fence?.(client);
      await client.query('UPDATE backup_captures SET cleaned_at=COALESCE(cleaned_at,clock_timestamp()) WHERE id=$1 AND expired_at IS NOT NULL',[selected.id]);
    });
    return selected.id;
  }

}
