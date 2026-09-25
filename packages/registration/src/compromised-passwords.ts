import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export type PasswordScreeningResult = 'acceptable' | 'compromised';
export interface PasswordScreeningProvider {
  check(password: string): Promise<PasswordScreeningResult>;
}

export async function screenPassword(provider: PasswordScreeningProvider | undefined, password: string): Promise<PasswordScreeningResult | 'unavailable'> {
  if (!provider) return 'acceptable';
  try {
    const result = await provider.check(password);
    return result === 'acceptable' || result === 'compromised' ? result : 'unavailable';
  } catch { return 'unavailable'; }
}

const invalidCorpus = () => new Error('Invalid compromised-password corpus');

export class LocalPasswordCorpus implements PasswordScreeningProvider {
  readonly #digests: ReadonlySet<string>;
  private constructor(digests: ReadonlySet<string>) { this.#digests = digests; }

  static async load(path: string, options: {maxBytes?: number} = {}): Promise<LocalPasswordCorpus> {
    const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    if (typeof path !== 'string' || !path || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw invalidCorpus();
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of createReadStream(path, {highWaterMark: 64 * 1024})) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > maxBytes) throw invalidCorpus();
        chunks.push(buffer);
      }
      const digests = new Set<string>();
      for (const line of Buffer.concat(chunks, bytes).toString('utf8').split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith('#')) continue;
        if (!/^[0-9a-f]{64}$/.test(value)) throw invalidCorpus();
        digests.add(value);
      }
      if (!digests.size) throw invalidCorpus();
      return new LocalPasswordCorpus(digests);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid compromised-password corpus') throw error;
      throw invalidCorpus();
    }
  }

  async check(password: string): Promise<PasswordScreeningResult> {
    const digest = createHash('sha256').update(password, 'utf8').digest('hex');
    return this.#digests.has(digest) ? 'compromised' : 'acceptable';
  }
}
