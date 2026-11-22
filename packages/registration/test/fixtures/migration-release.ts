import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import type {Pool} from 'pg';

const revisions = {
  80:'be3df93d816aec079bdb055177da3844c9e19be2',
  73:'8c490cdc7521e62d0b6467aeda7f4962d0f433cf',
  72:'5694a6906ebcad95ebb403cd479643c11edaac56',
  71:'22289fde3a235478388b981f632da5f7c51d258e',
  70:'677d0e1876ed514f51d0bd4b2e0d2bb4cc6e80e4',
  69:'4c5a24dc2706965e7eabf6ef6f706195d160aee8',
  68:'f8aa2756700782d265d531baf5bb3d6119858a55',
  67:'a6823a43f001e33e79a59050f284619cf28f796c',
  47: '1aae8f14c05113cc2a2c71337940ff7721ad5f5b',
  46: '9a75808dd17a86f2dc1e9b87614be4e55e81deb2',
  45: 'b338275c3ba4e2b211d7617b03d38e95b916ee7c',
  44: '1a3e43e885edfbe9932c835e3f4fb8929718b2dc',
  39: 'c6cb813b0da0fe621e7d3d729471244b40f1b6d5',
  33: 'eaaad2033847bde2b2b9144869942ba6148366b0',
  34: 'ff6535c4644db9888f1aa93e733b8aff124e8b5f',
  35: 'e6fc1e22f9395a1c87909a0064fd93f3611caa66',
  36: 'd681db284ac8babeffb9f1029c2c32f8dc47701c',
  37: '08c30216e4b415689f5d82b2b7f878af8d8bca7e',
} as const;
const exec = promisify(execFile);
const releases = new Map<number, Promise<Release>>();
interface Release {root: string; migrate(pool: Pool): Promise<void>; names: readonly string[]; close(): Promise<void>}

export function migrationRelease(count: keyof typeof revisions): Promise<Release> {
  let release = releases.get(count);
  if (!release) {
    release = (async () => {
      const root = await mkdtemp(join(tmpdir(), `cloud-release-${count}-`));
      try {
        await exec('git', ['archive', '--output=' + join(root, 'release.tar'), revisions[count]],
          {cwd: new URL('../../../../', import.meta.url)});
        await exec('tar', ['-xf', join(root, 'release.tar'), '-C', root]);
        await rm(join(root, 'release.tar'));
        if (count === 44 || count === 45 || count === 46 || count === 47 || count === 68 || count === 69) await exec('pnpm', ['install', '--frozen-lockfile'], {cwd: root});
        else await symlink(new URL('../../../../node_modules', import.meta.url).pathname, join(root, 'node_modules'));
        const module = await import(pathToFileURL(join(root, 'packages/registration/src/migrate.ts')).href);
        return {root, migrate: module.migrate, names: module.migrationNames,
          async close() {releases.delete(count); await rm(root, {recursive: true, force: true});}};
      } catch (error) {releases.delete(count); await rm(root, {recursive: true, force: true}); throw error;}
    })();
    releases.set(count, release);
  }
  return release;
}

export function retainedMembershipFields(row: Record<string, unknown>, migrationStart: number, migrationEnd: number) {
  const {owner_since, ...retained} = row;
  if (retained.is_owner === true) {
    assert.ok(typeof owner_since === 'string');
    const cutoff = Date.parse(owner_since);
    assert.ok(cutoff >= migrationStart && cutoff <= migrationEnd, 'owner cutoff falls within the migration');
  } else {
    assert.equal(owner_since, null);
  }
  return retained;
}
