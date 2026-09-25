import { createPublicKey, verify } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "@waitron-cloud/registration";
import { backupFail, location, pointKeys, uuid } from "./catalogue.ts";
import type { BackupKeyVault } from "./keys.ts";
import type { StorageCredentials, StorageLocation } from "./storage.ts";

export interface ManagedStreamProvision {
  writerReference: string;
  readerReference: string;
  writerCredentials: Pick<StorageCredentials, "accessKeyId" | "secretAccessKey">;
}

export interface ManagedStreamAuthority {
  provision(input: {
    venueId: string;
    location: StorageLocation;
    prefix: string;
  }): Promise<ManagedStreamProvision>;
  read(
    readerReference: string,
    location: StorageLocation,
    key: string,
  ): Promise<Buffer>;
}

export interface ManagedStreamInput {
  localVenueId: string;
  sourceNodeId: string;
  pointerSignerPublicKey: string;
}
export type ManagedStreamFence = (client: PoolClient) => Promise<void>;

export interface ManagedStreamConfiguration {
  venueId: string;
  installationId: string;
  configurationRevision: number;
  localVenueId: string;
  sourceNodeId: string;
  bucket: StorageLocation & {
    prefix: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  recoveryKey: string;
}

export interface ManagedStreamRecovery {
  venueId: string;
  installationId: string;
  configurationRevision: number;
  keyVersion: number;
  localVenueId: string;
  sourceNodeId: string;
  pointerSignerPublicKey: string;
  location: StorageLocation;
  prefix: string;
  readerReference: string;
  generation: string | null;
  recoverableAt: string | null;
  checkedAt: string | null;
}

interface StreamRow {
  venue_id: string;
  installation_id: string;
  requested_revision: number;
  configuration_revision: number;
  key_version: number;
  local_venue_id: string;
  source_node_id: string;
  pointer_signer_public_key: string;
  object_prefix: string;
  writer_reference: string;
  reader_reference: string;
  generation: string | null;
  recoverable_at: Date | null;
  observed_at: Date | null;
  endpoint: string;
  bucket: string;
  region: string;
}

interface PointerBody {
  venueId: string;
  term: number;
  nodeId: string;
  generation: string;
  writtenAt: string;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(",")}}`;
}

function publicKey(value: string) {
  try {
    if (!/^[A-Za-z0-9+/]{59}=$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) throw new Error();
    const key = createPublicKey({ key: bytes, type: "spki", format: "der" });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !key.export({ type: "spki", format: "der" }).equals(bytes)
    )
      throw new Error();
    return key;
  } catch {
    backupFail("invalid_stream_configuration");
  }
}

function validInput(input: ManagedStreamInput) {
  if (
    !exactObject(input, ["localVenueId", "sourceNodeId", "pointerSignerPublicKey"]) ||
    !uuid(input.localVenueId) ||
    !uuid(input.sourceNodeId)
  )
    backupFail("invalid_stream_configuration");
  publicKey(input.pointerSignerPublicKey);
}

function validProvision(value: ManagedStreamProvision) {
  if (
    !exactObject(value, ["writerReference", "readerReference", "writerCredentials"]) ||
    typeof value.writerReference !== "string" ||
    !value.writerReference ||
    value.writerReference.length > 512 ||
    typeof value.readerReference !== "string" ||
    !value.readerReference ||
    value.readerReference.length > 512 ||
    !exactObject(value.writerCredentials, ["accessKeyId", "secretAccessKey"]) ||
    typeof value.writerCredentials.accessKeyId !== "string" ||
    !value.writerCredentials.accessKeyId ||
    typeof value.writerCredentials.secretAccessKey !== "string" ||
    !value.writerCredentials.secretAccessKey
  )
    backupFail("storage_grant");
}

function sameInput(row: StreamRow, revision: number, input: ManagedStreamInput) {
  return (
    row.requested_revision === revision &&
    row.local_venue_id === input.localVenueId &&
    row.source_node_id === input.sourceNodeId &&
    row.pointer_signer_public_key === input.pointerSignerPublicKey
  );
}

function decodeRow(row: StreamRow): ManagedStreamRecovery {
  return {
    venueId: row.venue_id,
    installationId: row.installation_id,
    configurationRevision: row.configuration_revision,
    keyVersion: row.key_version,
    localVenueId: row.local_venue_id,
    sourceNodeId: row.source_node_id,
    pointerSignerPublicKey: row.pointer_signer_public_key,
    location: location(row),
    prefix: row.object_prefix,
    readerReference: row.reader_reference,
    generation: row.generation,
    recoverableAt: row.recoverable_at?.toISOString() ?? null,
    checkedAt: row.observed_at?.toISOString() ?? null,
  };
}

async function lockedInstallation(client: PoolClient, installationId: string) {
  if (!uuid(installationId)) backupFail("unavailable");
  const row = (
    await client.query(
      `SELECT i.*,v.environment,l.endpoint,l.bucket,l.region,l.active_key_version
       FROM installations i JOIN venues v ON v.id=i.venue_id
       JOIN backup_locations l ON l.venue_id=i.venue_id
       WHERE i.id=$1 FOR UPDATE OF i`,
      [installationId],
    )
  ).rows[0];
  if (!row) backupFail("unavailable");
  if (row.revoked_at || row.superseded_by) backupFail("revoked");
  if (row.environment !== "test") backupFail("local_integration_only");
  if (row.id !== installationId) backupFail("conflict");
  return row;
}

async function streamRow(client: PoolClient, venueId: string, lock = false) {
  return (
    await client.query<StreamRow>(
      `SELECT s.*,l.endpoint,l.bucket,l.region FROM backup_managed_streams s
       JOIN backup_locations l ON l.venue_id=s.venue_id WHERE s.venue_id=$1${lock ? " FOR UPDATE OF s" : ""}`,
      [venueId],
    )
  ).rows[0];
}

function configuration(
  row: StreamRow,
  provision: ManagedStreamProvision,
  recoveryKey: string,
): ManagedStreamConfiguration {
  return {
    venueId: row.venue_id,
    installationId: row.installation_id,
    configurationRevision: row.configuration_revision,
    localVenueId: row.local_venue_id,
    sourceNodeId: row.source_node_id,
    bucket: {
      ...location(row),
      prefix: row.object_prefix,
      ...provision.writerCredentials,
    },
    recoveryKey,
  };
}

function pointer(bytes: Buffer, expected: StreamRow): PointerBody & { signature: string } {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    backupFail("invalid_stream_pointer");
  }
  if (!exactObject(value, ["body", "signature"]) || typeof value.signature !== "string")
    backupFail("invalid_stream_pointer");
  const body = value.body;
  if (
    !exactObject(body, ["venueId", "term", "nodeId", "generation", "writtenAt"]) ||
    typeof body.venueId !== "string" ||
    !Number.isSafeInteger(body.term) ||
    Number(body.term) < 0 ||
    typeof body.nodeId !== "string" ||
    typeof body.generation !== "string" ||
    typeof body.writtenAt !== "string" ||
    body.venueId !== expected.local_venue_id ||
    body.nodeId !== expected.source_node_id
  )
    backupFail("invalid_stream_pointer");
  const generation = /^gen-(0|[1-9][0-9]*)-([A-Za-z0-9][A-Za-z0-9-]*)-([0-9]{8}T[0-9]{6}Z)$/.exec(
    body.generation,
  );
  const written = new Date(body.writtenAt);
  if (
    !generation ||
    Number(generation[1]) !== body.term ||
    generation[2] !== body.nodeId ||
    Number.isNaN(written.getTime()) ||
    written.toISOString() !== body.writtenAt ||
    written.getTime() > Date.now() + 60_000 ||
    !/^[A-Za-z0-9+/]{86}==$/.test(value.signature)
  )
    backupFail("invalid_stream_pointer");
  const signature = Buffer.from(value.signature, "base64");
  if (
    signature.length !== 64 ||
    signature.toString("base64") !== value.signature ||
    !verify(
      null,
      Buffer.from(
        canonicalize({ purpose: "waitron.stream.pointer.v1", pointer: body }),
        "utf8",
      ),
      publicKey(expected.pointer_signer_public_key),
      signature,
    )
  )
    backupFail("invalid_stream_pointer");
  return { ...(body as unknown as PointerBody), signature: value.signature };
}

/** Cloud's internal managed-stream boundary. Provider references are persisted; credentials are not. */
export class ManagedStreams {
  readonly #pool: Pool;
  readonly #vault: BackupKeyVault;
  readonly #authority: ManagedStreamAuthority;

  constructor(pool: Pool, vault: BackupKeyVault, authority: ManagedStreamAuthority) {
    this.#pool = pool;
    this.#vault = vault;
    this.#authority = authority;
  }

  async configure(
    installationId: string,
    revision: number,
    input: ManagedStreamInput,
    fence?: ManagedStreamFence,
  ): Promise<ManagedStreamConfiguration> {
    if (!Number.isSafeInteger(revision) || revision < 0) backupFail("invalid_stream_configuration");
    validInput(input);
    const initial = await transaction(this.#pool, async (client) => {
      const install = await lockedInstallation(client, installationId);
      await fence?.(client);
      const existing = await streamRow(client, install.venue_id);
      if (existing && !sameInput(existing, revision, input)) backupFail("conflict");
      if (!existing && install.configuration_revision !== revision) backupFail("conflict");
      return { install, existing };
    });
    const prefix = `streams/${initial.install.venue_id}/`;
    const provision = await this.#authority.provision({
      venueId: initial.install.venue_id,
      location: location(initial.install),
      prefix,
    });
    validProvision(provision);
    return transaction(this.#pool, async (client) => {
      const install = await lockedInstallation(client, installationId);
      await fence?.(client);
      let row = await streamRow(client, install.venue_id, true);
      if (row) {
        if (
          !sameInput(row, revision, input) ||
          row.writer_reference !== provision.writerReference ||
          row.reader_reference !== provision.readerReference ||
          row.configuration_revision !== install.configuration_revision
        )
          backupFail("conflict");
      } else {
        if (install.configuration_revision !== revision) backupFail("conflict");
        row = (
          await client.query<StreamRow>(
            `INSERT INTO backup_managed_streams(
              venue_id,installation_id,requested_revision,configuration_revision,key_version,
              local_venue_id,source_node_id,pointer_signer_public_key,object_prefix,
              writer_reference,reader_reference)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *, $12::text AS endpoint,$13::text AS bucket,$14::text AS region`,
            [
              install.venue_id,
              installationId,
              revision,
              revision + 1,
              install.active_key_version,
              input.localVenueId,
              input.sourceNodeId,
              input.pointerSignerPublicKey,
              prefix,
              provision.writerReference,
              provision.readerReference,
              install.endpoint,
              install.bucket,
              install.region,
            ],
          )
        ).rows[0]!;
        await client.query(
          `UPDATE installation_services SET state='provisioning',configuration=$2
           WHERE installation_id=$1 AND service='continuous_backup'`,
          [installationId, { version: 1, managed: true }],
        );
        await client.query(
          "UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1",
          [installationId],
        );
      }
      const keys = await pointKeys(client, this.#vault, row.venue_id, row.key_version);
      return configuration(row, provision, keys.recoveryKey);
    });
  }

  async observe(installationId: string, revision: number, fence?: ManagedStreamFence): Promise<ManagedStreamRecovery> {
    if (!Number.isSafeInteger(revision) || revision < 0) backupFail("conflict");
    const initial = await transaction(this.#pool, async (client) => {
      const install = await lockedInstallation(client, installationId);
      await fence?.(client);
      const row = await streamRow(client, install.venue_id);
      if (!row || row.installation_id !== installationId || row.configuration_revision !== revision)
        backupFail("conflict");
      if (install.configuration_revision !== revision) backupFail("conflict");
      return row;
    });
    const bytes = await this.#authority.read(
      initial.reader_reference,
      location(initial),
      `${initial.object_prefix}venues/${initial.local_venue_id}/current.json`,
    );
    const observed = pointer(bytes, initial);
    return transaction(this.#pool, async (client) => {
      const install = await lockedInstallation(client, installationId);
      await fence?.(client);
      const row = await streamRow(client, install.venue_id, true);
      if (
        !row ||
        row.installation_id !== installationId ||
        row.configuration_revision !== revision ||
        install.configuration_revision !== revision
      )
        backupFail("conflict");
      if (!row.recoverable_at || row.recoverable_at.getTime() < Date.parse(observed.writtenAt)) {
        const updated = (
          await client.query<StreamRow>(
            `UPDATE backup_managed_streams SET generation=$2,recoverable_at=$3,observed_at=clock_timestamp()
             WHERE venue_id=$1 RETURNING *, $4::text AS endpoint,$5::text AS bucket,$6::text AS region`,
            [
              row.venue_id,
              observed.generation,
              observed.writtenAt,
              row.endpoint,
              row.bucket,
              row.region,
            ],
          )
        ).rows[0]!;
        return decodeRow(updated);
      }
      return decodeRow(row);
    });
  }

  async recovery(venueId: string, revision: number): Promise<ManagedStreamRecovery | undefined> {
    if (!uuid(venueId) || !Number.isSafeInteger(revision) || revision < 0) return;
    return transaction(this.#pool, async (client) => {
      const row = await streamRow(client, venueId);
      if (!row || row.configuration_revision !== revision) return;
      return decodeRow(row);
    });
  }
}
