export type CountryStatus = {countryCode: string; origin: string; status: 'ready' | 'unavailable'};
export class CountryReadiness {
  readonly origins: Readonly<Record<string, string>>;
  readonly fetcher: typeof fetch;
  constructor(origins: Record<string, string>, fetcher: typeof fetch = fetch) {
    if (!Object.keys(origins).length || Object.keys(origins).length > 50) throw new Error('Invalid country configuration');
    for (const [code, origin] of Object.entries(origins)) {
      const url = new URL(origin);
      if (!/^[A-Z]{2}$/.test(code) || url.protocol !== 'https:' || url.origin !== origin) throw new Error('Invalid country origin');
    }
    this.origins = Object.freeze({...origins}); this.fetcher = fetcher;
  }
  async read(): Promise<CountryStatus[]> {
    return Promise.all(Object.entries(this.origins).map(async ([countryCode, origin]) => {
      let status: CountryStatus['status'] = 'unavailable';
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await this.fetcher(`${origin}/api/health/ready`, {method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(2000)});
        reader = response.body?.getReader();
        if (response.status === 200 && reader) {
          const chunks: Uint8Array[] = []; let size = 0;
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength; if (size > 2048) throw new Error('Health response too large');
            chunks.push(part.value);
          }
          if (JSON.parse(Buffer.concat(chunks).toString('utf8'))?.status === 'ready') status = 'ready';
        }
      } catch { /* An unavailable country must not hide the other countries. */ }
      finally {await reader?.cancel().catch(() => undefined);}
      return {countryCode, origin, status};
    }));
  }
}
