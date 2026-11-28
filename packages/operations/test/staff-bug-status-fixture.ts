import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import type {TestContext} from 'node:test';
import {promisify} from 'node:util';

export async function bugStatusCommand(t: TestContext, schema: string) {
 const dir = await mkdtemp(join(tmpdir(), 'staff-bug-status-'));
 t.after(() => rm(dir, {recursive: true}));
 const gh = join(dir, 'gh');
 await writeFile(gh, `#!/bin/sh
printf '%s\\n' "$@" >> "$0.args"
test -z "\${DATABASE_URL+x}" || exit 99
exec /bin/cat "$0.json"
`, {mode: 0o700});
 const databaseUrl = new URL(process.env.TEST_DATABASE_URL!);
 databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
 return {
  reply: (value: unknown) => writeFile(gh + '.json', JSON.stringify(value)),
  calls: async () => readFile(gh + '.args', 'utf8').catch((err: NodeJS.ErrnoException) => {
   if (err.code === 'ENOENT') return '';
   throw err;
  }),
  run: (installationId: string, reportId: string, repository = 'clintongormley/waitron', issue = '18') =>
   promisify(execFile)(process.execPath, [new URL('../src/staff-bug-status-cli.ts', import.meta.url).pathname, installationId, reportId, repository, issue], {
    env: {DATABASE_URL: databaseUrl.href, GH_HOST: 'wrong.example.test', PATH: [dir, process.env.PATH].join(delimiter)}, timeout: 15000,
   }),
 };
}
