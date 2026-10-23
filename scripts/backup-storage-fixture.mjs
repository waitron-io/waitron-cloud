import { createServer as httpsServer, Agent } from "node:https";
import { createServer as netServer } from "node:net";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  open,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { StorageAuthority } from "../packages/backups/src/storage.ts";
const require = createRequire(
  new URL("../packages/backups/package.json", import.meta.url),
);
const { S3Client, CreateBucketCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} = require("@aws-sdk/client-sts");
const pins = {
  "darwin-arm64": [
    "darwin_arm64.tar.gz",
    "3ad466db33e83d0b103f90a06997feeb1cc42fd536e6cbdcdded975778f64fda",
  ],
  "linux-arm64": [
    "linux_arm64.tar.gz",
    "ba5c9def9ff98f78becdf309a50a9f906922f6383a7c4c772d01ede3cc012e16",
  ],
  "linux-x64": [
    "linux_amd64.tar.gz",
    "31fb804858885f9e7f18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d",
  ],
};
async function freePort() {
  const s = netServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
async function binary(root) {
  const pin = pins[process.platform + "-" + process.arch];
  if (!pin) throw Error("Unsupported SeaweedFS test platform");
  const cache = join(tmpdir(), "waitron-cloud-test-binaries");
  await mkdir(cache, { recursive: true });
  const archive = join(cache, "seaweed-4.47-" + pin[0]);
  let bytes, downloaded = false;
  try {
    bytes = await readFile(archive);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(
      "https://github.com/seaweedfs/seaweedfs/releases/download/4.47/" + pin[0],
    );
    if (!response.ok) throw Error("SeaweedFS download failed");
    bytes = Buffer.from(await response.arrayBuffer());
    downloaded = true;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== pin[1])
    throw Error("SeaweedFS archive digest mismatch");
  // Verified cache files are immutable inputs to concurrent extractors. Publish a
  // download by rename so another fixture never reads a partly written archive.
  if (downloaded) {
    const temporary = archive + "." + randomBytes(16).toString("hex");
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, archive);
    } finally { await rm(temporary, { force: true }); }
  }
  execFileSync("tar", ["-xzf", archive, "-C", root]);
  return join(root, "weed");
}
export async function startBackupStorage(options = {}) {
  const tokenDuration = options.tokenDuration ?? "15m";
  if (!/^\d+[smh]$/.test(tokenDuration))
    throw Error("Invalid local storage token duration");
  const root = await mkdtemp(join(tmpdir(), "cloud-backup-storage-"));
  let oidc, child, log, adminClient, allocatedPorts;
  const managed = new Map();
  const portReservations = [];
  async function releasePorts() {
    await Promise.all(portReservations.splice(0).map(server =>
      server.listening ? new Promise(resolve => server.close(resolve)) : undefined,
    ));
  }
  async function stop() {
    await releasePorts();
    adminClient?.destroy();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise((r) => child.once("exit", r));
      }
    }
    if (oidc) await new Promise((r) => oidc.close(r));
    await log?.close();
    await rm(root, { recursive: true, force: true });
  }
  try {
    const bin = await binary(root);
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(root, "key.pem"),
        "-out",
        join(root, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:host.docker.internal",
      ],
      { stdio: "ignore" },
    );
    const ca = await readFile(join(root, "cert.pem"), "utf8"),
      tlsKey = await readFile(join(root, "key.pem"));
    const oidcPort = await freePort(),
      issuer = "https://127.0.0.1:" + oidcPort,
      keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const roles = Object.fromEntries(
      ["capture", "stream", "restore"].map((k) => [
        k,
        "arn:aws:iam::role/cloud-" + k,
      ]),
    );
    const authority = new StorageAuthority({
      issuer,
      audience: "cloud-storage",
      keyId: "local-test",
      privateKey: keys.privateKey,
      roles,
    });
    oidc = httpsServer({ key: tlsKey, cert: ca }, (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url === "/jwks"
            ? authority.jwks()
            : {
                issuer,
                jwks_uri: issuer + "/jwks",
                id_token_signing_alg_values_supported: ["RS256"],
                subject_types_supported: ["public"],
                response_types_supported: ["id_token"],
              },
        ),
      );
    });
    await new Promise((r) => oidc.listen(oidcPort, "127.0.0.1", r));
    const resource = "arn:aws:s3:::${jwt:bucket}/${jwt:scope}";
    const policies = ["capture", "stream", "restore"].map((kind) => ({
      name: kind,
      document: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action:
              kind === "capture"
                ? ["s3:PutObject"]
                : kind === "restore"
                  ? ["s3:GetObject"]
                  : ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
            Resource: [resource + (kind === "stream" ? "*" : "")],
          },
          ...(kind === "stream"
            ? [
                {
                  Effect: "Allow",
                  Action: ["s3:ListBucket"],
                  Resource: ["arn:aws:s3:::${jwt:bucket}"],
                  Condition: { StringLike: { "s3:prefix": "${jwt:scope}*" } },
                },
              ]
            : []),
        ],
      },
    }));
    await writeFile(
      join(root, "sts.json"),
      JSON.stringify({
        sts: {
          tokenDuration,
          maxSessionLength: tokenDuration,
          issuer: "cloud-local-sts",
          signingKey: randomBytes(32).toString("base64"),
        },
        providers: [
          {
            name: "cloud",
            type: "oidc",
            enabled: true,
            config: {
              issuer,
              clientId: "cloud-storage",
              jwksUri: issuer + "/jwks",
              tlsCaCert: join(root, "cert.pem"),
              roleMapping: {
                rules: Object.entries(roles).map(([kind, role]) => ({
                  claim: "kind",
                  value: kind,
                  role,
                })),
              },
            },
          },
        ],
        policies,
        roles: Object.entries(roles).map(([kind, roleArn]) => ({
          roleName: "cloud-" + kind,
          roleArn,
          attachedPolicies: [kind],
          trustPolicy: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Federated: "*" },
                Action: ["sts:AssumeRoleWithWebIdentity"],
                Condition: {
                  StringEquals: { "oidc:iss": issuer, "oidc:kind": kind },
                },
              },
            ],
          },
        })),
      }),
      { mode: 0o600 },
    );
    const admin = {
      accessKeyId: "local-" + randomBytes(8).toString("hex"),
      secretAccessKey: randomBytes(32).toString("base64url"),
    };
    const iamPath = join(root, "iam.json"),
      identities = [
        {
          name: "admin",
          credentials: [
            { accessKey: admin.accessKeyId, secretKey: admin.secretAccessKey },
          ],
          actions: ["Admin", "Read", "Write", "List", "Tagging"],
        },
      ];
    const writeIdentities = () =>
      writeFile(iamPath, JSON.stringify({ identities }), { mode: 0o600 });
    const reloadIdentities = async () => {
      await writeIdentities();
      child.kill("SIGHUP");
      await new Promise((resolve) => setTimeout(resolve, 250));
    };
    const newCredentials = (prefix) => ({
      accessKeyId: prefix + "-" + randomBytes(8).toString("hex"),
      secretAccessKey: randomBytes(32).toString("base64url"),
    });
    await writeIdentities();
    const ports = [];
    // Keep every listener open while choosing the batch so the kernel cannot
    // assign one port to two SeaweedFS services. Reject connections so releasing
    // the reservations cannot wait for a peer before handing them to the child.
    for (let i = 0; i < 7; i++) {
      const reservation = netServer(socket => socket.destroy());
      portReservations.push(reservation);
      await new Promise((resolve, reject) => {
        reservation.once("error", reject);
        reservation.listen(0, "127.0.0.1", resolve);
      });
      ports.push(reservation.address().port);
    }
    const [s3, master, masterGrpc, volume, volumeGrpc, filer, filerGrpc] =
      ports;
    allocatedPorts = { s3, master, masterGrpc, volume, volumeGrpc, filer, filerGrpc };
    const endpoint = "https://127.0.0.1:" + s3;
    await mkdir(join(root, "data"));
    log = await open(join(root, "store.log"), "w");
    const args = [
      "mini",
      "-dir=" + join(root, "data"),
      "-ip=127.0.0.1",
      "-ip.bind=127.0.0.1",
      "-s3.port=" + s3,
      "-s3.cert.file=" + join(root, "cert.pem"),
      "-s3.key.file=" + join(root, "key.pem"),
      "-s3.config=" + iamPath,
      "-s3.iam.config=" + join(root, "sts.json"),
      "-master.port=" + master,
      "-master.port.grpc=" + masterGrpc,
      "-volume.port=" + volume,
      "-volume.port.grpc=" + volumeGrpc,
      "-filer.port=" + filer,
      "-filer.port.grpc=" + filerGrpc,
      "-admin.ui=false",
      "-webdav=false",
      "-s3.port.iceberg=0",
      "-s3.port.lance=0",
    ];
    await releasePorts();
    child = spawn(bin, args, {
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root },
      stdio: ["ignore", log.fd, log.fd],
    });
    const agent = () => new Agent({ ca });
    adminClient = new S3Client({
      endpoint,
      region: "local",
      credentials: admin,
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: { httpsAgent: agent() },
    });
    let ready = false;
    for (let n = 0; n < 120; n++) {
      try {
        await adminClient.send(
          new CreateBucketCommand({ Bucket: "readiness-probe" }),
          { abortSignal: AbortSignal.timeout(1000) },
        );
        ready = true;
        break;
      } catch (error) {
        if (child.exitCode !== null)
          throw Error(
            "SeaweedFS exited: " +
              (await readFile(join(root, "store.log"), "utf8")),
          );
        if (n === 119) throw error;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!ready) throw Error("SeaweedFS not ready");
    const sameLocation = (a, b) =>
      a?.endpoint === b?.endpoint && a?.region === b?.region && a?.bucket === b?.bucket;
    const managedStreams = {
      async provision(input) {
        const prior = managed.get(input.venueId);
        if (prior) {
          if (!sameLocation(prior.location, input.location) || prior.prefix !== input.prefix)
            throw Error("managed stream scope changed");
          return prior.provision;
        }
        const writer = {
            accessKeyId: "managed-write-" + randomBytes(8).toString("hex"),
            secretAccessKey: randomBytes(32).toString("base64url"),
          },
          reader = {
            accessKeyId: "managed-read-" + randomBytes(8).toString("hex"),
            secretAccessKey: randomBytes(32).toString("base64url"),
          },
          scope = `${input.location.bucket}/${input.prefix}*`;
        identities.push(
          {
            name: `managed-writer-${input.venueId}`,
            credentials: [
              { accessKey: writer.accessKeyId, secretKey: writer.secretAccessKey },
            ],
            actions: [`Read:${scope}`, `Write:${scope}`, `List:${scope}`],
          },
          {
            name: `managed-reader-${input.venueId}`,
            credentials: [
              { accessKey: reader.accessKeyId, secretKey: reader.secretAccessKey },
            ],
            actions: [`Read:${scope}`, `List:${scope}`],
          },
        );
        await reloadIdentities();
        const provision = {
          writerReference: `managed:${input.venueId}:writer`,
          readerReference: `managed:${input.venueId}:reader`,
          writerCredentials: writer,
        };
        managed.set(input.venueId, {
          location: input.location,
          prefix: input.prefix,
          writer,
          reader,
          provision,
        });
        return provision;
      },
      async read(reference, location, key) {
        const item = [...managed.values()].find(
          (value) => value.provision.readerReference === reference,
        );
        if (!item || !sameLocation(item.location, location))
          throw Error("unknown managed reader");
        const client = new S3Client({
          endpoint: location.endpoint,
          region: location.region,
          credentials: item.reader,
          forcePathStyle: true,
          maxAttempts: 1,
          requestHandler: { httpsAgent: agent() },
        });
        try {
          const result = await client.send(
            new GetObjectCommand({ Bucket: location.bucket, Key: key }),
          );
          return Buffer.from(await result.Body.transformToByteArray());
        } finally {
          client.destroy();
        }
      },
      async reader(input) {
        const item = managed.get(input.venueId);
        if (
          !item ||
          item.provision.readerReference !== input.reference ||
          item.prefix !== input.prefix ||
          !sameLocation(item.location, input.location)
        )
          throw Error("unknown managed reader");
        // The AWS client decorates its input object with `$source`; the recovery boundary accepts
        // only these two fields, so return a fresh provider response.
        return {
          accessKeyId: item.reader.accessKeyId,
          secretAccessKey: item.reader.secretAccessKey,
        };
      },
    };
    async function assume(scope, role, now) {
      const client = new STSClient({
        endpoint,
        region: "local",
        requestHandler: { httpsAgent: agent() },
        maxAttempts: 1,
      });
      try {
        return await client.send(
          new AssumeRoleWithWebIdentityCommand({
            RoleArn: roles[role],
            RoleSessionName: "negative-control",
            WebIdentityToken: authority.token(scope, now),
            DurationSeconds: 900,
          }),
          { abortSignal: AbortSignal.timeout(5000) },
        );
      } finally {
        client.destroy();
      }
    }
    return {
      root,
      endpoint,
      ca,
      admin,
      authority,
      managedStreams,
      async reloadIdentityFile() {
        if (!child || child.exitCode !== null || child.signalCode !== null) throw Error("storage process unavailable");
        child.kill("SIGHUP");
      },
      agent,
      stop,
      async createCredentials(name, actions) {
        if (identities.some((identity) => identity.name === name))
          throw Error("storage identity already exists");
        const credentials = newCredentials(name);
        identities.push({
          name,
          credentials: [
            {
              accessKey: credentials.accessKeyId,
              secretKey: credentials.secretAccessKey,
            },
          ],
          actions: [...actions],
        });
        await reloadIdentities();
        return credentials;
      },
      async rotateCredentials(name) {
        const identity = identities.find((candidate) => candidate.name === name);
        if (!identity) throw Error("storage identity not found");
        const credentials = newCredentials(name);
        identity.credentials = [
          {
            accessKey: credentials.accessKeyId,
            secretKey: credentials.secretAccessKey,
          },
        ];
        await reloadIdentities();
        return credentials;
      },
      async bucket(name) {
        await adminClient.send(new CreateBucketCommand({ Bucket: name }));
        return { endpoint, bucket: name, region: "local" };
      },
      assumeOtherRole: (scope, role) => assume(scope, role, Date.now()),
      assumeExpired: (scope) => assume(scope, scope.kind, Date.now() - 120000),
    };
  } catch (error) {
    if (allocatedPorts && child) {
      let socketOwners;
      try {
        socketOwners = {
          source: "lsof",
          output: execFileSync("lsof", [
            "-nP", "-a", "-iTCP:" + Object.values(allocatedPorts).join(","),
            "-sTCP:LISTEN", "-Fpcn",
          ], { encoding: "utf8", timeout: 2000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] }),
        };
      } catch (diagnosticError) {
        socketOwners = { source: "unavailable", reason: diagnosticError.code ?? "exit_" + diagnosticError.status };
      }
      // Observe listeners before owned-child cleanup. Never stop a competing owner.
      error.storageStartup = { ports: allocatedPorts, socketOwners };
    }
    await stop();
    throw error;
  }
}
