import {constants, cpSync, globSync, lstatSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const [source, candidate] = process.argv.slice(2);
const installed = join(source, 'node_modules');
if (!lstatSync(installed).isDirectory() || readdirSync(installed).length === 0) throw new Error('node_modules must be a nonempty installed dependency directory');
// Copy the installed graph rather than depending on the runner's download cache.
// Relative workspace links must resolve inside the candidate so its edits are exercised.
for (const directory of globSync(['node_modules', 'packages/*/node_modules', 'apps/*/node_modules'], {cwd: source})) {
  if (!lstatSync(join(source, directory)).isDirectory()) throw new Error(`${directory} must be an installed dependency directory`);
  cpSync(join(source, directory), join(candidate, directory), {
    recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
  });
}
