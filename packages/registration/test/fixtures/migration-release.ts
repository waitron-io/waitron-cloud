import {execFile} from 'node:child_process';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import type {Pool} from 'pg';

const revisions = {
  33: 'eaaad2033847bde2b2b9144869942ba6148366b0',
  34: 'ff6535c4644db9888f1aa93e733b8aff124e8b5f',
  35: 'e6fc1e22f9395a1c87909a0064fd93f3611caa66',
  36: 'd681db284ac8babeffb9f1029c2c32f8dc47701c',
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
        await symlink(new URL('../../../../node_modules', import.meta.url).pathname, join(root, 'node_modules'));
        const module = await import(pathToFileURL(join(root, 'packages/registration/src/migrate.ts')).href);
        return {root, migrate: module.migrate, names: module.migrationNames,
          async close() {releases.delete(count); await rm(root, {recursive: true, force: true});}};
      } catch (error) {releases.delete(count); await rm(root, {recursive: true, force: true}); throw error;}
    })();
    releases.set(count, release);
  }
  return release;
}
