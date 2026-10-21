import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { calculateCosts } from './calculator.mjs';
const module = await import('./render.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./render.mjs', import.meta.url).href) return {};
  throw error;
});
const read = name => JSON.parse(readFileSync(new URL('../../docs/cost-model/' + name + '.json', import.meta.url)));
const fixture = () => ({ prices: read('prices'), inventory: read('inventory'), samples: read('local-driver-evidence').experiments,
  settings: read('projection-settings') });
const prepare = input => {
  assert.equal(typeof module.prepareCalculatorData, 'function', 'embed only validated public inputs');
  return module.prepareCalculatorData(input);
};

test('offlineInputsKeepMeasuredSourcesAndExcludePrivateOrExecutableFields', async () => {
  const data = prepare(fixture());
  assert.equal(data.basis.sales, 207); assert.equal(data.basis.archiveBytes, 3527677);
  assert.equal(data.basis.ownerBytesOut, 2836968);
  assert.equal(data.basis.sources.archive.revision, '73cd7239fc24d34271bca351e5b23c20aa9295ca');
  assert.equal(typeof module.renderCalculator, 'function');
  const html = await module.renderCalculator({ data });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(Buffer.byteLength(html) < 500000, 'one compact offline file');
  for (const alter of [f => { f.samples.stream.raw = 'PRIVATE_CANARY'; }, f => { f.raw = 'PRIVATE_CANARY'; },
    f => { f.prices.raw = 'PRIVATE_CANARY'; }, f => { f.inventory.raw = 'PRIVATE_CANARY'; }]) {
    const f = fixture(); alter(f); assert.throws(() => prepare(f), { message: 'Invalid cloud cost calculator' });
  }
});

// Deliberate script terminators in a public price description must remain data.
test('embeddedPublicDescriptionsCannotExecuteAsHtmlOrJavaScript', async () => {
  const data = prepare(fixture()); data.prices[0].product = '</script><script>globalThis.INJECTED=1</script>';
  const html = await module.renderCalculator({ data });
  assert.ok(!html.includes('<script>globalThis.INJECTED=1</script>'));
  const json = html.match(/<script id="cost-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json); assert.deepEqual(JSON.parse(json), data);
});

test('nodeAndBundledBrowserCalculationsAgreeBeforeDisplayRounding', async () => {
  const data = prepare(fixture()), { defaultControls } = await import('./calculator.mjs');
  const controls = defaultControls(data);
  Object.assign(controls, { capacity: 10, databaseCapacity: 100, sessionsPerMonth: 3, publicGB: 0 });
  const { build } = createRequire(new URL('../../packages/ui-smoke/package.json', import.meta.url))('esbuild');
  const result = await build({ stdin: { contents: "export { calculateCosts } from './calculator.mjs';", resolveDir: import.meta.dirname },
    bundle: true, platform: 'browser', format: 'iife', globalName: 'Model', write: false });
  const browser = runInNewContext('globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));\n' +
    result.outputFiles[0].text + '\nJSON.stringify(Model.calculateCosts(' + JSON.stringify({ data, controls }) + '))');
  assert.deepEqual(JSON.parse(browser), calculateCosts({ data, controls }));
});

test('renderingRejectsAnExecutableInputBeforeReadingItsData', async () => {
  let called = 0; const input = {};
  Object.defineProperty(input, 'data', { get() { called++; throw Error('PRIVATE_CANARY'); } });
  await assert.rejects(module.renderCalculator(input), { message: 'Invalid cloud cost calculator' });
  assert.equal(called, 0);
});
