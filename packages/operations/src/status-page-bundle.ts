import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { renderStatusPage } from './status-page.ts';

export function writeStatusPageBundle(destination: string, pages: ReturnType<typeof renderStatusPage>): void {
  mkdirSync(destination);
  try {
    mkdirSync(join(destination, 'es'));
    for (const [file, html] of Object.entries(pages)) {
      writeFileSync(join(destination, file), html, { flag: 'wx' });
    }
  } catch (error) {
    try {
      rmSync(destination, { recursive: true, force: true });
    } catch {
      // If cleanup fails, leave the incomplete directory for the operator to inspect.
    }
    throw error;
  }
}
