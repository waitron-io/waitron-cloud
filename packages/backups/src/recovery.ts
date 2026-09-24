import { createPublicKey, verify } from "node:crypto";
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
export interface RecoveryInput {
  id: string;
  pointId: string;
  mode: "planned" | "failure";
  targetPublicKey: string;
  oldServerUnavailable: boolean;
  acceptDataLoss: boolean;
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
function view(row: Record<string, unknown>) {
  return {
    id: row.id,
    venueId: row.venue_id,
    pointId: row.point_id,
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
    if (
      !uuid(input.id) ||
      !uuid(input.pointId) ||
      !["planned", "failure"].includes(input.mode)
    )
      backupFail("invalid_input");
    publicKey(input.targetPublicKey);
    if (input.oldServerUnavailable !== true || input.acceptDataLoss !== true)
      backupFail("confirmation_required");
    return this.#transaction(async (client) => {
      const session = await resolveSession(client, token, {
          csrfToken,
          touch: false,
        }),
        first = await point(client, input.pointId);
      if (!first) backupFail("unavailable");
      await permission(client, session.accountId, first.venueId);
      await lockVenue(client, first.venueId);
      await expireRecoveries(client, first.venueId);
      const p = (await point(client, input.pointId))!;
      if (p.deleting || p.deletedAt) backupFail("unavailable");
      if (p.verification !== "verified") backupFail("unverified");
      const prior = (
        await client.query("SELECT * FROM backup_recoveries WHERE id=$1", [
          input.id,
        ])
      ).rows[0];
      if (prior) {
        if (
          prior.point_id !== input.pointId ||
          prior.venue_id !== p.venueId ||
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
            [p.venueId],
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
          "INSERT INTO backup_recoveries(id,venue_id,point_id,account_id,target_public_key,mode) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            input.id,
            p.venueId,
            p.id,
            session.accountId,
            input.targetPublicKey,
            input.mode,
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
  async target(id:string, action:"info", proof:Proof):Promise<{point:import("./catalogue.ts").BackupPoint;operationExpiresAt:string}>;
  async target(id:string, action:"read"|"restored", proof:Proof):Promise<{point:import("./catalogue.ts").BackupPoint;location:import("./storage.ts").StorageLocation;keys:import("./keys.ts").BackupKeys;operationExpiresAt:string}>;
  async target(id: string, action: "info" | "read" | "restored", proof: Proof) {
    if (!uuid(id) || !["info", "read", "restored"].includes(action))
      backupFail("invalid_proof");
    return this.#transaction(async (client) => {
      const first = await operation(client, id);
      await permission(client, first.account_id, first.venue_id);
      const l = await lockVenue(client, first.venue_id),
        row = await operation(client, id),
        p = await point(client, row.point_id);
      if (
        row.status === "closed" ||
        row.expires_at.getTime() <= Date.now() ||
        !p ||
        p.deleting ||
        p.deletedAt
      )
        backupFail("unavailable");
      validateProof(
        this.#origin,
        id,
        action,
        action === "info" ? "" : p.digest,
        row.target_public_key,
        proof,
      );
      if (p.verification !== "verified") backupFail("unverified");
      if (action === "info") return {point:p,operationExpiresAt:row.expires_at.toISOString() as string};
      if (action === "restored")
        await client.query(
          "UPDATE backup_recoveries SET status='restored' WHERE id=$1",
          [id],
        );
      const keys = await pointKeys(
        client,
        this.#vault,
        p.venueId,
        p.keyVersion,
      );
      if (row.expires_at.getTime() <= Date.now()) backupFail("unavailable");
      validateProof(
        this.#origin,
        id,
        action,
        p.digest,
        row.target_public_key,
        proof,
      );
      return {
        point: p,
        location: location(l),
        keys,
        operationExpiresAt: row.expires_at.toISOString() as string,
      };
    });
  }
  async catalogue(token: string, venueId: string) {
    if (!uuid(venueId)) backupFail("unavailable");
    return this.#transaction(async (client) => {
      const session = await resolveSession(client, token, { touch: false });
      await permission(client, session.accountId, venueId);
      await lockVenue(client, venueId);
      const points = await venuePoints(client, venueId);
      await resolveSession(client, token, { touch: false });
      return {
        points,
        defaultPointId:
          points.find(
            (p) => p.kind === "snapshot" && p.verification === "verified",
          )?.id ?? null,
        continuousRecoveryAvailable: false,
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
