import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, rm, rename, copyFile, chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {integrationLitestreamRelease} from './integration-litestream-release.mjs';

assert.equal(process.arch, 'x64');
const {version, checksum, url} = integrationLitestreamRelease(
  await readFile('/waitron/packages/stream/src/litestream.ts', 'utf8'));
const response = await fetch(url);
assert.equal(response.ok, true);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), checksum);
await writeFile('/tmp/litestream.tgz', bytes);
execFileSync('tar', ['-xzf', '/tmp/litestream.tgz', '-C', '/usr/local/bin', 'litestream']);
await rm('/tmp/litestream.tgz');
await rename('/usr/local/bin/litestream', '/usr/local/bin/litestream-native');
await copyFile('/proof/litestream', '/usr/local/bin/litestream');
await chmod('/usr/local/bin/litestream', 0o755);
assert.equal(execFileSync('litestream', ['version'], {encoding: 'utf8'}).trim(), version);
