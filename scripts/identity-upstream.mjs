import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const [waitron, revision = 'origin/main', sourceMap = resolve(import.meta.dirname, '../packages/identity/SOURCE.md')] = process.argv.slice(2);
try {
  if (!waitron) throw new Error('Usage: node scripts/identity-upstream.mjs <Waitron checkout> [revision] [source map]');
  const source = readFileSync(sourceMap, 'utf8');
  const reviewedRevision = /Last reviewed Waitron revision: `([0-9a-f]{40})`/.exec(source)?.[1];
  const paths = [...new Set([...source.matchAll(/https:\/\/github\.com\/clintongormley\/waitron\/blob\/[0-9a-f]{40}\/(packages\/identity\/[^)\s]+)/g)]
    .map(match => match[1]))];
  if (!reviewedRevision || !paths.length) throw new Error('Invalid identity source map: reviewed revision and mapped paths required');
  const git = (...args) => execFileSync('git', ['-C', waitron, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const targetRevision = git('rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`);
  try { git('merge-base', '--is-ancestor', reviewedRevision, targetRevision); }
  catch { throw new Error('The reviewed revision is not an ancestor of the target revision'); }
  const log = git('log', '--reverse', '--format=%H%x09%s', `${reviewedRevision}..${targetRevision}`, '--', ...paths);
  const commits = log ? log.split('\n').map(line => {
    const separator = line.indexOf('\t');
    return {sha: line.slice(0, separator), subject: line.slice(separator + 1)};
  }) : [];
  console.log(JSON.stringify({reviewedRevision, targetRevision, paths, commits}, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
