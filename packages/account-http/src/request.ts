import { AccountHttpError } from './errors.ts';
export async function readAccountBody(request: Request, fields: readonly string[], optional: readonly string[] = []): Promise<Record<string, string>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
    || (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity')) throw new AccountHttpError(415, 'invalid_input');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16384)) throw new AccountHttpError(413, 'invalid_input');
  if (request.signal.aborted) throw new AccountHttpError(408, 'invalid_input');
  const reader = request.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new AccountHttpError(408, 'invalid_input'));
      request.signal.addEventListener('abort', onAbort, {once: true});
      timer = setTimeout(onAbort, 5000);
    });
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) for (;;) {
      const {done, value} = await Promise.race([reader.read(), cancelled]);
      if (done) break;
      size += value.byteLength;
      if (size > 16384) throw new AccountHttpError(413, 'invalid_input');
      chunks.push(value);
    }
    let parsed: unknown;
    try {parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));}
    catch {throw new AccountHttpError(400, 'invalid_input');}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).length < fields.length
      || optional.some(field => field in (parsed as object) && typeof (parsed as Record<string, unknown>)[field] !== 'string')
      || fields.some(field => typeof (parsed as Record<string, unknown>)[field] !== 'string')
      || Object.keys(parsed).some(field => !fields.includes(field) && !optional.includes(field))) throw new AccountHttpError(400, 'invalid_input');
    return parsed as Record<string, string>;
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', onAbort);
    if (reader) {void reader.cancel().catch(() => {}); reader.releaseLock();}
  }
}
