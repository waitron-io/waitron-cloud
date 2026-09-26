import { accountRequest, type ApiResult } from './api.ts';
type Session = {accountId: string; expiresAt: string};
export type SessionState = {kind: 'checking' | 'unavailable'} | {kind: 'anonymous'; expired?: true} | ({kind: 'authenticated'} & Session);
export class PortalSession {
  state: SessionState = {kind: 'checking'};
  retryAt = 0;
  #sequence = 0;
  #accepted = 0;
  #changed: (state: SessionState) => void;
  #generation = 0;
  #pending: Promise<void> | undefined;
  #expiry: ReturnType<typeof setTimeout> | undefined;
  #lastActivity = -Infinity;
  #disposed = false;
  #visible = () => { if (document.visibilityState === 'visible') void this.check(); };
  constructor(changed: (state: SessionState) => void) {
    this.#changed = changed;
    document.addEventListener('visibilitychange', this.#visible);
  }
  #set(state: SessionState) {
    if (this.#disposed) return;
    this.state = state; clearTimeout(this.#expiry);
    if (state.kind === 'authenticated') {
      const wait = Math.max(1000, Math.min(2_147_483_647, Date.parse(state.expiresAt) - Date.now()));
      this.#expiry = setTimeout(() => { void this.check(); }, wait);
    }
    this.#changed(state);
  }
  #accept(result: ApiResult<Session>, sequence: number) {
    if (sequence < this.#accepted) return;
    this.#accepted = sequence;
    this.retryAt = result.ok ? 0 : Date.now() + result.retryAfterMs;
    if (!result.ok && result.status === 401) this.#generation++;
    this.#set(result.ok ? {kind: 'authenticated', ...result.value}
      : result.status === 401 ? {kind: 'anonymous', ...(result.code === 'session_expired' ? {expired: true as const} : {})} : {kind: 'unavailable'});
  }
  check(): Promise<void> {
    if (this.#disposed || Date.now() < this.retryAt) return Promise.resolve();
    if (this.#pending) return this.#pending;
    const generation = this.#generation; const sequence = ++this.#sequence;
    const pending = accountRequest<Session>('/session').then(result => {
      if (generation === this.#generation) this.#accept(result, sequence);
    }).finally(() => { if (this.#pending === pending) this.#pending = undefined; });
    this.#pending = pending;
    return pending;
  }
  async activity(event: Event): Promise<void> {
    if (!event.isTrusted || !['keydown', 'pointerdown'].includes(event.type) || document.visibilityState !== 'visible'
      || Date.now() < this.retryAt || this.state.kind !== 'authenticated' || Date.now() - this.#lastActivity < 60_000 || this.#disposed) return;
    this.#lastActivity = Date.now();
    const generation = this.#generation; const sequence = ++this.#sequence;
    const result = await accountRequest<Session>('/session/activity', {});
    if (generation === this.#generation) this.#accept(result, sequence);
  }
  async logout(): Promise<boolean> {
    await this.check();
    if (this.state.kind === 'unavailable') return false;
    // Fence all earlier passive/activity results before the cookie-changing request.
    this.#generation++; this.#pending = undefined;
    const result = await accountRequest<void>('/logout', {});
    if (!result.ok) { this.retryAt = Date.now() + result.retryAfterMs; return false; }
    this.#generation++; this.#pending = undefined;
    this.#set({kind: 'anonymous'});
    return true;
  }
  dispose() {
    this.#disposed = true; this.#generation++; clearTimeout(this.#expiry);
    document.removeEventListener('visibilitychange', this.#visible);
  }
}
