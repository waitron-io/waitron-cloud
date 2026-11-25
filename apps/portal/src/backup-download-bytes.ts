export function readBytes(stream: ReadableStream<Uint8Array>, max: number, streamError?: Error) {
  const reader = stream.getReader();
  let remaining = new Uint8Array(0) as Uint8Array<ArrayBufferLike>;
  let received = 0;
  async function take(length: number, consume: (chunk: Uint8Array) => void) {
    if (length > max) throw new Error('Entry exceeds size limit');
    while (length > 0) {
      if (!remaining.length) {
        const next = await reader.read().catch(error => { throw streamError ?? error; });
        if (next.done) return false;
        remaining = next.value;
        received += remaining.length;
        if (received > max) throw new Error('Size limit exceeded');
      }
      const size = Math.min(length, remaining.length);
      consume(remaining.subarray(0, size));
      remaining = remaining.subarray(size);
      length -= size;
    }
    return true;
  }
  return {
    take,
    async exact(length: number) {
      const bytes = new Uint8Array(length);
      let offset = 0;
      if (!await take(length, chunk => { bytes.set(chunk, offset); offset += chunk.length; })) throw new Error('Truncated backup');
      return bytes;
    },
    async close() { await reader.cancel().catch(() => {}); },
  };
}
