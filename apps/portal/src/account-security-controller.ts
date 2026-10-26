import {accountRequest, type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {AccountSessionSummary} from './account-security-types.ts';

type Request = <T>(path: string, body?: Record<string, unknown>) => Promise<ApiResult<T>>;

export class AccountSecurityController {
  sessions: AccountSessionSummary[] = [];
  loaded = false;
  pending = false;
  retryAt = 0;
  error: keyof Copy | undefined;
  notice: keyof Copy | undefined;
  #account: string | undefined;
  #generation = 0;
  readonly #changed: () => void;
  readonly #sessionEnded: (reason?: 'signedOut') => void;
  readonly #request: Request;

  constructor(changed: () => void, sessionEnded: (reason?: 'signedOut') => void, request: Request = accountRequest) {
    this.#changed = changed;
    this.#sessionEnded = sessionEnded;
    this.#request = request;
  }

  get waiting() { return Math.max(0, Math.ceil((this.retryAt - Date.now()) / 1000)); }

  fence() { this.#generation++; this.pending = false; this.loaded = false; this.error = undefined; this.notice = undefined; }

  account(id: string | undefined) {
    if (id === this.#account) return;
    this.#account = id;
    this.fence();
    this.sessions = [];
    this.loaded = false;
  }

  async #list(generation: number): Promise<ApiResult<{sessions: AccountSessionSummary[]}>> {
    const result = await this.#request<{sessions: AccountSessionSummary[]}>('/sessions');
    if (generation === this.#generation) {
      if (!result.ok) this.retryAt = Math.max(this.retryAt, Date.now() + result.retryAfterMs);
      this.loaded = result.ok;
      this.sessions = result.ok ? result.value.sessions : [];
    }
    return result;
  }

  async load() {
    if (!this.#account || this.pending || this.waiting) return;
    const generation = this.#generation;
    this.pending = true; this.error = undefined; this.notice = undefined; this.#changed();
    const result = await this.#list(generation);
    if (generation !== this.#generation) return;
    this.pending = false;
    if (!result.ok) {
      if (result.status === 401) this.#sessionEnded();
      else this.#failure(result, false);
    }
    this.#changed();
  }

  async revoke(id: string) {
    const target = this.sessions.find(session => session.id === id);
    if (!this.#account || this.pending || this.waiting || !target) return;
    const generation = this.#generation;
    this.pending = true; this.error = undefined; this.notice = undefined; this.#changed();
    const result = await this.#request<void>('/sessions/revoke', {id});
    if (generation !== this.#generation) return;
    if (!result.ok) this.retryAt = Math.max(this.retryAt, Date.now() + result.retryAfterMs);
    if (!result.ok && result.status === 401) {
      this.pending = false; this.#sessionEnded(); this.#changed(); return;
    }
    const listed = await this.#list(generation);
    if (generation !== this.#generation) return;
    this.pending = false;
    if (!listed.ok && listed.status === 401) {
      this.error = undefined; this.#sessionEnded(target.current && (result.ok || result.status === 0) ? 'signedOut' : undefined); this.#changed(); return;
    }
    if (listed.ok && !this.sessions.some(session => session.id === id)) this.notice = 'sessionRevoked';
    else if (!result.ok) this.#failure(result, true);
    else this.error = 'sessionRevokeUncertain';
    this.#changed();
  }

  #failure(result: Extract<ApiResult<unknown>, {ok: false}>, write: boolean) {
    this.error = result.status === 429 ? 'limited'
      : result.status === 403 ? (result.code === 'permission_denied' ? 'permissionAccount' : 'forbidden')
      : write ? 'sessionRevokeUncertain' : 'unavailable';
  }
}
