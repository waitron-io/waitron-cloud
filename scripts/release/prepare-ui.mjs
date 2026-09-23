import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { releaseManifest } from './ui-manifest.mjs';

const source = JSON.parse(await readFile(new URL('./ui-source.json', import.meta.url), 'utf8'));
const [checkoutArg, outputArg] = process.argv.slice(2);
assert(checkoutArg && outputArg, 'Usage: node scripts/release/prepare-ui.mjs <Waitron checkout> <output directory>');
const checkout = resolve(checkoutArg);
const output = resolve(outputArg);
const run = (file, args, cwd) => execFileSync(file, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
assert.equal(run('git', ['rev-parse', 'HEAD'], checkout).trim(), source.commit, 'checkout must match the release source');
assert.equal(run('git', ['status', '--porcelain', '--untracked-files=normal'], checkout).trim(), '', 'release source must be clean');
const temp = await mkdtemp(join(tmpdir(), 'waitron-ui-release-'));
try {
  await mkdir(output, { recursive: true });
  run('pnpm', ['pack', '--pack-destination', temp], join(checkout, 'packages/ui-core'));
  const staged = join(temp, 'staged');
  await mkdir(staged);
  run('tar', ['-xzf', join(temp, `waitron-ui-core-${source.version}.tgz`), '--strip-components=1', '-C', staged], checkout);
  const original = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8'));
  const manifest = releaseManifest(original, source);
  for (const notice of ['LICENSE', 'LICENSE-GRANTS.md']) {
    assert.equal(await readFile(join(staged, 'dist', notice), 'utf8'), await readFile(join(checkout, notice), 'utf8'));
  }
  await writeFile(join(staged, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', output], staged);
  console.log(`Prepared @waitron-io/ui-core@${source.version} from ${source.commit}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
