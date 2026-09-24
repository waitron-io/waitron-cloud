export type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 408 | 409 | 410 | 413 | 415 | 429 | 503;
export class AccountHttpError extends Error {
  readonly status: ErrorStatus;
  readonly retryAfter: number | undefined;
  constructor(status: ErrorStatus, code: string, retryAfter?: number) {
    super(code); this.status = status; this.retryAfter = retryAfter;
  }
}
