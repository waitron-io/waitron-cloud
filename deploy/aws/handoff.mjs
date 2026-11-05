import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const schema = JSON.parse(await readFile(new URL('./contracts/infrastructure-v1.schema.json', import.meta.url)));
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);

export function selectInfrastructure(values, scope, cell) {
  const expected = scope === 'global' ? { scope: 'global', country: null }
    : scope === 'es' ? { scope: 'country', country: 'es' } : null;
  if (!expected || typeof cell !== 'string' || !cell || !values || typeof values !== 'object' || !Object.hasOwn(values, cell)) {
    throw new Error('Invalid infrastructure selection');
  }
  const value = values[cell];
  // The schema permits several cell keys. Selection requires the exact requested
  // key; producer tests establish the underlying resource and role mapping.
  if (!validate(value) || value.scope !== expected.scope || value.country !== expected.country
      || Object.keys(value.cells).length !== 1 || !Object.hasOwn(value.cells, cell)) {
    throw new Error('Invalid infrastructure selection');
  }
  return value;
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3) throw new Error('Usage: node deploy/aws/handoff.mjs <tofu-output.json> <global|es> <cell>');
    const [path, scope, cell] = args;
    const output = JSON.parse(await readFile(path, 'utf8'));
    const value = selectInfrastructure(output.infrastructure_v1_by_cell?.value, scope, cell);
    console.log(JSON.stringify(value, null, 2));
  } catch {
    console.error('Invalid infrastructure selection. Usage: node deploy/aws/handoff.mjs <tofu-output.json> <global|es> <cell>');
    process.exitCode = 1;
  }
}
