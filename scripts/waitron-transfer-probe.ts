import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const checkout = process.env.WAITRON_CHECKOUT;
assert(checkout, "Set WAITRON_CHECKOUT");
const { createCloudSnapshotWorker } = await import(
  pathToFileURL(join(checkout, "apps/server/src/cloud-snapshot-worker.ts")).href
);
const roots: string[] = [];
const root = async () => {
  const value = await mkdtemp(join(tmpdir(), "cloud-transfer-waitron-"));
  roots.push(value);
  return value;
};
const now = Date.parse("2026-09-26T09:00:00.000Z");

function fixture(stateDir: string) {
  const installationId = randomUUID(),
    venueId = randomUUID(),
    sourceNodeId = randomUUID();
  let reservations = 0,
    archives = 0,
    uploads = 0,
    publications = 0;
  const status = {
    state: "complete",
    code: "",
    environment: "test",
    registration: {
      installationId,
      venueId,
      organisationId: randomUUID(),
      legalBusinessId: randomUUID(),
    },
    installation: {
      state: "active",
      revision: 1,
      lastContactAt: null,
      leaseExpiresAt: null,
      services: [
        {
          service: "retained_snapshots",
          state: "ready",
          health: "unknown",
          failure: null,
          observedAt: null,
        },
      ],
    },
  } as const;
  const counters = () => ({ reservations, archives, uploads, publications });
  const deps = {
    stateDir,
    sourceNodeId,
    isPrimary: () => true,
    now: () => new Date(now),
    readClock: async () => ({ timeZone: "Europe/Madrid", dayCutover: "04:00" }),
    connection: {
      async status() {
        return status;
      },
      async reserveCapture(id: string) {
        reservations++;
        return {
          id,
          installationId,
          venueId,
          keyVersion: 1,
          location: {
            endpoint: "https://storage.example.test",
            bucket: "transfer-probe",
            region: "local",
          },
          incomingKey: "incoming/" + id,
          recoveryKey: "r".repeat(43),
          credentials: {
            accessKeyId: `renewed-${reservations}`,
            secretAccessKey: "secret",
            sessionToken: "temporary",
          },
          expiresAt: new Date(now + 900000).toISOString(),
        };
      },
      async publishCapture(id: string, metadata: Record<string, unknown>) {
        if (uploads === 0) throw new Error("object missing");
        publications++;
        return {
          id,
          installationId,
          venueId,
          keyVersion: 1,
          verification: "pending" as const,
          ...metadata,
        };
      },
    },
    async createArchive() {
      archives++;
      return { bytes: Buffer.from("encrypted transfer probe"), modules: { core: 1 } };
    },
    async upload() {
      uploads++;
    },
  };
  return { deps, counters };
}

try {
  const renewal = fixture(await root());
  const renewalUpload = renewal.deps.upload;
  let renewalAttempts = 0;
  renewal.deps.upload = async (...args: Parameters<typeof renewalUpload>) => {
    renewalAttempts++;
    if (renewalAttempts === 1) throw new Error("expired credential");
    await renewalUpload(...args);
  };
  await assert.rejects(
    createCloudSnapshotWorker(renewal.deps).tick(new AbortController().signal),
    /expired credential/,
  );
  await createCloudSnapshotWorker(renewal.deps).tick(new AbortController().signal);
  assert.deepEqual(renewal.counters(), {
    reservations: 2,
    archives: 1,
    uploads: 1,
    publications: 1,
  });
  assert.equal(renewalAttempts, 2);

  const acknowledged = fixture(await root());
  const publish = acknowledged.deps.connection.publishCapture;
  let loseReply = true;
  acknowledged.deps.connection.publishCapture = async (...args: Parameters<typeof publish>) => {
    if (loseReply) {
      loseReply = false;
      throw new Error("publication reply lost");
    }
    return publish(...args);
  };
  await assert.rejects(
    createCloudSnapshotWorker(acknowledged.deps).tick(new AbortController().signal),
    /publication reply lost/,
  );
  await createCloudSnapshotWorker(acknowledged.deps).tick(new AbortController().signal);
  assert.deepEqual(acknowledged.counters(), {
    reservations: 1,
    archives: 1,
    uploads: 1,
    publications: 1,
  });

  const shutdown = fixture(await root());
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  shutdown.deps.createArchive = async () => {
    entered();
    await delay(160);
    return { bytes: Buffer.from("encrypted transfer probe"), modules: { core: 1 } };
  };
  const controller = new AbortController(),
    running = createCloudSnapshotWorker(shutdown.deps).tick(controller.signal);
  await started;
  const abortedAt = performance.now();
  controller.abort();
  await assert.rejects(
    running,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  const shutdownCounters = shutdown.counters();
  assert.equal(shutdownCounters.uploads, 0);
  assert.equal(shutdownCounters.publications, 0);

  console.log(
    JSON.stringify({
      credentialRenewalReusedArchive: renewal.counters().archives === 1,
      archives: renewal.counters().archives,
      acknowledgedUploadResumed:
        acknowledged.counters().uploads === 1 &&
        acknowledged.counters().publications === 1,
      uploads: acknowledged.counters().uploads,
      publications: acknowledged.counters().publications,
      archiveAbortToSettleMs: performance.now() - abortedAt,
      shutdownUploads: shutdownCounters.uploads,
      shutdownPublications: shutdownCounters.publications,
    }),
  );
} finally {
  await Promise.all(roots.map((value) => rm(value, { recursive: true, force: true })));
}
