import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBackupVerificationTarget} from '../../../packages/backups/src/verification-protocol.ts';

export async function readRehearsalVerificationTarget() {
  const path = new URL('../../backup-verifier/amazon-test-target.json', import.meta.url);
  return validateBackupVerificationTarget(JSON.parse(await readFile(path, 'utf8')));
}

// A newer opt-in image qualifies only its own target in the disposable proof database.
export function selectIntegrationVerificationTarget({revision, pinnedTarget, nativeTarget, requireNativeMatch = false}) {
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  const pinned = validateBackupVerificationTarget(pinnedTarget);
  if (!requireNativeMatch && revision === pinned.runtime.revision) return pinned;
  const selected = validateBackupVerificationTarget(nativeTarget);
  assert.equal(selected.runtime.revision, revision);
  if (requireNativeMatch) assert.deepEqual(selected, pinned, 'integration.services_waitron_pin');
  return selected;
}
