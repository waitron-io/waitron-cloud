import assert from 'node:assert/strict';
import {validateBackupVerificationTarget} from '../../../packages/backups/src/verification-protocol.ts';

// A newer opt-in image qualifies only its own target in the disposable proof database.
export function selectIntegrationVerificationTarget({revision, pinnedTarget, nativeTarget}) {
  assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  const pinned = validateBackupVerificationTarget(pinnedTarget);
  if (revision === pinned.runtime.revision) return pinned;
  const selected = validateBackupVerificationTarget(nativeTarget);
  assert.equal(selected.runtime.revision, revision);
  return selected;
}
