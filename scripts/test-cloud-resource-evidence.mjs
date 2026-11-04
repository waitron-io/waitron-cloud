import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createTestCloudResourceEvidence} from '../deploy/test-cloud/test-fixtures/integration-resource-evidence.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3);
    const file = await open(process.argv[2], 'r');
    let contents;
    try {
      assert.ok((await file.stat()).size <= 2 * 1024 * 1024);
      contents = await file.readFile();
      assert.ok(contents.length <= 2 * 1024 * 1024);
    } finally {await file.close();}
    const resources = createTestCloudResourceEvidence(JSON.parse(contents));
    process.stdout.write(JSON.stringify(resources) + '\n');
  } catch {process.stderr.write('Test Cloud resource evidence refused\n'); process.exitCode = 1;}
}
