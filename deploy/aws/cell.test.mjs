import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSuite } from './check.mjs';

// Crossing a zone binding, enabling a public endpoint or granting an unnamed
// administrator must fail the actual offline plan's original assertions.
test('cell plans keep three private fixed-capacity zone groups and explicit administration', async () => {
  assert.match(await runSuite('cell'), /Success! 30 passed, 0 failed/);
});
