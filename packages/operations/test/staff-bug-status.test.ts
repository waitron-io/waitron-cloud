import assert from 'node:assert/strict';
import {test} from 'node:test';

for (const [name, labels, state, expected] of [
 ['closure alone', [], 'closed', ['open', null]],
 ['work label', ['IN PROGRESS'], 'closed', ['in_progress', null]],
 ['release label outranks work, even after reopening', ['in progress', 'Fixed in 1.2.4'], 'open', ['fixed', '1.2.4']],
 ['bare release label conflicts', ['fixed in', 'fixed in 1.2.4'], 'closed', ['open', null]],
 ['two releases conflict', ['fixed in 1.2.3', 'fixed in 1.2.4', 'in progress'], 'closed', ['in_progress', null]],
 ['non-canonical version', ['fixed in 01.2.4'], 'closed', ['open', null]],
 ['oversized version', ['fixed in 2147483648.0.0'], 'closed', ['open', null]],
] as const) test(`GitHub bug status handles ${name}`, async () => {
 const {staffBugStatus} = await import('../src/staff-bug-status.ts');
 assert.deepEqual(staffBugStatus({state, labels: labels.map(name => ({name})), title: 'Ignored issue text'}), expected);
});
