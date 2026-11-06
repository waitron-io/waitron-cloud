import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { releaseManifest } from './ui-manifest.mjs';
import { validateLedger } from './ui-ledger.mjs';

const [checkoutArg, outputArg, ...options] = process.argv.slice(2);
assert(checkoutArg && outputArg && !checkoutArg.startsWith('--') && !outputArg.startsWith('--') && (options.length === 0 ||
  (options.length === 2 && options[0] === '--ledger' && !options[1].startsWith('--'))),
  'Usage: node scripts/release/prepare-ui.mjs <Waitron checkout> <empty output directory> [--ledger <releases.json>]');
let source;
let releaseVersion;
if (options.length) {
  const ledger = validateLedger(JSON.parse(await readFile(resolve(options[1]), 'utf8')));
  const reservation = ledger.events.at(-1);
  assert(reservation?.type === 'reserved', 'preparation requires an active unprepared reservation');
  source = reservation.source;
  releaseVersion = reservation.version;
} else {
  source = JSON.parse(await readFile(new URL('./ui-source.json', import.meta.url), 'utf8'));
}
const checkout = resolve(checkoutArg);
const output = resolve(outputArg);
const run = (file, args, cwd) => execFileSync(file, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
assert.equal(run('git', ['rev-parse', 'HEAD'], checkout).trim(), source.commit, 'checkout must match the release source');
assert.equal(run('git', ['status', '--porcelain', '--untracked-files=normal'], checkout).trim(), '', 'release source must be clean');
const sourceManifest = JSON.parse(await readFile(join(checkout, 'packages/ui-core/package.json'), 'utf8'));
assert.equal(sourceManifest.name, '@waitron/ui-core', 'unexpected package name');
assert.equal(sourceManifest.version, source.version, 'unexpected package version');
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, 'release output must be empty');
const temp = await mkdtemp(join(tmpdir(), 'waitron-ui-release-'));
try {
  run('pnpm', ['pack', '--pack-destination', temp], join(checkout, 'packages/ui-core'));
  const staged = join(temp, 'staged');
  await mkdir(staged);
  run('tar', ['-xzf', join(temp, `waitron-ui-core-${source.version}.tgz`), '--strip-components=1', '-C', staged], checkout);
  const original = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8'));
  const manifest = releaseManifest(original, source, releaseVersion);
  for (const notice of ['LICENSE', 'LICENSE-GRANTS.md']) {
    assert.equal(await readFile(join(staged, 'dist', notice), 'utf8'), await readFile(join(checkout, notice), 'utf8'));
  }
  await writeFile(join(staged, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', output], staged);
  console.log(`Prepared @waitron-io/ui-core@${releaseVersion ?? source.version} from ${source.commit}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
