import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readVerificationTarget } from "../src/verification-target.ts";
import {
  backupVerificationTargetDigests,
  validateBackupVerificationTarget,
} from "../src/verification-protocol.ts";

const raw = readFileSync(
  new URL("../../../deploy/backup-verifier/target.json", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(raw);
const owners = [
  "adjustments",
  "bookings",
  "catalogue",
  "core",
  "credentials",
  "fiscal-none",
  "fiscal-verifactu",
  "identity",
  "media",
  "payments",
  "scheduler",
  "staffing",
  "venue-service",
  "workforce",
  "workforce-es",
];
const digest =
  "2e9a53ebe041b37415b0983563edaa1529714b42f3cd2637987b976667164d10";

function rehash(value: typeof manifest) {
  Object.assign(value, backupVerificationTargetDigests(value));
  return JSON.stringify(value);
}

// A descriptor with a recomputed digest can still describe the wrong installed binary.
test("complete_pinned_public_target_includes_every_owner", () => {
  const target = readVerificationTarget(raw);
  assert.equal(target.digest, digest);
  assert.equal(
    target.runtime.fingerprint,
    "a62d25dfd879e6092efd9f6ffac64dd1f08304585d4e0e535535a53e7b818cf6",
  );
  assert.deepEqual(target.modules.map((m) => m.name).sort(), owners);
  assert.equal(target.modules.find((m) => m.name === "fiscal-none")!.schema, 0);
  assert.equal(target.modules.find((m) => m.name === "core")!.schema, 185);
  assert.equal(
    target.modules.find((m) => m.name === "core")!.packageVersion,
    "0.0.0",
  );
  assert.ok(Object.isFrozen(target.modules[0]!.requires));
});

test("target_ordering_does_not_change_its_identity", () => {
  const value = structuredClone(manifest);
  value.modules.reverse();
  for (const module of value.modules)
    module.requires = Object.fromEntries(
      Object.entries(module.requires).reverse(),
    );
  assert.equal(readVerificationTarget(JSON.stringify(value)).digest, digest);
});

const mutations: [string, (value: typeof manifest) => void][] = [
  [
    "release",
    (v) => {
      v.runtime.release = "waitron-other";
    },
  ],
  [
    "revision",
    (v) => {
      v.runtime.revision = "e".repeat(40);
    },
  ],
  [
    "fingerprint",
    (v) => {
      v.runtime.fingerprint = "e".repeat(64);
    },
  ],
  [
    "package version",
    (v) => {
      v.modules[0].packageVersion = "0.0.1";
    },
  ],
  [
    "dependency range",
    (v) => {
      v.modules[0].requires.core = ">=1.0.0";
    },
  ],
  [
    "dependency omission",
    (v) => {
      v.modules[0].requires = {};
    },
  ],
  [
    "schema",
    (v) => {
      v.modules[0].schema += 1;
    },
  ],
  [
    "SQL table",
    (v) => {
      v.modules[0].migrationTable = "__different";
    },
  ],
  [
    "SQL digest",
    (v) => {
      v.modules[0].migrationDigest = "e".repeat(64);
    },
  ],
  [
    "semantics",
    (v) => {
      v.modules[0].semanticsVersion = 2;
    },
  ],
  [
    "policy",
    (v) => {
      v.modules[0].policyDigest = "e".repeat(64);
    },
  ],
  [
    "inactive owner omitted",
    (v) => {
      v.modules = v.modules.filter(
        (m: { name: string }) => m.name !== "fiscal-none",
      );
    },
  ],
];
for (const [name, mutate] of mutations) {
  test(`configured_target_refuses_rehashed_${name}`, () => {
    const value = structuredClone(manifest);
    mutate(value);
    const forged = rehash(value);
    // Structurally valid alternative targets do not qualify the configured release.
    assert.notEqual(
      validateBackupVerificationTarget(JSON.parse(forged)).digest,
      digest,
    );
    assert.throws(() => readVerificationTarget(forged), {
      message: "Invalid backup verification target",
    });
  });
  test(`target_refuses_unhashed_${name}`, () => {
    const value = structuredClone(manifest);
    mutate(value);
    assert.throws(() => validateBackupVerificationTarget(value));
    assert.throws(() => readVerificationTarget(JSON.stringify(value)));
  });
}

for (const key of Object.keys(manifest)) {
  test(`manifest_requires_${key}`, () => {
    const value = structuredClone(manifest);
    delete value[key];
    assert.throws(() => readVerificationTarget(JSON.stringify(value)));
  });
}

test("manifest_refuses_duplicate_keys_and_private_fields", () => {
  assert.throws(() =>
    readVerificationTarget('{"version":1,' + raw.trim().slice(1)),
  );
  assert.throws(() =>
    readVerificationTarget(
      raw.replace('"release":', '"\\u0072elease":"other","release":'),
    ),
  );
  assert.throws(() =>
    readVerificationTarget(
      JSON.stringify({ ...manifest, secret: "never-log-this" }),
    ),
  );
});

test("bounds_complete_manifest_transport", () => {
  const bounded = raw + " ".repeat(30000 - Buffer.byteLength(raw));
  assert.equal(readVerificationTarget(bounded).digest, digest);
  assert.throws(() => readVerificationTarget(bounded + " "));
});

for (const [name, mutate] of [
  [
    "missing dependency owner",
    (v: typeof manifest) => {
      v.modules[0].requires = { missing: "*" };
    },
  ],
  [
    "duplicate migration table",
    (v: typeof manifest) => {
      v.modules[1].migrationTable = v.modules[0].migrationTable;
    },
  ],
  [
    "invalid owner name",
    (v: typeof manifest) => {
      v.modules[0].name = "../owner";
    },
  ],
  [
    "empty package version",
    (v: typeof manifest) => {
      v.modules[0].packageVersion = "";
    },
  ],
  [
    "zero semantics",
    (v: typeof manifest) => {
      v.modules[0].semanticsVersion = 0;
    },
  ],
  [
    "negative schema",
    (v: typeof manifest) => {
      v.modules[0].schema = -1;
    },
  ],
  [
    "fractional schema",
    (v: typeof manifest) => {
      v.modules[0].schema = 1.5;
    },
  ],
  [
    "unsafe schema integer",
    (v: typeof manifest) => {
      v.modules[0].schema = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
] as [string, (value: typeof manifest) => void][]) {
  test(`self_consistent_target_still_refuses_${name}`, () => {
    const value = structuredClone(manifest);
    mutate(value);
    const forged = rehash(value);
    assert.throws(() => validateBackupVerificationTarget(JSON.parse(forged)), {
      message: "Invalid backup verification protocol",
    });
  });
}

for (const key of [
  "compositionDigest",
  "migrationDigest",
  "policyDigest",
  "digest",
]) {
  test(`generic_target_recomputes_${key}`, () => {
    const value = structuredClone(manifest);
    value[key] = "f".repeat(64);
    assert.throws(() => validateBackupVerificationTarget(value));
  });
}

// An internally valid older bundle must not qualify the current worker-denying release.
test("previous_release_target_cannot_qualify_the_current_verifier", () => {
  const previous = readFileSync(new URL("fixtures/verification-target-a850.json", import.meta.url), "utf8");
  assert.equal(validateBackupVerificationTarget(JSON.parse(previous)).runtime.revision, "5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa");
  assert.throws(() => readVerificationTarget(previous), {message: "Invalid backup verification target"});
});
