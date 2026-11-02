import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export async function probeWaitronSource({docker, image, source, expectedHead, runId, own}) {
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  assert.match(expectedHead, /^[a-f0-9]{40}$/);
  assert.equal(source.head, expectedHead, 'waitron_source.pin');
  assert.match(runId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const input = JSON.stringify(source);
  assert.ok(Buffer.byteLength(input) <= 4 * 1024 * 1024);
  const script = await readFile(new URL('./integration-waitron-source.mjs', import.meta.url), 'utf8');
  const id = await docker(['create', '-i', '--pull=never', '--label', 'cloud.integration.owner=' + runId,
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '256m', '--memory-swap', '256m', '--pids-limit', '32', '--workdir', '/waitron',
    '--entrypoint', 'node', image, '--input-type=module', '-e',
    script + '\nawait waitronSourceMain(["measure", "' + expectedHead + '"]);'], '', 'waitron-source-create');
  assert.match(id, /^[a-f0-9]{64}$/);
  own(id);
  const measured = JSON.parse(await docker(['start', '-ai', id], input, 'waitron-source-measure'));
  assert.deepEqual(measured, {head: source.head, tree: source.tree, dirty: false, files: source.files.length,
    sourceSha256: createHash('sha256').update(JSON.stringify(source.files)).digest('hex')}, 'waitron_source.result');
  return {image, ...measured};
}
