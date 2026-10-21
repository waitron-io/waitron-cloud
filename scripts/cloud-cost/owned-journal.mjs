import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertOwnedRoot } from './schema.mjs';

// One synchronous writer owns this journal; external observers must always see complete JSON.
export function recordOwnedResource(args, entry) {
  assertOwnedRoot(args);
  const value = JSON.parse(readFileSync(args.journal.path, 'utf8'));
  (value.localResources ??= []).push(entry);
  const pending = join(dirname(args.journal.path), '.cloud-cost-journal-' + randomUUID());
  let fd, created = false;
  try {
    fd = openSync(pending, 'wx', 0o600); created = true;
    writeFileSync(fd, JSON.stringify(value));
    closeSync(fd); fd = undefined;
    assertOwnedRoot(args);
    renameSync(pending, args.journal.path); created = false;
  } finally {
    try { if (fd !== undefined) closeSync(fd); }
    finally { if (created) unlinkSync(pending); }
  }
}
