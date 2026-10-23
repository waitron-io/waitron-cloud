import assert from 'node:assert/strict';
import test from 'node:test';
import {inspect} from 'node:util';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';

// Concurrent fixture consumers share the host's ephemeral TCP port space.
test('sixteen genuine storage fixtures start together without losing an allocation', {timeout:90000}, async t => {
  const results = await Promise.allSettled(Array.from({length:16}, () => startBackupStorage()));
  try {
    for (const [index,result] of results.entries()) {
      if (result.status === 'rejected') t.diagnostic('storage startup '+index+' rejected: '+inspect(result.reason,{depth:8}));
    }
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 16);
  } finally {
    await Promise.all(results.filter(result => result.status === 'fulfilled').map(result => result.value.stop()));
  }
});
