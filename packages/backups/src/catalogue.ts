import {retentionExpirySql} from './retention.ts';
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "@waitron-cloud/registration";
import { BackupKeyVault, type BackupKeys } from "./keys.ts";
import {
  validateLocation,
  type ObjectReceipt,
  type StorageLocation,
} from "./storage.ts";
import { bufferObject, type ReplayableObject, type StageOptions } from "./object-transfer.ts";
import { isBackupCancellation } from "./cancellation.ts";
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
async function active(client: PoolClient, id: string) {
  if (!uuid(id)) backupFail("unavailable");
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
const pointColumns = `id,venue_id AS "venueId",installation_id AS "installationId",key_version AS "keyVersion",kind,object_key AS "objectKey",digest,size,captured_at AS "capturedAt",retention,source_node_id AS "sourceNodeId",modules,verification,deleting,deleted_at AS "deletedAt"`;
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
      `SELECT ${pointColumns} FROM backup_points WHERE id=$1`,
      [id],
    )
  ).rows[0];
  return row ? decodedPoint(row) : undefined;
}
export async function venuePoints(
  client: PoolClient,
  id: string,
): Promise<BackupPoint[]> {
  const rows = await client.query(
    `SELECT ${pointColumns} FROM backup_points WHERE venue_id=$1 AND deleted_at IS NULL AND NOT deleting ORDER BY captured_at DESC,id DESC`,
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
  readonly #pool: Pool;
  readonly #vault: BackupKeyVault;
  readonly #objects: ObjectFactory;
  constructor(pool: Pool, vault: BackupKeyVault, objects: ObjectFactory) {
    this.#pool = pool;
    this.#vault = vault;
    this.#objects = objects;
  }
  async provision(installationId: string, l: StorageLocation) {
    validateLocation(l);
    return transaction(this.#pool, async (client) => {
      const install = await active(client, installationId),
        prior = (
          await client.query(
            "SELECT * FROM backup_locations WHERE venue_id=$1",
            [install.venue_id],
          )
        ).rows[0];
      if (prior) {
        if (
          JSON.stringify(location(prior)) !== JSON.stringify(l) ||
          prior.installation_id !== installationId
        )
          backupFail("conflict");
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
      const install = await active(client, installationId),
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
      const install = await active(client, installationId),
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
      const install = await active(client, installationId),
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
  async verify(
    id: string,
    verifier: string,
    restore: (
      source: ReplayableObject,
      keys: BackupKeys,
      point: BackupPoint,
    ) => Promise<void>,
    fence?: MutationFence,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!uuid(id) || !verifier || verifier.length > 200)
      backupFail("unavailable");
    const prepared = await transaction(this.#pool, async (client) => {
      const first = await point(client, id);
      if (!first) backupFail("unavailable");
      const l = await lockVenue(client, first.venueId),
        p = (await point(client, id))!;
      if (p.deleting || p.deletedAt) backupFail("unavailable");
      await fence?.(client);
      const keys = await pointKeys(
        client,
        this.#vault,
        p.venueId,
        p.keyVersion,
      );
      return { point: p, location: location(l), keys };
    });
    let outcome: "verified" | "failed" = "verified";
    try {
      const objects=this.#objects(prepared.location),
        source = await staged(objects,prepared.point.objectKey,signal);
      try {
        if (
          source.receipt.digest !== prepared.point.digest ||
          source.receipt.size !== prepared.point.size
        )
          backupFail("object_mismatch");
        await restore(source, prepared.keys, prepared.point);
      } finally {
        await source.dispose();
      }
    } catch (error) {
      if (isBackupCancellation(error, signal)) throw error;
      outcome = "failed";
    }
    await transaction(this.#pool, async (client) => {
      await lockVenue(client, prepared.point.venueId);
      await fence?.(client);
      const current = await point(client, id);
      if (
        !current ||
        current.deleting ||
        current.deletedAt ||
        !sameMetadata(current, prepared.point)
      )
        backupFail("unavailable");
      await client.query(
        "INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), id, current.digest, verifier, outcome],
      );
      await client.query(
        "UPDATE backup_points SET verification=$2 WHERE id=$1",
        [id, outcome],
      );
    });
    if (outcome !== "verified") backupFail("verification_failed");
  }
  async cleanupOne(venueId: string, now = new Date(), fence?: MutationFence): Promise<string | null> {
    if (!uuid(venueId) || !Number.isFinite(now.getTime()))
      backupFail("unavailable");
    const selected = await transaction(this.#pool, async (client) => {
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
    await this.#objects(selected.location).remove(selected.key);
    await transaction(this.#pool, async (client) => {
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
