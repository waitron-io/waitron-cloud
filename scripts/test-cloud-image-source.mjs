import assert from 'node:assert/strict';
import {measureIntegrationFiles} from '../deploy/test-cloud/test-fixtures/integration-source.mjs';

try {
  let text = '';
  for await (const part of process.stdin) {
    text += part; assert.ok(Buffer.byteLength(text) <= 2 * 1024 * 1024);
  }
  const input = JSON.parse(text);
  assert.deepEqual(Object.keys(input), ['files']);
  process.stdout.write(JSON.stringify(await measureIntegrationFiles(process.cwd(), input.files)) + '\n');
} catch {process.stderr.write('Integration image source refused\n'); process.exitCode = 1;}
