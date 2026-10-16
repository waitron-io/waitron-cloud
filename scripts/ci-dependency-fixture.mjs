import {copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadWorkspace} from './ci-scope.mjs';

// Positive receipt fixtures need the exact audited installation and execution
// inputs so current changes still exercise omission and refusal assertions.
const inputs = {...JSON.parse(readFileSync(new URL('./fixtures/ci-dependency-inputs.json', import.meta.url), 'utf8')),
  ...JSON.parse(readFileSync(new URL('./fixtures/ci-execution-inputs.json', import.meta.url), 'utf8'))};

export function receiptFixtureWorkspace() {
  return loadWorkspace().filter(pkg => Object.hasOwn(inputs, `${pkg.directory}/package.json`));
}

export function copyReceiptFixtureInput(path, target) {
  if (Object.hasOwn(inputs, path)) writeFileSync(target, inputs[path]);
  else copyFileSync(path, target);
}

export function seedReceiptDependencyInputs(root) {
  // Positive omissions require the saved audited workspace's exact membership.
  for (const parent of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, parent), {withFileTypes: true})) {
      if (entry.isDirectory() && !Object.hasOwn(inputs, `${parent}/${entry.name}/package.json`)) {
        rmSync(join(root, parent, entry.name), {recursive: true, force: true});
      }
    }
  }
  for (const [path, text] of Object.entries(inputs)) writeFileSync(join(root, path), text);
}
