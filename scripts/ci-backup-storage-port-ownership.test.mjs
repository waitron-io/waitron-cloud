import assert from "node:assert/strict";
import childProcess from "node:child_process";
import net from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { syncBuiltinESMExports } from "node:module";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

// Reusing a released socket before its native owner binds must not assign that
// port to a second fixture. A stopped child makes that handoff reproducible.
for (const exhausted of [false, true]) test(exhausted
  ? "native port claim conflicts have a bounded refusal and preserve their first owner"
  : "concurrent native fixtures retain port ownership through startup and release it after stop", { timeout: 60000 }, async t => {
  const context = new AsyncLocalStorage();
  const spawn = childProcess.spawn, createServer = net.createServer;
  const children = [], stores = [], pending = [], stopped = new Set();
  let peerSelections = 0;
  let firstPort, selectedSecond = false, selectedThird = false, firstSpawn;
  const spawned = new Promise(resolve => { firstSpawn = resolve; });
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGCONT");
    const results = await Promise.allSettled(pending);
    for (const result of results) if (result.status === "fulfilled" && !stores.includes(result.value)) stores.push(result.value);
    await Promise.all(stores.filter(store => !stopped.has(store)).map(store => store.stop()));
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(net, "createServer", (...args) => {
    const server = createServer(...args), listen = server.listen;
    const owner = context.getStore();
    server.listen = function(port, ...rest) {
      if (owner === "second") {
        peerSelections++;
        if (exhausted || !selectedSecond) { selectedSecond = true; port = firstPort; }
      }
      if (owner === "third" && !selectedThird) { selectedThird = true; port = firstPort; }
      return listen.call(this, port, ...rest);
    };
    return server;
  });
  t.mock.method(childProcess, "spawn", (binary, args, options) => {
    const ports = args.filter(arg => /^-(s3|master|volume|filer)\.port(?:\.grpc)?=/.test(arg)).map(arg => Number(arg.split("=")[1]));
    if (context.getStore() === "second") {
      assert.ok(!ports.includes(firstPort), "a peer must not claim the first child's released but still owned port");
      children[0].kill("SIGCONT");
    }
    if (context.getStore() === "third") assert.ok(ports.includes(firstPort), "stopping the original owner must release its port claim");
    const child = context.getStore() === "first"
      ? spawn("sh", ["-c", 'kill -STOP $$; exec "$@"', "sh", binary, ...args], options)
      : spawn(binary, args, options);
    children.push(child);
    if (context.getStore() === "first") { firstPort = ports[0]; firstSpawn(); }
    return child;
  });
  syncBuiltinESMExports();
  const { startBackupStorage } = await import("./backup-storage-fixture.mjs");
  const first = context.run("first", () => startBackupStorage({ retryPortCollision: false }));
  pending.push(first);
  await spawned;
  const deadline = Date.now() + 5000;
  while (!childProcess.execFileSync("ps", ["-o", "stat=", "-p", String(children[0].pid)], { encoding: "utf8" }).includes("T")) {
    assert.ok(Date.now() < deadline, "the owned child must stop before the peer selects ports");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  if (!exhausted) {
    const { stdout } = await promisify(childProcess.execFile)(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import net from "node:net";
      import childProcess from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      import {mkdtemp, cp, rm} from "node:fs/promises";
      import {tmpdir} from "node:os";
      import {join} from "node:path";
      const temporary = await mkdtemp(join(tmpdir(), "storage-port-peer-"));
      await cp(join(tmpdir(), "waitron-cloud-test-binaries"), join(temporary, "waitron-cloud-test-binaries"), {recursive:true});
      process.env.TMPDIR = process.env.TMP = process.env.TEMP = temporary;
      const create = net.createServer, spawn = childProcess.spawn;
      const occupied = ${firstPort};
      let tried = false;
      net.createServer = (...args) => {
        const server = create(...args), listen = server.listen;
        server.listen = function(port, ...rest) {
          if (!tried) { tried = true; port = occupied; }
          return listen.call(this, port, ...rest);
        };
        return server;
      };
      childProcess.spawn = (binary, args, options) => {
        const ports = args.filter(arg => /^-(s3|master|volume|filer)\\.port(?:\\.grpc)?=/.test(arg)).map(arg => Number(arg.split("=")[1]));
        assert.ok(!ports.includes(occupied), "another process must respect a paused fixture's port claim");
        return spawn(binary, args, options);
      };
      syncBuiltinESMExports();
      const {startBackupStorage} = await import("./scripts/backup-storage-fixture.mjs");
      let storage;
      try {
        storage = await startBackupStorage({retryPortCollision:false});
        assert.equal((await storage.bucket("cross-process-port-owner")).endpoint, storage.endpoint);
      } finally { await storage?.stop(); await rm(temporary, {recursive:true, force:true}); }
      console.log("peer stopped");
    `], { cwd: new URL("..", import.meta.url), timeout: 20000 });
    assert.equal(stdout, "peer stopped\n");
  }
  const second = context.run("second", () => startBackupStorage({ retryPortCollision: false }));
  pending.push(second);
  if (exhausted) {
    await assert.rejects(second, /Could not reserve unclaimed storage ports/);
    assert.equal(peerSelections, 256, "claim conflicts must stop selecting after the bounded allocation budget");
    children[0].kill("SIGCONT");
    const a = await first;
    stores.push(a);
    assert.equal((await a.bucket("surviving-port-owner")).endpoint, a.endpoint);
    assert.equal(children.length, 1, "claim exhaustion must refuse before spawning another child");
    return;
  }
  const [a, b] = await Promise.all([first, second]);
  stores.push(a, b);
  assert.equal((await a.bucket("first-port-owner")).endpoint, a.endpoint);
  assert.equal((await b.bucket("second-port-owner")).endpoint, b.endpoint);
  const root = a.root;
  await a.stop();
  stopped.add(a);
  await assert.rejects(access(root), { code: "ENOENT" });
  const third = context.run("third", () => startBackupStorage({ retryPortCollision: false }));
  pending.push(third);
  const c = await third;
  stores.push(c);
  assert.equal((await c.bucket("released-port-owner")).endpoint, c.endpoint);
  assert.equal(children.length, 3, "ownership must not depend on a startup retry");
});
