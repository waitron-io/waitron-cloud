export const PUBLICATION_WORK_MS = 45_000;
const SIGNED_PUBLICATION_WORK_MS = 55_000;

export function signedPublicationDeadline(startedAt: number, issuedAt: number) {
  return new PublicationDeadline(Math.min(startedAt + PUBLICATION_WORK_MS, issuedAt + SIGNED_PUBLICATION_WORK_MS));
}

export class PublicationDeadline {
  readonly #endsAt: number;
  readonly signal: AbortSignal;

  constructor(endsAt: number) {
    this.#endsAt = endsAt;
    this.signal = AbortSignal.timeout(this.remaining());
  }

  remaining() {
    const remaining = this.#endsAt - Date.now();
    if (remaining <= 0 || this.signal?.aborted) throw Error("backup.cancelled");
    return remaining;
  }

  async run<T>(operation: () => Promise<T>, releaseLate?: (value: T) => void): Promise<T> {
    this.remaining();
    let onAbort!: () => void;
    const timedOut = new Promise<never>((_, reject) => {
      onAbort = () => reject(Error("backup.cancelled"));
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const work = operation().then(value => {
        try {
          this.remaining();
          return value;
        } catch (error) {
          releaseLate?.(value);
          throw error;
        }
      });
      return await Promise.race([work, timedOut]);
    } finally {
      this.signal.removeEventListener("abort", onAbort);
    }
  }
}
