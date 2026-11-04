import {constants, cpSync, globSync} from 'node:fs';
import {join} from 'node:path';

const [source, candidate] = process.argv.slice(2);
// Copy the installed graph rather than depending on the runner's download cache.
// Relative workspace links must resolve inside the candidate so its edits are exercised.
for (const directory of globSync(['node_modules', 'packages/*/node_modules', 'apps/*/node_modules'], {cwd: source})) {
  cpSync(join(source, directory), join(candidate, directory), {
    recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
  });
}
