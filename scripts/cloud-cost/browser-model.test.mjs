import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { priceUsage } from './model.mjs';
const { build } = createRequire(new URL('../../packages/ui-smoke/package.json', import.meta.url))('esbuild');

// Importing filesystem or private replay code into the calculator breaks offline use.
test('theSameValidatedModelRunsInABrowserWithoutNodeOrPrivateReplayAccess', async () => {
  const output = await build({ stdin: { contents: "export { priceUsage, estimate, forecastArchives, retainedBytes } from './model.mjs';",
    resolveDir: import.meta.dirname }, bundle: true, platform: 'browser', format: 'iife', globalName: 'CloudCostModel', write: false });
  const input = { id: 'request-count', value: 9, status: 'assumed', source: 'assumption:workload-assumption',
    unit: 'Requests', scope: 'usage', region: 'eu-south-2', observedAt: null, effectiveAt: null,
    bounds: { low: 9, base: 9, high: 9, assumption: 'workload-assumption' }, reason: 'workload-assumption' };
  const nodeResult = priceUsage(input, []);
  const browserResult = runInNewContext(output.outputFiles[0].text +
    '\nJSON.stringify(CloudCostModel.priceUsage(' + JSON.stringify(input) + ', []))', { structuredClone });
  assert.deepEqual(JSON.parse(browserResult), nodeResult);
  assert.equal(nodeResult.cost, null); assert.deepEqual(nodeResult.gaps, ['request-count:not-priced']);
});
