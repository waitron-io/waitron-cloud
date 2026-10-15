import assert from 'node:assert/strict';

const shortPackages = ['@waitron-cloud/identity', '@waitron-cloud/operations', '@waitron-cloud/remote-access'];

export function packageMembers(row) {
  assert.ok(row && typeof row.package === 'string' && row.package.length > 0, 'Invalid package group row');
  if (!Object.hasOwn(row, 'members')) {
    assert.match(row.package, /^@waitron-cloud\/[a-z-]+$/, 'Invalid package group name');
    return [row.package];
  }
  assert.deepEqual(Object.keys(row).sort(), ['members', 'package', 'shard'], 'Invalid package group fields');
  assert.ok(Array.isArray(row.members) && row.members.length >= 2, 'Invalid package group members');
  assert.deepEqual(row.members, shortPackages.filter(name => row.members.includes(name)), 'Invalid package group members or order');
  assert.equal(row.package, row.members.join(' + '), 'Invalid package group label');
  assert.equal(row.shard, 1, 'Invalid package group shard');
  return row.members;
}

export function groupShortPackages(rows) {
  const selected = shortPackages.filter(name => rows.some(row => row.package === name && !row.shards));
  if (selected.length < 2) return rows;
  const group = {package: selected.join(' + '), members: selected, shard: 1};
  return [...rows.filter(row => !selected.includes(row.package)), group];
}
