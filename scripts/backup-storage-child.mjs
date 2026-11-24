import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { releaseStorageControlClaims } from "../deploy/test-cloud/storage-admin-control-cleanup.mjs";

const [root] = process.argv.slice(2);
const bin = join(root, "weed");
const dataArgument = " -dir=" + join(root, "data") + " ";

function ownedStores() {
  const inspect = () => execFileSync("/bin/ps", ["-ww", "-axo", "pid=,stat=,args="], {
    encoding: "utf8", timeout: 2000, maxBuffer: 8 * 1024 * 1024, env: { LC_ALL: "C.UTF-8" },
  });
  let rows;
  try { rows = inspect(); }
  catch (error) {
    if (error.code !== "ETIMEDOUT") throw error;
    rows = inspect();
  }
  return rows.split("\n").flatMap(row => {
    const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(row);
    if (!match || match[2].startsWith("Z")) return [];
    const command = match[3];
    return command.startsWith(bin + " ") && command.includes(dataArgument) ? [Number(match[1])] : [];
  });
}

function signal(pid, name) {
  try { process.kill(pid, name); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

let done = false;
process.once("message", message => {
  if (message === "done") {
    done = true;
    if (process.connected) process.disconnect();
  }
});
if (process.connected) await once(process, "disconnect");

if (!done) {
  // Revoke the executable before looking for a child still entering exec.
  try { await unlink(bin); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const deadline = performance.now() + 5000;
  const stopping = new Set();
  do {
    for (const pid of ownedStores()) {
      if (stopping.has(pid)) continue;
      signal(pid, "SIGTERM");
      stopping.add(pid);
    }
    await delay(100);
  } while (performance.now() < deadline);
  for (const pid of ownedStores()) signal(pid, "SIGKILL");
  for (let attempt = 0; ownedStores().length; attempt++) {
    if (attempt === 20) throw Error("Owned storage process did not stop");
    await delay(100);
  }
  await releaseStorageControlClaims([root]);
  await rm(root, { recursive: true, force: true });
}
