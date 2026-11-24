import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadStorageArchive } from "./storage-archive-download.mjs";

const pins = {
  "darwin-arm64": ["darwin_arm64", "faa194e72a346755dc4404288b0561eb3c260351702901d8363024d5099bdd7d"],
  "linux-arm64": ["linux_arm64", "557e92c38c5c7d180748eb8e2b2b45e426f8e5282a4caca8e098a90d09f03a07"],
  "linux-x64": ["linux_amd64", "4a7d108384d044d95212d1342cdda9533fa55842c1c9b41f606ca3c8a9561124"],
};

// The shared cache is read-only; callers own and remove the returned seedRoot.
export async function prepareStorageTarSeed() {
  const pin = pins[process.platform + "-" + process.arch];
  assert.ok(pin, "storage seed checks need a supported storage fixture platform");
  const [name, checksum] = pin;
  const archiveName = "seaweed-4.48-" + name + ".tar.gz";
  let seedRoot;
  const url = "https://github.com/seaweedfs/seaweedfs/releases/download/4.48/" + name + ".tar.gz";
  const started = performance.now();
  let bytes, phase = "cache", attempt = 0, status = null, bytesReceived = 0;
  const report = event => {
    // Signed redirect URLs and response bodies must never enter acquisition records.
    try { console.error("storage_seed_acquisition=" + JSON.stringify({
      event, phase, url, attempt, status, bytesReceived,
      elapsedMs: Math.round(performance.now() - started), timeoutMs: 30000,
    })); } catch {}
  };
  try {
    try {
      bytes = await readFile(join(tmpdir(), "waitron-cloud-test-binaries", archiveName));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      bytes = await downloadStorageArchive(url, { report(event) {
        ({ phase, attempt, status, bytesReceived } = event);
        report(event.event);
      } });
    }
    phase = "digest";
    assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum, "SeaweedFS archive digest mismatch");
    phase = "seed";
    seedRoot = await mkdtemp(join(tmpdir(), "cloud-storage-tar-seed-"));
    const seed = join(seedRoot, archiveName);
    await writeFile(seed, bytes, { flag: "wx", mode: 0o400 });
    report("complete");
    return { seedRoot, seed, archiveName };
  } catch (error) {
    report("failure");
    if (seedRoot) {
      try { await rm(seedRoot, { recursive: true, force: true }); }
      catch (cleanupError) {
        phase = "cleanup"; report("failure");
        throw new AggregateError([error, cleanupError], "Storage seed setup and cleanup failed", { cause: error });
      }
    }
    throw error;
  }
}
