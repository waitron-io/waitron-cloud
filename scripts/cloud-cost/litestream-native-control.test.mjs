import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('official list-control failures name their stage without exposing the binary path', () => {
  const root = new URL('./', import.meta.url).href;
  const hook = `import {registerHooks} from 'node:module';registerHooks({resolve(s,c,next){return s.startsWith('/code/')
    ? {url:${JSON.stringify(root)}+s.slice(6),shortCircuit:true}:next(s,c);}});`;
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(hook),
    new URL('./fixtures/litestream-list-control.mjs', import.meta.url).pathname, '/missing/PRIVATE_CANARY'],
    { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.stdout, '');
  const records = result.stderr.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
  assert.ok(records.some(r => r.kind === 'litestream-native-control' && r.stage === 'version' && r.status === 'rejected'));
  assert.equal(result.stderr.includes('PRIVATE_CANARY'), false);
});
