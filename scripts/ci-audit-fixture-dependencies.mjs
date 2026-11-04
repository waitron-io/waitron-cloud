import {constants, cpSync, existsSync, lstatSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const [source, candidate] = process.argv.slice(2);
const installed = join(source, 'node_modules');
if (!lstatSync(installed).isDirectory()) throw new Error('node_modules must be an installed dependency directory');
if (readdirSync(installed).length === 0) throw new Error('node_modules must be a nonempty installed dependency directory');
// Copy the installed graph rather than depending on the runner's download cache.
// Relative workspace links must resolve inside the candidate so its edits are exercised.
const directories = ['node_modules'];
for (const parent of ['packages', 'apps']) {
  if (!existsSync(join(source, parent))) continue;
  for (const entry of readdirSync(join(source, parent), {withFileTypes: true})) {
    const directory = join(parent, entry.name, 'node_modules');
    if ((entry.isDirectory() || entry.isSymbolicLink()) && lstatSync(join(source, directory), {throwIfNoEntry: false})) directories.push(directory);
  }
}
for (const directory of directories) {
  if (!lstatSync(join(source, directory)).isDirectory()) throw new Error(`${directory} must be an installed dependency directory`);
  cpSync(join(source, directory), join(candidate, directory), {
    recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
  });
}
