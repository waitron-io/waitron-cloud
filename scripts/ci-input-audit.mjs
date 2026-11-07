import assert from 'node:assert/strict';

export const unreadMarkdown = path => typeof path === 'string' && path !== 'docs/cloud-cost-model.md' &&
  path !== 'docs/waitron-integration-contract.md' &&
  /^(?:docs\/(?!receipts\/)(?:[^/]+\/)*[^/]+\.md|[^/]+\.md)$/.test(path) &&
  !path.split('/').some(part => part === '.' || part === '..' || part.includes('\\'));

function parseEntries(source) {
  const records = source.split('\0');
  assert.equal(records.pop(), '', 'Incomplete input audit inventory');
  const paths = new Set();
  return records.map(raw => {
    const match = raw.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
    assert.ok(match, 'Malformed input audit inventory');
    const [, mode, type, objectId, path] = match;
    assert.ok(!paths.has(path), `Duplicate input audit path: ${path}`);
    paths.add(path);
    return {mode, type, objectId, path};
  });
}

export function readInputInventory(revision, git) {
  assert.match(revision, /^[a-f0-9]{40}$/, 'Input inventory requires an immutable revision');
  const source = git('ls-tree', '-rz', '--full-tree', revision);
  // A replacement character could conceal undecodable Git path bytes.
  assert.ok(!source.includes('\ufffd'), 'Unclassified input path encoding');
  const entries = parseEntries(source);
  assert.ok(entries.every(({path}) => !/[\\\r\n]/.test(path) &&
    !path.split('/').some(part => ['', '.', '..'].includes(part))), 'Unclassified input path');
  return entries;
}
