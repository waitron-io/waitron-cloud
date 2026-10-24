import {copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadWorkspace} from './ci-scope.mjs';

// Positive receipt fixtures need the exact audited installation, execution and
// schema and deployment inputs so current changes still exercise omission and refusal assertions.
const schemaInputs = JSON.parse(readFileSync(new URL('./fixtures/ci-schema-inputs.json', import.meta.url), 'utf8'));
const deploymentInputs = JSON.parse(readFileSync(new URL('./fixtures/ci-deployment-inputs.json', import.meta.url), 'utf8'));
// Gateway omission fixtures use the audited source; current source changes must still retain the real suite.
const gatewayInputs = JSON.parse(readFileSync(new URL('./fixtures/ci-gateway-inputs.json', import.meta.url), 'utf8'));
const inputs = {...deploymentInputs.files, ...schemaInputs.files, ...JSON.parse(readFileSync(new URL('./fixtures/ci-dependency-inputs.json', import.meta.url), 'utf8')),
  ...JSON.parse(readFileSync(new URL('./fixtures/ci-execution-inputs.json', import.meta.url), 'utf8')),
  ...JSON.parse(readFileSync(new URL('./fixtures/ci-local-stack-reader-inputs.json', import.meta.url), 'utf8')), ...gatewayInputs};

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
  for (const [directory, names] of Object.entries({...deploymentInputs.directories,...schemaInputs.directories})) {
    for (const name of readdirSync(join(root, directory))) {
      if (!names.includes(name)) rmSync(join(root, directory, name), {recursive: true, force: true});
    }
  }
  // Positive fixtures must reproduce the audited root-file inventory as well as its contents.
  for (const entry of readdirSync(root,{withFileTypes:true})) {
    if (entry.name!=='.git' && !entry.name.endsWith('.md') && !deploymentInputs.rootFiles.includes(entry.name) && (entry.isFile() || entry.isSymbolicLink())) rmSync(join(root,entry.name));
  }
  for (const [path, text] of Object.entries(inputs)) writeFileSync(join(root, path), text);
}
