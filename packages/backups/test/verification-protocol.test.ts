import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { format } from "node:util";
import {
  parseBackupVerificationJson,
  validateBackupVerificationTarget,
  backupVerificationTargetDigests,
  readBackupVerificationRequest,
  backupVerificationRequestDigest,
  readBackupVerificationResult,
  type BackupVerificationRequest,
} from "../src/verification-protocol.ts";

const VECTOR = JSON.parse(
  readFileSync(
    new URL("./fixtures/verification-vector.json", import.meta.url),
    "utf8",
  ),
);

const DIGEST =
  "ecac239bf44b948246432671c1f896219d079c9a3a11b1e3a96d7bd6240e786a";
function request(): BackupVerificationRequest {
  return structuredClone(VECTOR) as unknown as BackupVerificationRequest;
}
function result() {
  return {
    protocol: "backup-data-restore/v1",
    requestDigest: DIGEST,
    attemptToken: "child-1",
    measuredArchive: { sha256: "1".repeat(64), bytes: 8388608 },
    targetDigest: VECTOR.target.digest,
    policyDigest: VECTOR.target.policyDigest,
    modules: ["core", "orders"].map((name) => ({
      name,
      semanticsVersion: 1,
      status: "passed",
      checks: [{ code: "data", status: "passed" }],
    })),
    status: "passed",
    reason: "none",
    activation: "not_attempted",
  };
}
function change(value: object, path: string, replacement: unknown) {
  const parts = path.split(".");
  let cursor = value as Record<string, unknown>;
  for (const key of parts.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  cursor[parts.at(-1)!] = replacement;
}
function refused(body: () => unknown) {
  assert.throws(body, { message: "Invalid backup verification protocol" });
}

describe("private backup request", () => {
  it("literal_vector_matches_waitron", () => {
    const admitted = readBackupVerificationRequest(JSON.stringify(VECTOR));
    assert.deepEqual(admitted, VECTOR);
    assert.equal(backupVerificationRequestDigest(admitted), DIGEST);
    assert.equal(Object.isFrozen(admitted), true);
    assert.equal(Object.isFrozen(admitted.target.modules[1]!.requires), true);
    assert.equal(Object.isFrozen(admitted.archive.modules), true);
  });
  it("module ordering leaves the digest stable", () => {
    const input = request();
    input.archive.modules = { core: 2, orders: 0 };
    input.target.modules = [...input.target.modules].reverse();
    assert.equal(
      backupVerificationRequestDigest(
        readBackupVerificationRequest(JSON.stringify(input)),
      ),
      DIGEST,
    );
  });
  each(
    [
      ["protocol", "backup-data-restore/v2"],
      ["captureId", "capture-2"],
      ["pointId", "capture-2"],
      ["venueId", "venue-2"],
      ["sourceInstallationId", "installation-2"],
      ["sourceNodeId", "node-2"],
      ["capturedAt", "2026-10-20T08:00:01.000Z"],
      ["archive.sha256", "3".repeat(64)],
      ["archive.bytes", 8388609],
      ["archive.manifestVersion", 2],
      ["archive.environment", "production"],
      ["archive.modules.core", 3],
      ["backupKey.version", 2],
      ["backupKey.reference", "key-2"],
      ["target.digest", "3".repeat(64)],
      ["target.runtime.release", "2026.10.21"],
      ["target.runtime.revision", "3".repeat(40)],
      ["target.runtime.fingerprint", "3".repeat(64)],
      ["target.compositionDigest", "3".repeat(64)],
      ["target.migrationDigest", "3".repeat(64)],
      ["target.policyDigest", "3".repeat(64)],
      ["verifierImage", "registry.example/waitron@sha256:" + "3".repeat(64)],
      ["attempt.jobId", "job-2"],
      ["attempt.number", 2],
      ["attempt.claimId", "claim-2"],
      ["attempt.controllerScope", "controller-2"],
      ["attempt.childToken", "child-2"],
      ["attempt.deadline", "2026-10-20T08:00:31.000Z"],
    ],
    "binds request field %s independently",
    (path, replacement) => {
      const input = request();
      change(input, path as string, replacement);
      assert.notEqual(backupVerificationRequestDigest(input), DIGEST);
    },
  );
  each(
    [
      ["archive.bytes", 0],
      ["archive.bytes", 536870913],
      ["archive.bytes", 1.5],
      ["archive.bytes", Number.MAX_SAFE_INTEGER + 1],
      ["archive.manifestVersion", 0],
      ["archive.modules.core", -1],
      ["backupKey.version", 0],
      ["attempt.number", 0],
      ["pointId", "different"],
      ["venueId", "contains space"],
      ["venueId", "x".repeat(129)],
      ["sourceNodeId", String.fromCharCode(128)],
      ["backupKey.reference", "x".repeat(257)],
      ["capturedAt", "2026-10-20T08:00:00Z"],
      ["capturedAt", "2026-02-30T08:00:00.000Z"],
      ["attempt.deadline", "2026-10-20T10:00:30.000+02:00"],
      ["archive.sha256", "A".repeat(64)],
      ["archive.environment", "dev"],
      ["verifierImage", "waitron:main"],
      ["target.runtime.revision", "e".repeat(39)],
      ["target.runtime.fingerprint", "F".repeat(64)],
      ["target.version", 2],
      ["archive.modules", {}],
      ["archive.modules", { Bad: 1 }],
      ["target.modules", []],
      ["target.modules", [VECTOR.target.modules[0], VECTOR.target.modules[0]]],
      ["target.modules.0.schema", -1],
      ["target.modules.0.semanticsVersion", 0],
      ["target.modules.0.requires", { missing: "*" }],
      ["target.modules.0.migrationTable", "../outside"],
      ["target.modules.0.packageVersion", ""],
      ["target.modules.0.name", "x".repeat(65)],
    ],
    "rejects malformed %s=%j",
    (path, replacement) => {
      const input = request();
      change(input, path as string, replacement);
      refused(() => readBackupVerificationRequest(JSON.stringify(input)));
    },
  );
  each(
    [
      "secret",
      "archive.path",
      "backupKey.secret",
      "target.runtime.sourceRevision",
      "target.modules.0.extra",
      "attempt.extra",
    ],
    "rejects unknown key %s",
    (path) => {
      const input = request();
      change(input, path, "private-value");
      refused(() => readBackupVerificationRequest(JSON.stringify(input)));
    },
  );
  each(
    ['{"captureId":"replaced",', '{"\\u0063aptureId":"replaced",'],
    "rejects duplicate decoded root keys: %s",
    (prefix) => {
      refused(() =>
        readBackupVerificationRequest(prefix + JSON.stringify(VECTOR).slice(1)),
      );
    },
  );
  it("rejects duplicate nested keys before JSON parsing loses them", () => {
    refused(() =>
      readBackupVerificationRequest(
        JSON.stringify(VECTOR).replace(
          '"bytes":8388608',
          '"bytes":1,"bytes":8388608',
        ),
      ),
    );
    refused(() =>
      readBackupVerificationRequest(
        JSON.stringify(VECTOR).replace('"orders":0', '"orders":1,"orders":0'),
      ),
    );
  });
  each(
    ["-0", "2.0", "2e0", "02", "NaN", "Infinity"],
    "rejects noncanonical integer spelling %s",
    (spelling) => {
      refused(() =>
        readBackupVerificationRequest(
          JSON.stringify(VECTOR).replace('"number":1', '"number":' + spelling),
        ),
      );
    },
  );
  each(
    [
      "",
      "null",
      "[]",
      "true",
      "{}",
      '{"a":',
      JSON.stringify(VECTOR) + " trailing",
      "[".repeat(40) + "]".repeat(40),
    ],
    "refuses malformed or wrong-root JSON %s",
    (raw) => {
      refused(() => readBackupVerificationRequest(raw));
    },
  );
  it("bounds bytes and map sizes", () => {
    refused(() =>
      readBackupVerificationRequest(" ".repeat(65536) + JSON.stringify(VECTOR)),
    );
    const input = request();
    input.archive.modules = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => ["module-" + i, 0]),
    );
    refused(() => readBackupVerificationRequest(JSON.stringify(input)));
  });
  it("admits well-formed unsupported manifest versions without qualifying them", () => {
    const input = request();
    input.archive.manifestVersion = 2;
    const admitted = readBackupVerificationRequest(JSON.stringify(input));
    assert.equal(admitted.archive.manifestVersion, 2);
    const output = result();
    output.requestDigest = backupVerificationRequestDigest(admitted);
    refused(() =>
      readBackupVerificationResult(JSON.stringify(output), admitted),
    );
    output.status = "unsupported";
    output.reason = "archive_format_unsupported";
    output.modules = [];
    assert.equal(
      readBackupVerificationResult(JSON.stringify(output), admitted).status,
      "unsupported",
    );
  });
});

describe("private backup result admission", () => {
  it("admits only complete measured passed output", () => {
    const output = result();
    const admitted = readBackupVerificationResult(
      JSON.stringify(output),
      request(),
    );
    assert.deepEqual(admitted, output);
    assert.equal(Object.isFrozen(admitted.modules[0]!.checks), true);
  });
  each(
    [
      ["protocol", "v2"],
      ["requestDigest", "3".repeat(64)],
      ["attemptToken", "other"],
      ["targetDigest", "3".repeat(64)],
      ["policyDigest", "3".repeat(64)],
      ["activation", "attempted"],
      ["measuredArchive", null],
      ["measuredArchive.sha256", "3".repeat(64)],
      ["measuredArchive.bytes", 8388607],
      ["modules", []],
      ["modules", [result().modules[0]]],
      ["modules", [result().modules[0], result().modules[0]]],
      ["modules.0.name", "unknown"],
      ["modules.0.semanticsVersion", 2],
      ["modules.0.checks", []],
      [
        "modules.0.checks",
        [
          { code: "data", status: "passed" },
          { code: "data", status: "passed" },
        ],
      ],
      ["modules.0.checks", [{ code: "arbitrary", status: "passed" }]],
      ["modules.0.checks.0.status", "invalid"],
      ["modules.0.status", "invalid"],
      ["status", "other"],
      ["reason", "unexpected"],
      ["secret", "private"],
      ["modules.0.path", "/private"],
      ["modules.0.checks.0.detail", "private"],
      ["measuredArchive.filename", "private"],
    ],
    "rejects forged or incomplete result field %s",
    (path, replacement) => {
      const output = result();
      change(output, path as string, replacement);
      refused(() =>
        readBackupVerificationResult(JSON.stringify(output), request()),
      );
    },
  );
  each(
    [
      ["invalid", "archive_digest_mismatch"],
      ["invalid", "module_integrity"],
      ["needs_authority", "module_data_check_requires_authority"],
      ["unsupported", "semantics_missing"],
      ["unavailable", "decryption_unavailable"],
      ["unavailable", "cleanup_uncertain"],
    ],
    "admits bounded early %s/%s without claiming success",
    (status, reason) => {
      const output = {
        ...result(),
        status,
        reason,
        modules: [],
        measuredArchive: null,
      };
      assert.deepEqual(
        readBackupVerificationResult(JSON.stringify(output), request()),
        output,
      );
    },
  );
  it("requires status agreement in failed owner checks", () => {
    const output = result();
    output.status = "invalid";
    output.reason = "module_integrity";
    output.modules[0]!.status = "invalid";
    output.modules[0]!.checks[0]!.status = "invalid";
    assert.equal(
      readBackupVerificationResult(JSON.stringify(output), request()).status,
      "invalid",
    );
    output.modules[0]!.status = "passed";
    refused(() =>
      readBackupVerificationResult(JSON.stringify(output), request()),
    );
  });
  it("refuses an inconclusive owner being reported as corruption", () => {
    const output = result();
    output.status = "invalid";
    output.reason = "module_integrity";
    output.modules[0]!.status = "unsupported";
    output.modules[0]!.checks[0]!.status = "unsupported";
    refused(() =>
      readBackupVerificationResult(JSON.stringify(output), request()),
    );
  });
  it("rejects duplicate result keys and oversized or excessive checks", () => {
    refused(() =>
      readBackupVerificationResult(
        '{"status":"invalid",' + JSON.stringify(result()).slice(1),
        request(),
      ),
    );
    refused(() =>
      readBackupVerificationResult(
        " ".repeat(32768) + JSON.stringify(result()),
        request(),
      ),
    );
    const output = result();
    output.modules[0]!.checks = Array.from({ length: 17 }, () => ({
      code: "data",
      status: "passed",
    }));
    refused(() =>
      readBackupVerificationResult(JSON.stringify(output), request()),
    );
  });
});

describe("additional private wire boundaries", () => {
  each(
    [
      ["archive.modules", null],
      ["archive.modules", []],
      ["target.modules.0.requires", []],
      ["target.modules.1.migrationTable", "__drizzle_migrations_db"],
      ["target.modules.0.requires", { core: "" }],
      ["target.modules.0.requires", { core: ">=1.0.0\t<2.0.0" }],
      ["target.modules.0", null],
      ["archive.sha256", 1],
      ["attempt.number", true],
      ["archive.modules.core", false],
    ],
    "rejects ill-typed nested field %s",
    (path, replacement) => {
      const input = request();
      change(input, path as string, replacement);
      refused(() => readBackupVerificationRequest(JSON.stringify(input)));
    },
  );
  each(
    [
      '{"a" 1}',
      "[1 2]",
      '{"a":1 "b":2}',
      '"unterminated',
      String.raw`{"a":"\q"}`,
      '{"a":1,}',
      "[1,]",
    ],
    "rejects broken JSON grammar %s",
    (raw) => {
      refused(() => readBackupVerificationRequest(raw));
    },
  );
  it("refuses non-string transport values with the same private error", () => {
    refused(() => readBackupVerificationRequest(null as unknown as string));
  });
  it("admits a sole not-applicable check but refuses it alongside ordinary checks", () => {
    const output = result();
    output.modules[0]!.checks = [{ code: "not_applicable", status: "passed" }];
    assert.deepEqual(
      readBackupVerificationResult(JSON.stringify(output), request())
        .modules[0]!.checks,
      [{ code: "not_applicable", status: "passed" }],
    );
    output.modules[0]!.checks.push({ code: "data", status: "passed" });
    refused(() =>
      readBackupVerificationResult(JSON.stringify(output), request()),
    );
    output.modules[0]!.checks = [{ code: "not_applicable", status: "invalid" }];
    output.modules[0]!.status = "invalid";
    output.status = "invalid";
    output.reason = "module_integrity";
    refused(() =>
      readBackupVerificationResult(JSON.stringify(output), request()),
    );
  });
  it("admits mixed-status precedence and an unavailable cleanup after completed checks", () => {
    const output = result();
    output.status = "unsupported";
    output.reason = "semantics_missing";
    output.modules[0]!.status = "unsupported";
    output.modules[0]!.checks = [
      { code: "data", status: "invalid" },
      { code: "secret", status: "unsupported" },
    ];
    assert.equal(
      readBackupVerificationResult(JSON.stringify(output), request()).status,
      "unsupported",
    );
    output.status = "unavailable";
    output.reason = "cleanup_uncertain";
    assert.equal(
      readBackupVerificationResult(JSON.stringify(output), request()).status,
      "unavailable",
    );
  });
});

function each(
  rows: readonly unknown[],
  name: string,
  run: (...args: any[]) => void,
) {
  for (const row of rows) {
    const args = Array.isArray(row) ? row : [row];
    it(format(name, ...args), () => run(...args));
  }
}

// These boundaries catch parsers that validate only the value after a permissive decode.
describe("wire limits and complete outcome matrix", () => {
  it("accepts the exact request byte budget and refuses one extra byte", () => {
    const raw = JSON.stringify(VECTOR);
    const bounded = raw + " ".repeat(65536 - Buffer.byteLength(raw));
    assert.equal(readBackupVerificationRequest(bounded).pointId, "capture-1");
    refused(() => readBackupVerificationRequest(bounded + " "));
  });
  it("accepts the exact result byte budget and refuses one extra byte", () => {
    const raw = JSON.stringify(result());
    const bounded = raw + " ".repeat(32768 - Buffer.byteLength(raw));
    assert.equal(
      readBackupVerificationResult(bounded, request()).status,
      "passed",
    );
    refused(() => readBackupVerificationResult(bounded + " ", request()));
  });
  it("accepts 64 source modules and refuses the 65th", () => {
    const input = request();
    input.archive.modules = Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => ["owner-" + i, 0]),
    );
    assert.equal(
      Object.keys(
        readBackupVerificationRequest(JSON.stringify(input)).archive.modules,
      ).length,
      64,
    );
    input.archive.modules = { ...input.archive.modules, extra: 0 };
    refused(() => readBackupVerificationRequest(JSON.stringify(input)));
  });
  each(
    [
      ["captureId", "x".repeat(129)],
      ["pointId", "x".repeat(129)],
      ["sourceInstallationId", "x".repeat(129)],
      ["sourceNodeId", "x".repeat(129)],
      ["attempt.jobId", "x".repeat(129)],
      ["attempt.claimId", "x".repeat(129)],
      ["attempt.controllerScope", "x".repeat(129)],
      ["attempt.childToken", "x".repeat(129)],
      ["target.runtime.release", "x".repeat(257)],
      ["target.modules.0.packageVersion", "x".repeat(257)],
      ["target.modules.1.requires.core", "x".repeat(257)],
      ["target.modules.0.name", "Core"],
      ["target.modules.0.name", "../core"],
      ["archive.modules", { ["x".repeat(65)]: 0 }],
    ],
    "refuses excessive or malformed %s",
    (path, replacement) => {
      const input = request();
      change(input, path, replacement);
      refused(() => readBackupVerificationRequest(JSON.stringify(input)));
    },
  );
  it("accepts the exact archive size ceiling and refuses an unsafe integer", () => {
    const input = request();
    input.archive.bytes = 536870912;
    assert.equal(
      readBackupVerificationRequest(JSON.stringify(input)).archive.bytes,
      536870912,
    );
    refused(() =>
      readBackupVerificationRequest(
        JSON.stringify(input).replace("536870912", "9007199254740992"),
      ),
    );
  });
  it("refuses invalid UTF-8 bytes and replacement characters without private diagnostics", () => {
    const invalid = Buffer.from([0xc3, 0x28]);
    refused(() => readBackupVerificationRequest(invalid as unknown as string));
    refused(() =>
      readBackupVerificationResult(invalid as unknown as string, request()),
    );
    refused(() =>
      readBackupVerificationRequest(
        JSON.stringify(VECTOR).replace("node-1", invalid.toString("utf8")),
      ),
    );
  });
  each(
    [
      ["passed", "none"],
      ["invalid", "archive_digest_mismatch"],
      ["invalid", "archive_size_mismatch"],
      ["invalid", "archive_invalid"],
      ["invalid", "binding_mismatch"],
      ["invalid", "sqlite_integrity"],
      ["invalid", "module_integrity"],
      ["invalid", "secret_invalid"],
      ["needs_authority", "module_data_check_requires_authority"],
      ["unsupported", "archive_format_unsupported"],
      ["unsupported", "module_missing"],
      ["unsupported", "target_incompatible"],
      ["unsupported", "semantics_missing"],
      ["unsupported", "secret_format_unsupported"],
      ["unavailable", "request_invalid"],
      ["unavailable", "secret_unavailable"],
      ["unavailable", "decryption_unavailable"],
      ["unavailable", "cancelled"],
      ["unavailable", "deadline"],
      ["unavailable", "resource_limit"],
      ["unavailable", "cleanup_uncertain"],
      ["unavailable", "unexpected"],
    ],
    "keeps %s/%s within its outcome category",
    (status, reason) => {
      const output =
        status === "passed"
          ? result()
          : { ...result(), modules: [], measuredArchive: null };
      output.status = status;
      output.reason = reason;
      assert.equal(
        readBackupVerificationResult(JSON.stringify(output), request()).reason,
        reason,
      );
      for (const other of [
        "passed",
        "invalid",
        "needs_authority",
        "unsupported",
        "unavailable",
      ]) {
        if (other === status) continue;
        output.status = other;
        refused(() =>
          readBackupVerificationResult(JSON.stringify(output), request()),
        );
      }
    },
  );
  each(
    [
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
    ],
    "accepts the bounded check code %s",
    (code) => {
      const output = result();
      output.modules[0]!.checks = [{ code, status: "passed" }];
      assert.equal(
        readBackupVerificationResult(JSON.stringify(output), request())
          .modules[0]!.checks[0]!.code,
        code,
      );
    },
  );
  it("refuses decoded duplicate map, result owner and check keys", () => {
    refused(() =>
      readBackupVerificationRequest(
        JSON.stringify(VECTOR).replace('"core":2', '"core":3,"\\u0063ore":2'),
      ),
    );
    const raw = JSON.stringify(result());
    for (const [field, replacement] of [
      ['"name":"core"', '"name":"unknown","\\u006eame":"core"'],
      ['"code":"data"', '"code":"secret","\\u0063ode":"data"'],
      ['"bytes":8388608', '"bytes":1,"\\u0062ytes":8388608'],
    ])
      refused(() =>
        readBackupVerificationResult(
          raw.replace(field!, replacement!),
          request(),
        ),
      );
  });
});

// Depth is checked before an invalid outer shape can conceal an expensive nested input.
it("bounds_json_depth_before_shape_validation", () => {
  const atLimit = "[".repeat(32) + "0" + "]".repeat(32);
  assert.ok(Array.isArray(parseBackupVerificationJson(atLimit, 65536)));
  refused(() => parseBackupVerificationJson("[" + atLimit + "]", 65536));
});
it("bounds_complete_target_owner_count", () => {
  const input = request().target;
  input.modules = Array.from({ length: 64 }, (_, i) => ({
    ...input.modules[0]!,
    name: "owner-" + i,
    migrationTable: "__owner_" + i,
    requires: {},
  }));
  Object.assign(input, backupVerificationTargetDigests(input));
  assert.equal(validateBackupVerificationTarget(input).modules.length, 64);
  input.modules = [
    ...input.modules,
    { ...input.modules[0]!, name: "extra", migrationTable: "__extra" },
  ];
  Object.assign(input, backupVerificationTargetDigests(input));
  refused(() => validateBackupVerificationTarget(input));
});
it("refuses_extended_years_even_when_Date_round_trips_them", () => {
  for (const path of ["capturedAt", "attempt.deadline"]) {
    const input = request();
    change(input, path, "+010000-10-20T08:00:00.000Z");
    refused(() => readBackupVerificationRequest(JSON.stringify(input)));
  }
});
it("refuses_wrong_owner_semantics_on_nonpassing_output", () => {
  const output = result();
  output.status = "invalid";
  output.reason = "module_integrity";
  output.modules[0]!.status = "invalid";
  output.modules[0]!.checks[0]!.status = "invalid";
  output.modules[0]!.semanticsVersion = 2;
  refused(() =>
    readBackupVerificationResult(JSON.stringify(output), request()),
  );
});
