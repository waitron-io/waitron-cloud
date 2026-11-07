import assert from 'node:assert/strict';
import {globSync, readFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const requirements = JSON.parse(readFileSync(new URL('./ci-required-cases.json', import.meta.url), 'utf8'));

function trackedFiles(command, directory) {
  if (!/\bnode --test\b/.test(command)) return [];
  const args = (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(argument => argument.replace(/^(['"])(.*)\1$/, '$2'));
  if (!args.some(argument => /^--test-reporter=.*\/ci-required-cases\.mjs$/.test(argument))) return [];
  return args.slice(args.indexOf('--test') + 1).filter(argument => !argument.startsWith('-') && /\.test\.(?:mjs|ts)$/.test(argument))
    .flatMap(pattern => globSync(pattern, {cwd: directory})).map(file => relative(root, resolve(directory, file)));
}

test('every required source has an ordinary command that checks its case receipts', () => {
  const tracked = new Set();
  for (const manifest of globSync(['packages/*/package.json', 'apps/*/package.json'], {cwd: root})) {
    const packageRoot = resolve(root, dirname(manifest));
    const value = JSON.parse(readFileSync(resolve(root, manifest), 'utf8'));
    for (const file of trackedFiles(value.scripts?.test ?? '', packageRoot)) tracked.add(file);
  }
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const command of Object.values(manifest.scripts)) for (const file of trackedFiles(command, root)) tracked.add(file);

  const gateway = readFileSync(new URL('../packages/remote-access/test/traffic-gateway.test.ts', import.meta.url), 'utf8');
  const command = gateway.match(/tag,'node','--test',([\s\S]*?)\.\.\.paths\.map\(path=>'\/proof\/'\+path\)/)?.[1] ?? '';
  if (command.includes("'--test-reporter=/proof/scripts/ci-required-cases.mjs'")) {
    const files = gateway.match(/gateway:\[([^\]]+)\]/)?.[1] ?? '';
    for (const [, file] of files.matchAll(/'([^']+)'/g)) tracked.add(file);
  }
  assert.deepEqual(Object.keys(requirements).filter(file => !tracked.has(file)), [], 'A required case must reach an executing tracker');
});
