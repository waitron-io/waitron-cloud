import {RemoteAccessStore} from '../packages/remote-access/src/placement.ts';
import assert from "node:assert/strict";
import { request as httpsRequest } from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm, realpath, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  generateKeyPairSync,
  createHash,
  createPrivateKey,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startPortalFixture } from "../apps/portal/test/fixtures.ts";
import {
  SignupStore,
  PairingStore,
  InstallationStore,
  transaction,
} from "../packages/registration/src/index.ts";
import { login } from "../packages/identity/src/index.ts";
import { BackupKeyVault } from "../packages/backups/src/keys.ts";
import { BackupObjects, receipt } from "../packages/backups/src/storage.ts";
import { BackupWorker } from '../packages/backups/src/worker.ts';
import { createWaitronVerifier } from '../packages/backups/src/waitron-verifier.ts';
import { BackupCatalogue } from "../packages/backups/src/catalogue.ts";
import {
  BackupRecovery,
  recoveryPayload,
  streamRecoveryDigest,
} from "../packages/backups/src/recovery.ts";
import { startBackupStorage } from "./backup-storage-fixture.mjs";
import { localLitestreamBinary } from "./backup-stream-probe.mjs";
import { verifyManagedRecoveryReceipt } from "./verify-managed-recovery-receipt.mjs";
import { DatabaseSync } from "node:sqlite";
const checkout = process.env.WAITRON_CHECKOUT;
assert(checkout, "Set WAITRON_CHECKOUT");
const waitron = resolve(checkout),
  require = createRequire(join(waitron, "apps/server/package.json"));
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const roots = [],
  children = [],
  objectClients = [],
  checks = [];
let f, s3, litestreamDebug;
const vault = new BackupKeyVault(randomBytes(32));
const clients = new Map();
const objects = (l) => {
 if (!clients.has(l.bucket)) {const client=new BackupObjects(l,s3.admin,s3.ca);clients.set(l.bucket,client);objectClients.push(client);}
 return clients.get(l.bucket);
};
async function captureClient(dir,command,input){
 const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(waitron,'apps/server/scripts/cloud-capture-client-fixture.ts')],{cwd:join(waitron,'apps/server'),env:{...process.env,CLOUD_TEST_ROOT:dir},stdio:['pipe','pipe','pipe']});
 let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error=(error+v).slice(-16000));child.stdin.end(JSON.stringify({command,...input}));
 const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
 try{const code=await new Promise(r=>child.once('exit',r));assert.equal(code,0,'Waitron capture client failed: '+error);return JSON.parse(output.trim().split('\n').at(-1));}finally{clearTimeout(timer);}
}
async function recoveryClient(dir,command,input={}){
 const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(waitron,'apps/server/scripts/cloud-recovery-client-fixture.ts')],{cwd:join(waitron,'apps/server'),env:{...process.env,CLOUD_TEST_ROOT:dir},stdio:['pipe','pipe','pipe']});
 let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error=(error+v).slice(-16000));child.stdin.end(JSON.stringify({command,origin:f.origin,storageCaBase64:Buffer.from(s3.ca).toString('base64'),...input}));
 const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
 try{const code=await new Promise(r=>child.once('exit',r));assert.equal(code,0,'Waitron recovery client failed: '+error);return JSON.parse(output.trim().split('\n').at(-1));}finally{clearTimeout(timer);}
}
const record = (value) => {
  checks.push(value);
  console.log("PASS:", value);
};
async function root() {
  const dir = await mkdtemp(join(tmpdir(), "cloud-integration-backup-"));
  roots.push(dir);
  return dir;
}
const shellSingle = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
async function trustedLitestream(realBinary) {
  const wrapper = join(s3.root, "trusted-litestream");
  litestreamDebug = join(s3.root, "litestream.log");
  const dockerImage =
    "node@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4";
  const command =
    process.platform === "darwin"
      ? `case "$1" in\n  replicate|restore) sed -i.bak 's/127\\.0\\.0\\.1/host.docker.internal/g' "$3" ;;\nesac\nexec docker run --rm -v /var/folders:/var/folders -e WAITRON_STREAM_ACCESS_KEY_ID -e WAITRON_STREAM_SECRET_ACCESS_KEY -e SSL_CERT_FILE=${shellSingle(join(s3.root, "cert.pem"))} ${shellSingle(dockerImage)} ${shellSingle(realBinary)} "$@"`
      : `exec env SSL_CERT_FILE=${shellSingle(join(s3.root, "cert.pem"))} ${shellSingle(realBinary)} "$@"`;
  await writeFile(
    wrapper,
    `#!/bin/sh\nif [ "$1" = replicate ]; then\n  ${command} >>${shellSingle(litestreamDebug)} 2>&1\nfi\n${command}\n`,
    { mode: 0o700 },
  );
  await chmod(wrapper, 0o700);
  return wrapper;
}
async function launch(dir, extraEnv = {}) {
  await rm(join(dir, "ready.json"), { force: true });
  const child = spawn(
    process.execPath,
    [
      "--import",
      require.resolve("tsx"),
      join(waitron, "apps/server/scripts/cloud-integration-fixture.ts"),
    ],
    {
      cwd: join(waitron, "apps/server"),
      env: {
        ...process.env,
        ...extraEnv,
        CLOUD_TEST_ROOT: dir,
        CLOUD_TEST_ORIGIN: f.origin,
        CLOUD_TEST_BACKUP_STATE: "1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (v) => (output = (output + v).slice(-16000)));
  const running = { child, done: new Promise((r) => child.once("exit", r)) };
  children.push(running);
  for (let n = 0; n < 300; n++) {
    if (child.exitCode !== null) throw Error(output);
    try {
      return {
        ...running,
        logs: () => output,
        ...JSON.parse(await readFile(join(dir, "ready.json"), "utf8")),
      };
    } catch (e) {
      if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
    await delay(100);
  }
  throw Error("Waitron startup timeout");
}
function databaseHead(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return createHash("sha256")
      .update(
        JSON.stringify({
          locations: db.prepare("SELECT id,name FROM locations ORDER BY id").all(),
          nodes: db
            .prepare("SELECT id,location_id,public_key FROM nodes ORDER BY id")
            .all(),
        }),
      )
      .digest("hex");
  } finally {
    db.close();
  }
}
async function machine(dir, action, body) {
  const state = JSON.parse(
      await readFile(join(dir, "cloud-connection.json"), "utf8"),
    ),
    pending = {
      action,
      operationId: randomUUID(),
      lease: JSON.stringify(state.lifecycle.lease),
      body: JSON.stringify(body),
    },
    bytes = Buffer.from(
      JSON.stringify([
        "waitron-cloud-machine-v1",
        f.origin,
        pending.action,
        state.view.registration.installationId,
        pending.operationId,
        Date.now(),
        pending.lease,
        pending.body,
      ]),
    ),
    signature = sign(
      null,
      bytes,
      createPrivateKey({
        key: Buffer.from(state.privateKey, "base64url"),
        format: "der",
        type: "pkcs8",
      }),
    ).toString("base64url");
  const response = await fetch(`${f.origin}/api/installations/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: bytes.toString("base64url"), signature }),
  });
  if (!response.ok)
    throw Object.assign(
      Error(`managed stream ${action} failed: ${response.status} ${await response.text()}`),
      { status: response.status },
    );
  return response.json();
}
async function denied(work) {
  try {
    await work();
    return false;
  } catch (error) {
    return error?.$metadata?.httpStatusCode === 403;
  }
}
async function prepareWaitronStreamIdentity(dir, nodeId, env) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      require.resolve("tsx"),
      join(import.meta.dirname, "prepare-waitron-stream-fixture.mjs"),
    ],
    {
      cwd: join(waitron, "apps/server"),
      env: { ...process.env, WAITRON_CHECKOUT: waitron },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    error = "";
  child.stdout.on("data", (value) => (output += value));
  child.stderr.on("data", (value) => (error = (error + value).slice(-16000)));
  child.stdin.end(JSON.stringify({ root: dir, nodeId, env }));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, error);
  assert.equal(JSON.parse(output.trim().split("\n").at(-1)).prepared, true);
}
async function restoreFromKit(target, kit, litestream, migrationsRoot, interrupt = false) {
  const kitPath = join(target, "recovery-kit.txt");
  await writeFile(kitPath, kit + "\n", { mode: 0o600 });
  let bin = litestream;
  if (interrupt) {
    bin = join(target, "slow-litestream");
    await writeFile(bin, "#!/bin/sh\nsleep 30\n", { mode: 0o700 });
    await chmod(bin, 0o700);
  }
  const child = spawn(
    process.execPath,
    [
      "--import",
      require.resolve("tsx"),
      join(waitron, "apps/server/src/bin-restore.ts"),
      "restore",
      "--from-bucket",
      kitPath,
      "--confirm-venue",
      "73000001K",
      "--confirm-old-box-gone",
    ],
    {
      cwd: join(waitron, "apps/server"),
      detached: interrupt,
      env: {
        ...process.env,
        WAITRON_ENV: "preproduction",
        WAITRON_STATE_DIR: join(target, "state"),
        WAITRON_VENUE_DIR: join(target, "venue"),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_LITESTREAM_BIN: bin,
        SSL_CERT_FILE: join(s3.root, "cert.pem"),
        NODE_EXTRA_CA_CERTS: join(s3.root, "cert.pem"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => (output = (output + chunk).slice(-16000)));
  if (interrupt) {
    await delay(500);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  const code = await new Promise((resolve) =>
    child.once("exit", (exit, signal) => resolve({ exit, signal })),
  );
  return { ...code, output };
}
async function stop(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  const timer = setTimeout(() => server.child.kill("SIGKILL"), 5000);
  try {
    const code=await server.done;
    assert(code===0||(code===null&&server.child.signalCode==='SIGTERM'));
  } finally {
    clearTimeout(timer);
  }
}
async function worker(dir, command, input) {
  const child = spawn(
    process.execPath,
    [
      "--permission",
      "--allow-fs-read=*",
      "--allow-fs-write=" + (await realpath(dir)),
      "--allow-worker",
      "--allow-child-process",
      "--allow-addons",
      "--import",
      require.resolve("tsx"),
      join(waitron, "apps/server/scripts/cloud-backup-fixture.ts"),
    ],
    {
      cwd: join(waitron, "apps/server"),
      env: { ...process.env, TSX_DISABLE_CACHE: "1", CLOUD_TEST_ROOT: dir },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let output = "",
    error = "";
  child.stdout.on("data", (v) => (output += v));
  child.stderr.on("data", (v) => (error = (error + v).slice(-16000)));
  child.stdin.end(JSON.stringify({ command, ...input }));
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  try {
    const code = await new Promise((r) => child.once("exit", r));
    if (code !== 0) throw Error("Waitron backup worker: " + error);
    return JSON.parse(output.trim().split("\n").at(-1));
  } finally {
    clearTimeout(timer);
  }
}
try {
  s3 = await startBackupStorage();
  const litestreamPlatform=process.platform==='darwin'?`linux-${execFileSync('docker',['info','--format','{{.Architecture}}'],{encoding:'utf8'}).trim()==='aarch64'?'arm64':'x64'}`:undefined;
  const litestream=await trustedLitestream(await localLitestreamBinary(s3.root,litestreamPlatform));
  f = await startPortalFixture({vault,objects,grant:(location,scope)=>s3.authority.grant(location,scope,s3.ca),managedStreams:s3.managedStreams});
  const signup = new SignupStore(f.db.pool, f.db.outbox),
    email = "backups-" + randomUUID() + "@example.test",
    password = "Cloud backup integration password";
  await signup.request(email);
  const mail = f.db.outbox.open(
    (await f.db.pool.query("SELECT * FROM email_outbox")).rows[0],
  );
  const owner = await signup.complete(mail.token, {
      password,
      organisationName: "Backup test",
      legalBusinessName: "Backup test SL",
      countryCode: "ES",
    }),
    session = await transaction(f.db.pool, (c) =>
      login(c, { email, password }),
    );
  const catalogue = new BackupCatalogue(f.db.pool, vault, objects),
    recovery = new BackupRecovery(f.db.pool, vault, f.origin),
    venues = [];
  for (let n = 0; n < 2; n++) {
    const dir = await root(),
      server = await launch(dir),
      ca = await readFile(join(dir, "tls", "ca.crt"));
    let cookie = "";
    const local = (method,path, data) =>
      new Promise((done, fail) => {
        const body = data===undefined?'':JSON.stringify(data),
          url = new URL(server.origin + path);
        const req = httpsRequest(
          url,
          {
            ca,
            agent: false,
            method,
            headers: {
              Origin: server.origin,
              Cookie: cookie,
              ...(data===undefined?{}:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}),
            },
          },
          (res) => {
            let text = "";
            res.on("data", (v) => (text += v));
            res.on("end", () => {
              try {
                assert.equal(res.statusCode, 200, text);
                if (res.headers["set-cookie"])
                  cookie = res.headers["set-cookie"]
                    .map((c) => c.split(";")[0])
                    .join("; ");
                done(JSON.parse(text));
              } catch (e) {
                fail(e);
              }
            });
          },
        );
        req.on("error", fail);
        req.setTimeout(10000, () =>
          req.destroy(Error("local request timeout")),
        );
        req.end(body);
      });
    const post=(path,data={})=>local('POST',path,data),put=(path,data)=>local('PUT',path,data),get=(path)=>local('GET',path);
    await post("/management-api/session", {
      email: "owner@example.test",
      password: "Local integration password",
    });
    const pairing = await post("/management-api/cloud/start");
    await new PairingStore(f.db.pool).approve(
      pairing.requestId,
      pairing.code,
      owner.organisationId,
      owner.legalBusinessId,
      session.token,
      session.csrfToken,
    );
    await post("/management-api/cloud/check");
    const paired = await post("/management-api/cloud/complete", {
      requestId: pairing.requestId,
      organisationId: owner.organisationId,
      legalBusinessId: owner.legalBusinessId,
    });
    const location = await s3.bucket("venue-" + n);
    await catalogue.provision(paired.registration.installationId, location);
    venues.push({
      root: dir,
      server,
      registration: paired.registration,
      location,
      localVenueId:server.localVenueId,
      post,put,get,
    });
  }
  record(
    "two real Waitron servers paired through manager sessions and Cloud owner approval",
  );
  const snapshots = [];
  for (const venue of venues) {
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(Error("CSR timeout")), 10000);
      venue.server.child.once("message", (m) => {
        clearTimeout(timer);
        m.csr ? done() : fail(Error("CSR failed"));
      });
      venue.server.child.send({
        csrHostname: "backup-" + randomUUID() + ".example.test",
      });
    });
    assert((await readFile(join(venue.root, "cloud-staff.key"))).length > 0);
    await writeFile(
      join(venue.root, "backup.env"),
      "WAITRON_BACKUP_DIR=/old-backup-target\n",
      { mode: 0o600 },
    );
    const captureId=randomUUID();
    const reservation=await captureClient(venue.root,'reserve',{id:captureId});
    assert.equal(reservation.installationId,venue.registration.installationId);
    const internal=await catalogue.reserveCapture(venue.registration.installationId,captureId);
    assert.equal(reservation.recoveryKey,internal.keys.recoveryKey);
    const captured = await worker(venue.root, "capture", {
      recoveryKey: reservation.recoveryKey,
    });
    assert(captured.networkDenied);
    assert(captured.entries.includes("secrets/backup.env"));
    assert(
      !captured.entries.some(
        (n) => n.includes("cloud-connection") || n.includes("cloud-staff.key"),
      ),
    );
    const bytes = await readFile(join(venue.root, "captured.backup.enc"));
    await captureClient(venue.root,'upload',{grant:reservation,ca:s3.ca});
    // Lost upload replies repeat the write without needing read permission.
    await captureClient(venue.root,'upload',{grant:reservation,ca:s3.ca});
    const metadata={...receipt(bytes),capturedAt:captured.manifest.createdAt,retention:'daily',sourceNodeId:captured.sourceNodeId,modules:captured.manifest.modules};
    const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
    await writeFile(join(venue.root,'captured.backup.enc'),changed,{mode:0o600});
    try{
      await captureClient(venue.root,'upload',{grant:reservation,ca:s3.ca});
      assert.equal(receipt(await objects(venue.location).read(reservation.incomingKey)).digest,metadata.digest);
      await assert.rejects(captureClient(venue.root,'publish',{id:reservation.id,metadata:{...metadata,...receipt(changed)}}));
      assert.equal((await f.db.pool.query('SELECT count(*) FROM backup_points WHERE id=$1',[reservation.id])).rows[0].count,'0');
    }finally{await writeFile(join(venue.root,'captured.backup.enc'),bytes,{mode:0o600});}
    const point=await captureClient(venue.root,'publish',{id:reservation.id,metadata});
    assert.deepEqual(await captureClient(venue.root,'publish',{id:reservation.id,metadata}),point);
    let result;
    const restore = await createWaitronVerifier(waitron);
    const queue = new BackupWorker(f.db.pool, catalogue, async (...args) => {
      const checked = await restore(...args);
      assert(checked.networkDenied);
      assert(checked.childProcessDenied);
      assert(checked.hostReadDenied);
      assert(checked.outsideWriteDenied);
      assert(checked.integrityOk);
      assert(checked.hooks.includes("fiscal-verifactu"));
      assert.equal(checked.cloudCredentialPresent, false);
      assert.equal(checked.staffKeyPresent, false);
      if(args[2].id===point.id)result=checked;
    });
    await queue.schedule();
    const deadline=Date.now()+60000;
    while(!result&&Date.now()<deadline){
      if(!await queue.runOnce())await delay(50);
      const targetJob=(await f.db.pool.query("SELECT last_error FROM backup_jobs WHERE kind='verify' AND target_id=$1",[point.id])).rows[0];
      assert.equal(targetJob?.last_error,null,'Snapshot worker failed during the local proof');
    }
    assert(result, 'Persistent worker must restore the real snapshot');
    const saved = await f.db.pool.query('SELECT verification FROM backup_points WHERE id=$1',[point.id]);
    assert.equal(saved.rows[0].verification,'verified');
    // Keep the independent fixture's venue-content assertion as well as queue verification.
    const target = await root();
    await writeFile(join(target,'input.backup.enc'),bytes,{mode:0o600});
    await worker(target,'restore',{recoveryKey:reservation.recoveryKey,sourceNodeId:point.sourceNodeId,modules:point.modules,expectedVenue:captured.venueName});
    snapshots.push({ venue, reservation, point, captured, bytes, result,streamKey:internal.keys.streamKey });
  }
  record(
    "both encrypted snapshots restored by Waitron with integrity/schema checks and module hooks while network, subprocess, host-read and outside-write permissions were denied",
  );
  for (const item of snapshots) await stop(item.venue.server);
  for (const item of snapshots) {
    // The fixture owns the stopped venue exclusively, then exits before publication.
    await assert.rejects(captureClient(item.venue.root, 'schedule', {ca:s3.ca,crashAfterUpload:true}), /Waitron capture client failed/);
    const pending = JSON.parse(await readFile(join(item.venue.root,'cloud-snapshots/state.json'),'utf8')).pending;
    assert(pending?.metadata);
    const bytes = await readFile(join(item.venue.root,'cloud-snapshots/archive.enc'));
    assert.deepEqual(receipt(bytes),{digest:pending.metadata.digest,size:pending.metadata.size});
    const grant = await captureClient(item.venue.root,'reserve',{id:pending.id});
    const resumed = await captureClient(item.venue.root,'schedule',{ca:s3.ca});
    assert.equal(resumed.created,0,'Restart must reuse the persisted ciphertext');
    assert.equal(resumed.point.id,pending.id);
    assert.equal(resumed.point.digest,pending.metadata.digest);
    assert.equal(resumed.point.retention,'monthly');
    const idle = await captureClient(item.venue.root,'schedule',{ca:s3.ca});
    assert.equal(idle.created,0,'Restart before the next due time must not make another copy');
    const target = await root();
    await writeFile(join(target,'input.backup.enc'),bytes,{mode:0o600});
    await worker(target,'restore',{recoveryKey:grant.recoveryKey,sourceNodeId:resumed.point.sourceNodeId,modules:resumed.point.modules,expectedVenue:item.captured.venueName});
  }
  record('scheduled production archives survive a process crash after upload, resume byte-for-byte without recapture and restore independently');
  const streamViews = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const envPath = join(snapshot.venue.root, "fixture-env.json"),
      saved = JSON.parse(await readFile(envPath, "utf8"));
    await prepareWaitronStreamIdentity(
      snapshot.venue.root,
      snapshot.point.sourceNodeId,
      saved,
    );
    saved.WAITRON_LITESTREAM_BIN = litestream;
    await writeFile(envPath, JSON.stringify(saved), { mode: 0o600 });
    await writeFile(
      join(snapshot.venue.root, "backup.env"),
      `WAITRON_BACKUP_RECOVERY_KEY=${randomBytes(32).toString("base64url")}\n`,
      { mode: 0o600 },
    );
    snapshot.venue.server = await launch(snapshot.venue.root, {
      SSL_CERT_FILE: join(s3.root, "cert.pem"),
      NODE_EXTRA_CA_CERTS: join(s3.root, "cert.pem"),
    });
    await snapshot.venue.post("/management-api/session", {
      email: "owner@example.test",
      password: "Local integration password",
    });
    await delay(500);
    const source = new DatabaseSync(join(snapshot.venue.root, "venue", "venue.db"), {
        readOnly: true,
      }),
      signer = source
        .prepare("SELECT public_key FROM nodes WHERE id=?")
        .get(snapshot.point.sourceNodeId)?.public_key;
    source.close();
    assert(signer);
    const cloudState = JSON.parse(
        await readFile(join(snapshot.venue.root, "cloud-connection.json"), "utf8"),
      ),
      configured = await machine(snapshot.venue.root, "backup-stream-configure", {
        revision: cloudState.lifecycle.view.revision,
        localVenueId: snapshot.venue.localVenueId,
        sourceNodeId: snapshot.point.sourceNodeId,
        pointerSignerPublicKey: signer,
      });
    await writeFile(
      join(snapshot.venue.root, "backup.env"),
      `WAITRON_BACKUP_RECOVERY_KEY=${configured.recoveryKey}\n`,
      { mode: 0o600 },
    );
    await snapshot.venue.put("/api/backup/stream", configured.bucket);

    const attachedBy = Date.now() + 10_000;
    while (Date.now() < attachedBy) {
      const log = await readFile(litestreamDebug, "utf8").catch(() => "");
      if (log.includes(`bucket=${configured.bucket.bucket}`)) break;
      await delay(100);
    }
    const db = new DatabaseSync(join(snapshot.venue.root, "venue", "venue.db"));
    try {
      db.exec("PRAGMA busy_timeout=5000");
      assert.equal(
        db
          .prepare("UPDATE locations SET name=?")
          .run(`Cloud Test Venue stream ${index + 1}`).changes,
        1,
      );
    } finally {
      db.close();
    }

    let streamStatus;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      streamStatus = await snapshot.venue.get("/api/backup/stream");
      if (
        streamStatus.status?.state === "streaming" &&
        streamStatus.status.lastConfirmedUploadAt
      )
        break;
      await delay(1_000);
    }
    const streamLog = await readFile(litestreamDebug, "utf8").catch(
        () => "(no Litestream output)",
      ),
      storeLog = await readFile(join(s3.root, "store.log"), "utf8").catch(
        () => "(no store output)",
      );
    assert.equal(
      streamStatus?.status?.state,
      "streaming",
      `${JSON.stringify(streamStatus)}\n${snapshot.venue.server.logs()}\n${streamLog}\n${storeLog.slice(-16_000)}`,
    );

    let observed;
    for (let attempt = 0; attempt < 5 && !observed; attempt++) {
      try {
        observed = await machine(snapshot.venue.root, "backup-stream-observe", {});
      } catch (error) {
        if (![409, 503].includes(error.status)) throw error;
      }
      if (!observed) await delay(2_000);
    }
    assert(
      observed?.recoverableAt,
      `Managed stream observation timed out: ${JSON.stringify(streamStatus)}`,
    );
    const row = (
        await f.db.pool.query(
          "SELECT generation FROM backup_managed_streams WHERE venue_id=$1",
          [snapshot.venue.registration.venueId],
        )
      ).rows[0],
      pointerKey = `${configured.bucket.prefix}venues/${snapshot.venue.localVenueId}/current.json`,
      pointer = JSON.parse(
        (
          await s3.managedStreams.read(
            `managed:${snapshot.venue.registration.venueId}:reader`,
            snapshot.venue.location,
            pointerKey,
          )
        ).toString(),
      );
    assert.equal(pointer.body.generation, row.generation);
    assert.equal(pointer.body.writtenAt, observed.recoverableAt);
    streamViews.push({
      snapshot,
      configured,
      observed,
      pointer,
      sourceHead: databaseHead(join(snapshot.venue.root, "venue", "venue.db")),
    });
  }

  const first = streamViews[0],
    writer = new S3Client({
      endpoint: first.configured.bucket.endpoint,
      region: first.configured.bucket.region,
      credentials: {
        accessKeyId: first.configured.bucket.accessKeyId,
        secretAccessKey: first.configured.bucket.secretAccessKey,
      },
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: { httpsAgent: s3.agent() },
    }),
    readerCredentials = await s3.managedStreams.reader({
      reference: `managed:${first.snapshot.venue.registration.venueId}:reader`,
      venueId: first.snapshot.venue.registration.venueId,
      location: first.snapshot.venue.location,
      prefix: first.configured.bucket.prefix,
    }),
    readerClient = new S3Client({
      endpoint: first.configured.bucket.endpoint,
      region: first.configured.bucket.region,
      credentials: readerCredentials,
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: { httpsAgent: s3.agent() },
    }),
    other = streamViews[1],
    otherKey = `${other.configured.bucket.prefix}venues/${other.snapshot.venue.localVenueId}/current.json`,
    otherGeneration = other.pointer.body.generation;
  const isolation = {
    crossVenueReadDenied: await denied(() =>
      writer.send(
        new GetObjectCommand({
          Bucket: other.snapshot.venue.location.bucket,
          Key: otherKey,
        }),
      ),
    ),
    crossVenueWriteDenied: await denied(() =>
      writer.send(
        new PutObjectCommand({
          Bucket: other.snapshot.venue.location.bucket,
          Key: `${other.configured.bucket.prefix}crossed`,
          Body: "forbidden",
        }),
      ),
    ),
    crossVenueListDenied: await denied(() =>
      writer.send(
        new ListObjectsV2Command({
          Bucket: other.snapshot.venue.location.bucket,
          Prefix: other.configured.bucket.prefix,
        }),
      ),
    ),
    readerWriteDenied: await denied(() =>
      readerClient.send(
        new PutObjectCommand({
          Bucket: first.snapshot.venue.location.bucket,
          Key: `${first.configured.bucket.prefix}reader-write`,
          Body: "forbidden",
        }),
      ),
    ),
    otherVenueGenerationUnchanged: false,
  };
  writer.destroy();
  readerClient.destroy();
  const otherAfter = JSON.parse(
    (
      await s3.managedStreams.read(
        `managed:${other.snapshot.venue.registration.venueId}:reader`,
        other.snapshot.venue.location,
        otherKey,
      )
    ).toString(),
  );
  isolation.otherVenueGenerationUnchanged =
    otherAfter.body.generation === otherGeneration;
  assert(Object.values(isolation).every(Boolean));
  record(
    "static SeaweedFS writer and reader identities stay inside one venue prefix; crossed reads, writes and listings are denied",
  );

  for (const entry of streamViews) await stop(entry.snapshot.venue.server);
  const continuousEntry = streamViews[0],
    continuousKey = generateKeyPairSync("ed25519"),
    continuousId = randomUUID();
  await recovery.start(session.token, session.csrfToken, {
    id: continuousId,
    source: "continuous",
    venueId: continuousEntry.snapshot.venue.registration.venueId,
    mode: "failure",
    targetPublicKey: continuousKey.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    oldServerUnavailable: true,
    acceptDataLoss: true,
  });
  const continuousDigest = streamRecoveryDigest(continuousEntry.pointer.body.generation),
    continuousProof = (action) => {
      const bytes = recoveryPayload(
        f.origin,
        continuousId,
        action,
        action === "info" ? "" : continuousDigest,
        Date.now(),
      );
      return {
        payload: bytes.toString("base64url"),
        signature: sign(null, bytes, continuousKey.privateKey).toString("base64url"),
      };
    },
    targetPost = async (action) => {
      const response = await fetch(`${f.origin}/api/recovery/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: continuousId, ...continuousProof(action) }),
      });
      assert.equal(response.status, 200, `${action}: ${await response.clone().text()}`);
      return response.json();
    },
    info = await targetPost("info");
  assert.equal(info.source.generation, undefined);
  assert.equal(info.source.sourceDigest, continuousDigest);
  const continuousAccess = await targetPost("read");
  assert.match(continuousAccess.recoveryKit, /^WAITRON-RECOVERY-KIT-1:/);

  const continuousTarget = await root(),
    interrupted = await restoreFromKit(
      continuousTarget,
      continuousAccess.recoveryKit,
      litestream,
      join(continuousEntry.snapshot.venue.root, "migrations"),
      true,
    );
  assert(interrupted.signal || interrupted.exit !== 0);
  await assert.rejects(readFile(join(continuousTarget, "venue", "venue.db")));
  const retried = await restoreFromKit(
      continuousTarget,
      continuousAccess.recoveryKit,
      litestream,
      join(continuousEntry.snapshot.venue.root, "migrations"),
    ),
    restoredHead = databaseHead(join(continuousTarget, "venue", "venue.db"));
  assert.equal(retried.exit, 0, retried.output);
  assert.equal(restoredHead, continuousEntry.sourceHead);
  await recovery.target(continuousId, "restored", continuousProof("restored"));
  await recovery.close(session.token, session.csrfToken, continuousId);
  record(
    "the latest Cloud-observed generation cold-restored through Waitron after an interrupted first attempt, with the exact source database head",
  );

  const fallbackEntry = streamViews[1],
    admin = new S3Client({
      endpoint: fallbackEntry.snapshot.venue.location.endpoint,
      region: fallbackEntry.snapshot.venue.location.region,
      credentials: s3.admin,
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: { httpsAgent: s3.agent() },
    }),
    listed = await admin.send(
      new ListObjectsV2Command({
        Bucket: fallbackEntry.snapshot.venue.location.bucket,
        Prefix: fallbackEntry.configured.bucket.prefix,
      }),
    );
  for (const object of listed.Contents ?? [])
    if (object.Key)
      await admin.send(
        new DeleteObjectCommand({
          Bucket: fallbackEntry.snapshot.venue.location.bucket,
          Key: object.Key,
        }),
      );
  admin.destroy();

  const fallbackKey = generateKeyPairSync("ed25519"),
    fallbackId = randomUUID();
  await recovery.start(session.token, session.csrfToken, {
    id: fallbackId,
    source: "snapshot",
    pointId: fallbackEntry.snapshot.point.id,
    mode: "failure",
    targetPublicKey: fallbackKey.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    oldServerUnavailable: true,
    acceptDataLoss: true,
  });
  const fallbackProof = (action) => {
      const bytes = recoveryPayload(
        f.origin,
        fallbackId,
        action,
        fallbackEntry.snapshot.point.digest,
        Date.now(),
      );
      return {
        payload: bytes.toString("base64url"),
        signature: sign(null, bytes, fallbackKey.privateKey).toString("base64url"),
      };
    },
    fallbackAccess = await recovery.target(fallbackId, "read", fallbackProof("read")),
    fallbackGrant = await s3.authority.grant(
      fallbackAccess.location,
      {
        kind: "restore",
        bucket: fallbackAccess.location.bucket,
        scope: fallbackAccess.point.objectKey,
      },
      s3.ca,
    ),
    fallbackReader = new BackupObjects(
      fallbackAccess.location,
      fallbackGrant.credentials,
      s3.ca,
    ),
    fallbackTarget = await root();
  try {
    await writeFile(
      join(fallbackTarget, "input.backup.enc"),
      await fallbackReader.read(fallbackAccess.point.objectKey),
      { mode: 0o600 },
    );
  } finally {
    fallbackReader.close();
  }
  const fallbackRestored = await worker(fallbackTarget, "restore", {
    recoveryKey: fallbackAccess.keys.recoveryKey,
    sourceNodeId: fallbackAccess.point.sourceNodeId,
    modules: fallbackAccess.point.modules,
    expectedVenue: fallbackEntry.snapshot.captured.venueName,
  });
  assert(fallbackRestored.integrityOk);
  await recovery.target(fallbackId, "restored", fallbackProof("restored"));
  await recovery.close(session.token, session.csrfToken, fallbackId);
  record(
    "deleting one venue continuous source leaves the other venue intact and its explicit verified-snapshot fallback restores independently",
  );
  const item = snapshots[0];
  const remote=new RemoteAccessStore(f.db.pool),cell=randomUUID();
  await remote.createCell({id:cell,country:'ES',provider:'aws',environment:'test',suffix:'replacement.example.test',subnet:83,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  const oldPlacement=await remote.provision(item.venue.registration.installationId,cell,randomBytes(32).toString('base64'));
  const neighbour=await remote.provision(snapshots[1].venue.registration.installationId,cell,randomBytes(32).toString('base64'));
  await catalogue.rotate(item.venue.registration.installationId);
  const renewed=await captureClient(item.venue.root,'reserve',{id:item.reservation.id});
  assert.equal(renewed.recoveryKey,item.reservation.recoveryKey);
  record('Waitron signed HTTP capture, scoped upload retries, changed-byte publication refusal, publication retries and credential renewal after key rotation');
  const targetKey = generateKeyPairSync("ed25519"),
    operationId = randomUUID();
  await recovery.start(session.token, session.csrfToken, {
    id: operationId,
    pointId: item.point.id,
    mode: "failure",
    targetPublicKey: targetKey.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    oldServerUnavailable: true,
    acceptDataLoss: true,
  });
  const proof = (action) => {
    const bytes = recoveryPayload(
      f.origin,
      operationId,
      action,
      item.point.digest,
      Date.now(),
    );
    return {
      payload: bytes.toString("base64url"),
      signature: sign(null, bytes, targetKey.privateKey).toString("base64url"),
    };
  };
  const access = await recovery.target(operationId, "read", proof("read"));
  assert.equal(access.keys.recoveryKey, item.reservation.recoveryKey);
  const grant = await s3.authority.grant(
      access.location,
      {
        kind: "restore",
        bucket: access.location.bucket,
        scope: access.point.objectKey,
      },
      s3.ca,
    ),
    reader = new BackupObjects(access.location, grant.credentials, s3.ca);
  const replacement = await root();
  try {
    await writeFile(
      join(replacement, "input.backup.enc"),
      await reader.read(access.point.objectKey),
      { mode: 0o600 },
    );
  } finally {
    reader.close();
  }
  const restored = await worker(replacement, "restore", {
    recoveryKey: access.keys.recoveryKey,
    sourceNodeId: access.point.sourceNodeId,
    modules: access.point.modules,
    expectedVenue: item.captured.venueName,
  });
  assert(restored.integrityOk);
  await recovery.target(operationId, "restored", proof("restored"));
  assert.equal(
    (await recovery.status(session.token, operationId)).status,
    "restored",
  );
  assert.equal(
    (await f.db.pool.query("SELECT count(*) FROM installations")).rows[0].count,
    "2",
  );
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT count(*) FROM installations WHERE revoked_at IS NOT NULL",
      )
    ).rows[0].count,
    "0",
  );
  await recovery.close(session.token, session.csrfToken, operationId);
  record(
    "owner recovery restored an older-key snapshot after rotation with original servers stopped and no continuous data present",
  );
  const guided = await root();
  const request = await recoveryClient(guided, 'start');
  assert.equal(request.state, 'awaiting_owner');
  const retry = await recoveryClient(guided, 'start');
  assert.equal(retry.requestId, request.requestId);
  assert.equal(retry.code, request.code);
  assert.equal(retry.openCloudUrl, f.origin + '/recover#request=' + request.requestId);
  assert(!retry.openCloudUrl.includes(request.code));
  const ownerPost = async (action, extra={}) => {
    const response = await fetch(f.origin + '/api/account/recovery/' + action, {
      method:'POST', headers:{origin:f.origin,'content-type':'application/json',cookie:'cloud_session='+session.token,'x-csrf-token':session.csrfToken},
      body:JSON.stringify({requestId:request.requestId,code:request.code,...extra}),
    });
    assert.equal(response.status,200,'Owner recovery request failed');
    const value=await response.json();
    assert(!JSON.stringify(value).includes(item.reservation.recoveryKey));
    return value;
  };
  const choice={pointId:item.point.id,oldServerUnavailable:'true',acceptDataLoss:'true'};
  // Discard a successful reply, then resume through a read and an exact approval retry.
  await ownerPost('approve',choice);
  const approval=await ownerPost('inspect');
  assert.equal(approval.operation.pointId,item.point.id);
  assert.deepEqual(await ownerPost('approve',choice),approval);
  const approved=await recoveryClient(guided,'status');
  assert.equal(approved.point.id,item.point.id);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM backup_recoveries WHERE id=$1',[request.requestId])).rows[0].count,'1');
  await recoveryClient(guided,'stage',{expectedPointId:item.point.id});
  assert.equal((await recovery.status(session.token,request.requestId)).status,'pending','Staging must not report completed restore');
  const completed=await recoveryClient(guided,'restore',{expectedPointId:item.point.id,expectedVenue:item.captured.venueName,expectedSourceNodeId:item.point.sourceNodeId,expectedModules:item.point.modules});
  assert.equal(completed.restored,true);
  assert.equal((await recovery.status(session.token,request.requestId)).status,'pending','Only a subsequent report acknowledges the completed local restore');
  await recoveryClient(guided,'report');
  assert.equal((await recovery.status(session.token,request.requestId)).status,'restored');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'2');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installations WHERE revoked_at IS NOT NULL')).rows[0].count,'0');
  record('guided owner HTTP approval survives lost replies; fresh Waitron processes download, validate, stage and cold-restore the bound snapshot without copying keys or inheriting destinations');
  const proposal=await recoveryClient(guided,'prepareReplacement',{expectedSourceNodeId:item.point.sourceNodeId});
  assert.equal(proposal.state,'awaiting_owner');assert.equal(proposal.oldInstallationId,item.venue.registration.installationId);
  assert.equal((await ownerPost('inspect')).replacement.publicKey,proposal.publicKey);
  const confirmations={oldInstallationId:proposal.oldInstallationId,oldServerUnavailable:'true',confirmReplacement:'true'};
  // Discard confirmation's reply and restart the real client before importing the durable result.
  await ownerPost('replace',confirmations);
  const connected=await recoveryClient(guided,'statusReplacement',{expectedSourceNodeId:item.point.sourceNodeId});
  assert.equal(connected.state,'complete');assert.equal(connected.registration.venueId,item.venue.registration.venueId);assert.notEqual(connected.registration.installationId,item.venue.registration.installationId);
  assert.deepEqual((await recoveryClient(guided,'statusReplacement',{expectedSourceNodeId:item.point.sourceNodeId})).registration,connected.registration);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'3');
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installations WHERE superseded_by IS NULL')).rows[0].count,'2');
  assert.equal((await f.db.pool.query('SELECT installation_id FROM backup_points WHERE id=$1',[item.point.id])).rows[0].installation_id,item.venue.registration.installationId);
  const routes=(await remote.manifest(cell)).routes,newRoute=routes.find(r=>r.venueId===item.venue.registration.venueId);
  assert.equal(newRoute.installationId,connected.registration.installationId);assert.equal(newRoute.peerPublicKey,proposal.peerPublicKey);
  for(const name of ['staffHostname','publicHostname','address','port'])assert.equal(newRoute[name],oldPlacement[name]);
  assert.equal(routes.find(r=>r.venueId===neighbour.venueId).peerPublicKey,neighbour.peerPublicKey);
  assert(!JSON.stringify(routes).includes(oldPlacement.peerPublicKey));
  await assert.rejects(captureClient(item.venue.root,'reserve',{id:item.reservation.id}));
  const fresh=await captureClient(guided,'reserve',{stateSubdir:'state',id:randomUUID()});assert.equal(fresh.installationId,connected.registration.installationId);assert.notEqual(fresh.recoveryKey,item.reservation.recoveryKey);
  const captured=await worker(guided,'capture',{stateSubdir:'state',recoveryKey:fresh.recoveryKey});
  assert(!captured.entries.some(n=>n.includes('cloud-replacement')||n.includes('cloud-recovery')||n.includes('cloud-connection')));
  const freshBytes=await readFile(join(guided,'captured.backup.enc'));await captureClient(guided,'upload',{stateSubdir:'state',grant:fresh,ca:s3.ca});
  const freshPoint=await captureClient(guided,'publish',{stateSubdir:'state',id:fresh.id,metadata:{...receipt(freshBytes),capturedAt:captured.manifest.createdAt,retention:'daily',sourceNodeId:captured.sourceNodeId,modules:captured.manifest.modules}});
  assert.equal(freshPoint.installationId,connected.registration.installationId);
  const freshTarget=await root();await writeFile(join(freshTarget,'input.backup.enc'),freshBytes,{mode:0o600});await worker(freshTarget,'restore',{recoveryKey:fresh.recoveryKey,sourceNodeId:freshPoint.sourceNodeId,modules:freshPoint.modules,expectedVenue:captured.venueName});
  await ownerPost('close');assert.equal((await recoveryClient(guided,'statusReplacement',{expectedSourceNodeId:item.point.sourceNodeId})).state,'complete');
  record('owner-confirmed replacement survives lost replies and client restarts, preserves venue/history/remote routing, retires old authority and captures a restorable snapshot with fresh keys');
  const bad = await root();
  await writeFile(join(bad, "input.backup.enc"), item.bytes, { mode: 0o600 });
  await assert.rejects(
    worker(bad, "restore", {
      recoveryKey: randomBytes(32).toString("base64url"),
      sourceNodeId: item.point.sourceNodeId,
      modules: item.point.modules,
      expectedVenue: item.captured.venueName,
    }),
  );
  await assert.rejects(readFile(join(bad, "venue", "venue.db")));
  record(
    "wrong recovery key leaves the replacement database absent; Cloud grants did not activate or re-enrol it",
  );
  await new InstallationStore(f.db.pool,f.issuer,f.origin).revokeWithSession(session.token,session.csrfToken,connected.registration.installationId);
  await assert.rejects(captureClient(item.venue.root,'reserve',{id:item.reservation.id}));
  await assert.rejects(captureClient(guided,'reserve',{stateSubdir:'state',id:fresh.id}));
  record('Cloud owner revocation refuses subsequent Waitron upload-credential renewal');
  const result = {
    version:1,
    cloudHead: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    cloudDirty:
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim() !== "",
    waitronHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: waitron,
      encoding: "utf8",
    }).trim(),
    waitronDirty:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: waitron,
        encoding: "utf8",
      }).trim() !== "",
    phases:['provider-isolation','streams-observed','continuous-recovery','interrupted-retry','snapshot-fallback'],
    venues:streamViews.map(entry=>({venueId:entry.snapshot.venue.registration.venueId,sourceHead:entry.sourceHead,observedGeneration:entry.pointer.body.generation,recoverableAt:entry.observed.recoverableAt,checkedAt:entry.observed.checkedAt})),
    isolation,
    continuous:{venueId:continuousEntry.snapshot.venue.registration.venueId,sourceHead:continuousEntry.sourceHead,restoredHead,approvedGeneration:continuousEntry.pointer.body.generation,restoredGeneration:continuousEntry.pointer.body.generation,recoverableAt:continuousEntry.observed.recoverableAt,pointerWrittenAt:continuousEntry.pointer.body.writtenAt,retry:{interrupted:true,cleanTarget:true,succeeded:true}},
    snapshotFallback:{venueId:fallbackEntry.snapshot.venue.registration.venueId,pointId:fallbackEntry.snapshot.point.id,continuousDeleted:true,restoreSucceeded:true},
    activation:'not-performed',
    checks:['real-seaweedfs','real-waitron','verifier-process-isolation','no-production-resources'],
  };
  verifyManagedRecoveryReceipt(result);
  if (process.env.BACKUP_RECEIPT)
    await writeFile(
      process.env.BACKUP_RECEIPT,
      JSON.stringify(result, null, 2) + "\n",
    );
  console.log(JSON.stringify(result));
} finally {
  for (const child of children) await stop(child);
  for (const client of objectClients) client.close();
  await s3?.stop();
  await f?.close();
  for (const dir of roots) await rm(dir, { recursive: true, force: true });
}
