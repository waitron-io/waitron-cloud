import {copyFileSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Positive receipt fixtures need the exact audited installation inputs. A
// dependency PR must still exercise unchanged omission and refusal assertions.
const inputs = JSON.parse(readFileSync(new URL('./fixtures/ci-dependency-inputs.json', import.meta.url), 'utf8'));

export function copyReceiptFixtureInput(path, target) {
  if (Object.hasOwn(inputs, path)) writeFileSync(target, inputs[path]);
  else copyFileSync(path, target);
}

export function seedReceiptDependencyInputs(root) {
  for (const [path, text] of Object.entries(inputs)) writeFileSync(join(root, path), text);
}
