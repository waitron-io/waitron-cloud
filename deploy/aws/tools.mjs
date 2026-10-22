import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, lstat, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runProcess = promisify(execFile);
export const toolsImage = 'waitron-cloud-aws-tools:1.11.0-aws6.42.0';

export async function prepareTools({ execute = runProcess } = {}) {
  const context = await mkdtemp(join(tmpdir(), 'cloud-aws-tool-build-'));
  try {
    for (const name of ['.dockerignore', 'Dockerfile', 'prepare.py', 'test-cli.tfrc', 'tools-pins.json', 'tools-requirements.txt']) {
      const input = new URL(name, import.meta.url);
      const info = await lstat(input);
      if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Unsupported software build input: non-file, symlink or oversized file');
      await writeFile(join(context, name), await readFile(input), { mode: 0o644 });
    }
    return await execute('docker', ['build', '--pull=false', '--tag', toolsImage, context], {
      timeout: 420_000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
  } finally {
    await rm(context, { recursive: true, force: true });
  }
}
