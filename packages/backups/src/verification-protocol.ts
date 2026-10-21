import { createHash } from "node:crypto";
// Structural wire types only; Waitron owns the module verification semantics.
export type BackupModuleStatus =
  "passed" | "invalid" | "needs_authority" | "unsupported";
export type BackupCheckCode =
  | "data"
  | "immutable"
  | "chain"
  | "head"
  | "history"
  | "source"
  | "secret"
  | "entries"
  | "effects"
  | "not_applicable";
export interface BackupModuleCheck {
  readonly code: BackupCheckCode;
  readonly status: BackupModuleStatus;
}
type Environment = "preproduction" | "production";
export interface BackupTargetModule {
  name: string;
  packageVersion: string;
  requires: Readonly<Record<string, string>>;
  schema: number;
  migrationTable: string;
  migrationDigest: string;
  semanticsVersion: number;
  policyDigest: string;
}
export interface BackupVerificationTarget {
  version: 1;
  runtime: { release: string; revision: string; fingerprint: string };
  modules: readonly BackupTargetModule[];
  compositionDigest: string;
  migrationDigest: string;
  policyDigest: string;
  digest: string;
}
export interface BackupVerificationRequest {
  protocol: "backup-data-restore/v1";
  captureId: string;
  pointId: string;
  venueId: string;
  sourceInstallationId: string;
  sourceNodeId: string;
  capturedAt: string;
  archive: {
    sha256: string;
    bytes: number;
    manifestVersion: number;
    environment: Environment;
    modules: Readonly<Record<string, number>>;
  };
  backupKey: { version: number; reference: string };
  target: BackupVerificationTarget;
  verifierImage: string;
  attempt: {
    jobId: string;
    number: number;
    claimId: string;
    controllerScope: string;
    childToken: string;
    deadline: string;
  };
}
export type BackupVerificationReason =
  | "none"
  | "request_invalid"
  | "archive_digest_mismatch"
  | "archive_size_mismatch"
  | "archive_invalid"
  | "archive_format_unsupported"
  | "binding_mismatch"
  | "sqlite_integrity"
  | "module_integrity"
  | "module_missing"
  | "target_incompatible"
  | "semantics_missing"
  | "module_data_check_requires_authority"
  | "secret_unavailable"
  | "secret_invalid"
  | "secret_format_unsupported"
  | "decryption_unavailable"
  | "cancelled"
  | "deadline"
  | "resource_limit"
  | "cleanup_uncertain"
  | "unexpected";
export interface BackupVerificationResult {
  protocol: "backup-data-restore/v1";
  requestDigest: string;
  attemptToken: string;
  measuredArchive: { sha256: string; bytes: number } | null;
  targetDigest: string;
  policyDigest: string;
  modules: readonly {
    name: string;
    semanticsVersion: number;
    status: BackupModuleStatus;
    checks: readonly BackupModuleCheck[];
  }[];
  status:
    "passed" | "invalid" | "needs_authority" | "unsupported" | "unavailable";
  reason: BackupVerificationReason;
  activation: "not_attempted";
}

const MODULE_STATUSES = [
  "passed",
  "invalid",
  "needs_authority",
  "unsupported",
] as const;
const CHECK_CODES = [
  "data",
  "immutable",
  "chain",
  "head",
  "history",
  "source",
  "secret",
  "entries",
  "effects",
  "not_applicable",
] as const;
const REASONS = {
  passed: ["none"],
  invalid: [
    "archive_digest_mismatch",
    "archive_size_mismatch",
    "archive_invalid",
    "binding_mismatch",
    "sqlite_integrity",
    "module_integrity",
    "secret_invalid",
  ],
  needs_authority: ["module_data_check_requires_authority"],
  unsupported: [
    "archive_format_unsupported",
    "module_missing",
    "target_incompatible",
    "semantics_missing",
    "secret_format_unsupported",
  ],
  unavailable: [
    "request_invalid",
    "secret_unavailable",
    "decryption_unavailable",
    "cancelled",
    "deadline",
    "resource_limit",
    "cleanup_uncertain",
    "unexpected",
  ],
} as const;

export class BackupVerificationProtocolError extends Error {
  constructor() {
    super("Invalid backup verification protocol");
    this.name = "BackupVerificationProtocolError";
  }
}
function refuse(): never {
  throw new BackupVerificationProtocolError();
}
function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    refuse();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    refuse();
  return value as Record<string, unknown>;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) refuse();
  return value as T;
}
function text(value: unknown, max = 256, allowSpaces = false): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    !(allowSpaces ? /^[\x20-\x7e]+$/ : /^[\x21-\x7e]+$/).test(value)
  )
    refuse();
  return value;
}
function hash(value: unknown, length = 64): string {
  const result = text(value);
  if (result.length !== length || !/^[a-f0-9]+$/.test(result)) refuse();
  return result;
}
function integer(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < min ||
    value > max
  )
    refuse();
  return value;
}
function moduleName(value: unknown): string {
  const name = text(value, 64);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) refuse();
  return name;
}
function timestamp(value: unknown): string {
  const date = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString() !== date
  )
    refuse();
  return date;
}
function list<T>(
  value: unknown,
  max: number,
  read: (value: unknown) => T,
  key: (value: T) => string,
  min = 0,
): readonly T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    refuse();
  const entries = value.map(read);
  if (new Set(entries.map(key)).size !== entries.length) refuse();
  return Object.freeze(entries);
}
function map<T>(
  value: unknown,
  read: (value: unknown) => T,
  min = 0,
): Readonly<Record<string, T>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    refuse();
  const entries = Object.entries(value);
  if (entries.length < min || entries.length > 64) refuse();
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, value]) => [moduleName(key), read(value)]),
    ),
  );
}
function sortedPairs<T>(value: Readonly<Record<string, T>>): [string, T][] {
  return Object.keys(value)
    .sort()
    .map((key) => [key, value[key]!]);
}
function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function orderedModules(
  modules: readonly BackupTargetModule[],
): BackupTargetModule[] {
  return [...modules].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}
export function backupVerificationTargetDigests(
  target: Pick<BackupVerificationTarget, "runtime" | "modules">,
): Pick<
  BackupVerificationTarget,
  "compositionDigest" | "migrationDigest" | "policyDigest" | "digest"
> {
  const modules = orderedModules(target.modules);
  const compositionDigest = sha(
    modules.map((m) => [m.name, m.packageVersion, sortedPairs(m.requires)]),
  );
  const migrationDigest = sha(
    modules.map((m) => [m.name, m.schema, m.migrationTable, m.migrationDigest]),
  );
  const policyDigest = sha(
    modules.map((m) => [m.name, m.semanticsVersion, m.policyDigest]),
  );
  const digest = sha([
    1,
    [
      target.runtime.release,
      target.runtime.revision,
      target.runtime.fingerprint,
    ],
    modules.map((m) => [
      m.name,
      m.packageVersion,
      sortedPairs(m.requires),
      m.schema,
      m.migrationTable,
      m.migrationDigest,
      m.semanticsVersion,
      m.policyDigest,
    ]),
    compositionDigest,
    migrationDigest,
    policyDigest,
  ]);
  return { compositionDigest, migrationDigest, policyDigest, digest };
}
export function validateBackupVerificationTarget(
  value: unknown,
): BackupVerificationTarget {
  const target = object(value, [
    "version",
    "runtime",
    "modules",
    "compositionDigest",
    "migrationDigest",
    "policyDigest",
    "digest",
  ]);
  if (target.version !== 1) refuse();
  const runtime = object(target.runtime, [
    "release",
    "revision",
    "fingerprint",
  ]);
  const admittedRuntime = Object.freeze({
    release: text(runtime.release),
    revision: hash(runtime.revision, 40),
    fingerprint: hash(runtime.fingerprint),
  });
  const modules = list(
    target.modules,
    64,
    (value) => {
      const m = object(value, [
        "name",
        "packageVersion",
        "requires",
        "schema",
        "migrationTable",
        "migrationDigest",
        "semanticsVersion",
        "policyDigest",
      ]);
      const migrationTable = text(m.migrationTable);
      if (!/^__[a-z_][a-z0-9_]*$/.test(migrationTable)) refuse();
      return Object.freeze({
        name: moduleName(m.name),
        packageVersion: text(m.packageVersion),
        requires: map(m.requires, (range) => text(range, 256, true)),
        schema: integer(m.schema),
        migrationTable,
        migrationDigest: hash(m.migrationDigest),
        semanticsVersion: integer(m.semanticsVersion, 1),
        policyDigest: hash(m.policyDigest),
      });
    },
    (m) => m.name,
    1,
  );
  if (
    modules.some((m) =>
      Object.keys(m.requires).some(
        (name) => !modules.some((other) => other.name === name),
      ),
    )
  )
    refuse();
  if (new Set(modules.map((m) => m.migrationTable)).size !== modules.length)
    refuse();
  const computed = backupVerificationTargetDigests({
    runtime: admittedRuntime,
    modules,
  });
  for (const key of [
    "compositionDigest",
    "migrationDigest",
    "policyDigest",
    "digest",
  ] as const)
    if (hash(target[key]) !== computed[key]) refuse();
  return Object.freeze({
    version: 1,
    runtime: admittedRuntime,
    modules,
    ...computed,
  });
}

// JSON.parse loses duplicate keys and integer spellings before shape validation can see them.
export function parseBackupVerificationJson(
  raw: string,
  limit: number,
): unknown {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > limit)
    refuse();
  let at = 0;
  function space() {
    while (at < raw.length && /[\x20\t\r\n]/.test(raw[at]!)) at++;
  }
  function string(): string {
    if (raw[at] !== '"') refuse();
    const start = at++;
    for (; at < raw.length; at++) {
      if (raw[at] === "\\") {
        at++;
        continue;
      }
      if (raw[at] === '"') {
        at++;
        try {
          return JSON.parse(raw.slice(start, at)) as string;
        } catch {
          refuse();
        }
      }
    }
    refuse();
  }
  function value(depth: number): unknown {
    if (depth > 32) refuse();
    space();
    const ch = raw[at];
    if (ch === '"') return string();
    if (ch === "{") {
      at++;
      space();
      const out: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      if (raw[at] === "}") {
        at++;
        return out;
      }
      for (;;) {
        space();
        const key = string();
        if (Object.hasOwn(out, key)) refuse();
        space();
        if (raw[at++] !== ":") refuse();
        out[key] = value(depth + 1);
        space();
        const next = raw[at++];
        if (next === "}") return out;
        if (next !== ",") refuse();
      }
    }
    if (ch === "[") {
      at++;
      space();
      const out: unknown[] = [];
      if (raw[at] === "]") {
        at++;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        space();
        const next = raw[at++];
        if (next === "]") return out;
        if (next !== ",") refuse();
      }
    }
    for (const [token, result] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const) {
      if (raw.startsWith(token, at)) {
        at += token.length;
        return result;
      }
    }
    const number = /^(0|[1-9][0-9]*)/.exec(raw.slice(at));
    if (!number) refuse();
    at += number[0].length;
    return integer(Number(number[0]));
  }
  const result = value(0);
  space();
  if (at !== raw.length) refuse();
  return result;
}
export function readBackupVerificationRequest(
  raw: string,
): BackupVerificationRequest {
  const request = object(parseBackupVerificationJson(raw, 65536), [
    "protocol",
    "captureId",
    "pointId",
    "venueId",
    "sourceInstallationId",
    "sourceNodeId",
    "capturedAt",
    "archive",
    "backupKey",
    "target",
    "verifierImage",
    "attempt",
  ]);
  if (request.protocol !== "backup-data-restore/v1") refuse();
  const captureId = text(request.captureId, 128),
    pointId = text(request.pointId, 128);
  if (captureId !== pointId) refuse();
  const archive = object(request.archive, [
    "sha256",
    "bytes",
    "manifestVersion",
    "environment",
    "modules",
  ]);
  const backupKey = object(request.backupKey, ["version", "reference"]);
  const attempt = object(request.attempt, [
    "jobId",
    "number",
    "claimId",
    "controllerScope",
    "childToken",
    "deadline",
  ]);
  const verifierImage = text(request.verifierImage);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(verifierImage))
    refuse();
  return Object.freeze({
    protocol: "backup-data-restore/v1",
    captureId,
    pointId,
    venueId: text(request.venueId, 128),
    sourceInstallationId: text(request.sourceInstallationId, 128),
    sourceNodeId: text(request.sourceNodeId, 128),
    capturedAt: timestamp(request.capturedAt),
    archive: Object.freeze({
      sha256: hash(archive.sha256),
      bytes: integer(archive.bytes, 1, 536870912),
      manifestVersion: integer(archive.manifestVersion, 1),
      environment: choice(archive.environment, ["preproduction", "production"]),
      modules: map(archive.modules, (v) => integer(v), 1),
    }),
    backupKey: Object.freeze({
      version: integer(backupKey.version, 1),
      reference: text(backupKey.reference),
    }),
    target: validateBackupVerificationTarget(request.target),
    verifierImage,
    attempt: Object.freeze({
      jobId: text(attempt.jobId, 128),
      number: integer(attempt.number, 1),
      claimId: text(attempt.claimId, 128),
      controllerScope: text(attempt.controllerScope, 128),
      childToken: text(attempt.childToken, 128),
      deadline: timestamp(attempt.deadline),
    }),
  });
}
export function backupVerificationRequestDigest(
  r: BackupVerificationRequest,
): string {
  return sha([
    r.protocol,
    r.captureId,
    r.pointId,
    r.venueId,
    r.sourceInstallationId,
    r.sourceNodeId,
    r.capturedAt,
    r.archive.sha256,
    r.archive.bytes,
    r.archive.manifestVersion,
    r.archive.environment,
    sortedPairs(r.archive.modules),
    r.backupKey.version,
    r.backupKey.reference,
    r.target.digest,
    r.target.runtime.release,
    r.target.runtime.revision,
    r.target.runtime.fingerprint,
    r.target.compositionDigest,
    r.target.migrationDigest,
    r.target.policyDigest,
    r.verifierImage,
    r.attempt.jobId,
    r.attempt.number,
    r.attempt.claimId,
    r.attempt.controllerScope,
    r.attempt.childToken,
    r.attempt.deadline,
  ]);
}
function aggregate(
  statuses: readonly BackupModuleStatus[],
): BackupModuleStatus | undefined {
  return [...MODULE_STATUSES]
    .reverse()
    .find((status) => statuses.includes(status));
}
export function readBackupVerificationResult(
  raw: string,
  request: BackupVerificationRequest,
): BackupVerificationResult {
  const result = object(parseBackupVerificationJson(raw, 32768), [
    "protocol",
    "requestDigest",
    "attemptToken",
    "measuredArchive",
    "targetDigest",
    "policyDigest",
    "modules",
    "status",
    "reason",
    "activation",
  ]);
  if (
    result.protocol !== request.protocol ||
    result.activation !== "not_attempted" ||
    result.requestDigest !== backupVerificationRequestDigest(request) ||
    result.attemptToken !== request.attempt.childToken ||
    result.targetDigest !== request.target.digest ||
    result.policyDigest !== request.target.policyDigest
  )
    refuse();
  const status = choice(result.status, [
    "passed",
    "invalid",
    "needs_authority",
    "unsupported",
    "unavailable",
  ]);
  const reason = choice<BackupVerificationReason>(
    result.reason,
    REASONS[status],
  );
  const modules = list(
    result.modules,
    64,
    (value) => {
      const m = object(value, ["name", "semanticsVersion", "status", "checks"]),
        name = moduleName(m.name);
      const expected = request.target.modules.find(
        (entry) => entry.name === name,
      );
      const semanticsVersion = integer(m.semanticsVersion, 1);
      if (!expected || semanticsVersion !== expected.semanticsVersion) refuse();
      const moduleStatus = choice(m.status, MODULE_STATUSES);
      const checks = list(
        m.checks,
        16,
        (value) => {
          const check = object(value, ["code", "status"]);
          return Object.freeze({
            code: choice(check.code, CHECK_CODES),
            status: choice(check.status, MODULE_STATUSES),
          });
        },
        (check) => check.code,
        1,
      );
      if (aggregate(checks.map((check) => check.status)) !== moduleStatus)
        refuse();
      if (
        checks.some((check) => check.code === "not_applicable") &&
        (checks.length !== 1 || moduleStatus !== "passed")
      )
        refuse();
      return Object.freeze({
        name,
        semanticsVersion,
        status: moduleStatus,
        checks,
      });
    },
    (m) => m.name,
  );
  let measuredArchive: BackupVerificationResult["measuredArchive"] = null;
  if (result.measuredArchive !== null) {
    const measured = object(result.measuredArchive, ["sha256", "bytes"]);
    measuredArchive = Object.freeze({
      sha256: hash(measured.sha256),
      bytes: integer(measured.bytes, 1, 536870912),
    });
  }
  if (
    status === "passed" &&
    (modules.length !== request.target.modules.length ||
      modules.some((m) => m.status !== "passed" || m.semanticsVersion !== 1) ||
      request.archive.manifestVersion !== 1 ||
      measuredArchive === null ||
      measuredArchive.sha256 !== request.archive.sha256 ||
      measuredArchive.bytes !== request.archive.bytes)
  )
    refuse();
  const ownerStatus = aggregate(modules.map((m) => m.status));
  if (
    ownerStatus !== undefined &&
    ownerStatus !== "passed" &&
    status !== "unavailable" &&
    status !== ownerStatus
  )
    refuse();
  return Object.freeze({
    protocol: "backup-data-restore/v1",
    requestDigest: result.requestDigest as string,
    attemptToken: result.attemptToken as string,
    measuredArchive,
    targetDigest: result.targetDigest as string,
    policyDigest: result.policyDigest as string,
    modules,
    status,
    reason,
    activation: "not_attempted",
  });
}
