import {
  browserSupportsPasskeys,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import {accountRequest, type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
import type {AuthenticationOptions, PasskeySummary, RegistrationOptions} from './passkey-types.ts';

export type PasskeyBrowser = {
  supported(): Promise<boolean>;
  register(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON>;
  authenticate(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>;
};

const defaultBrowser: PasskeyBrowser = {
  supported: browserSupportsPasskeys,
  register: optionsJSON => startRegistration({optionsJSON}),
  authenticate: optionsJSON => startAuthentication({optionsJSON}),
};
type Request = <T>(path: string, body?: Record<string, unknown>) => Promise<ApiResult<T>>;

export class PasskeyController {
  supported: boolean | undefined;
  passkeys: PasskeySummary[] = [];
  password = '';
  pending = false;
  retryAt = 0;
  loaded = false;
  error: keyof Copy | undefined;
  notice: keyof Copy | undefined;
  #account: string | undefined;
  #generation = 0;
  #changed: () => void;
  #request: Request;
  #browser: PasskeyBrowser;

  constructor(changed: () => void, request: Request = accountRequest, browser: PasskeyBrowser = defaultBrowser) {
    this.#changed = changed;
    this.#request = request;
    this.#browser = browser;
  }

  get waiting() { return Math.max(0, Math.ceil((this.retryAt - Date.now()) / 1000)); }

  fence() { this.#generation++; this.pending = false; this.error = undefined; this.notice = undefined; }

  account(id: string | undefined) {
    if (id === this.#account) return;
    this.#account = id;
    this.fence();
    this.passkeys = [];
    this.password = '';
    this.loaded = false;
  }

  async checkSupport() {
    const generation = this.#generation;
    try { this.supported = await this.#browser.supported(); }
    catch { this.supported = false; }
    if (generation === this.#generation) this.#changed();
  }

  #cancelled(error: unknown) {
    return error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name);
  }

  #failure(result: Extract<ApiResult<unknown>, {ok: false}>, password = false) {
    this.retryAt = Math.max(this.retryAt, Date.now() + result.retryAfterMs);
    this.error = password && result.code === 'credentials_invalid' ? 'passkeyPasswordInvalid'
      : result.status === 429 ? 'limited'
      : result.status === 401 ? 'pairSession'
      : result.status === 403 ? 'forbidden'
      : 'passkeyUnavailable';
  }

  async #list(generation: number): Promise<boolean> {
    const result = await this.#request<{passkeys: PasskeySummary[]}>('/passkeys');
    if (generation !== this.#generation) return false;
    this.loaded = true;
    if (result.ok) { this.passkeys = result.value.passkeys; return true; }
    this.#failure(result);
    return false;
  }

  async load() {
    if (!this.#account || this.pending || this.waiting) return;
    const generation = this.#generation;
    this.pending = true; this.error = undefined; this.notice = undefined; this.#changed();
    await this.#list(generation);
    if (generation !== this.#generation) return;
    this.pending = false; this.#changed();
  }

  async signIn(): Promise<'authenticated' | 'reconcile' | false> {
    if (this.pending || this.waiting) return false;
    if (this.supported === undefined) await this.checkSupport();
    if (!this.supported) { this.notice = 'passkeyUnsupported'; this.#changed(); return false; }
    const generation = this.#generation;
    this.pending = true; this.error = undefined; this.notice = undefined; this.#changed();
    const options = await this.#request<AuthenticationOptions>('/passkeys/authentication/options', {});
    if (generation !== this.#generation) return false;
    if (!options.ok) { this.pending = false; this.#failure(options); this.#changed(); return false; }
    let response: AuthenticationResponseJSON;
    try { response = await this.#browser.authenticate(options.value.options); }
    catch (error) {
      if (generation !== this.#generation) return false;
      this.pending = false;
      if (error instanceof Error && error.cause instanceof DOMException) error = error.cause;
      if (this.#cancelled(error)) this.notice = 'passkeyCancelled'; else this.error = 'passkeyUnavailable';
      this.#changed(); return false;
    }
    const result = await this.#request<{accountId: string}>('/passkeys/authentication/verify', {ceremonyId: options.value.ceremonyId, response});
    if (generation !== this.#generation) return false;
    this.pending = false;
    if (result.ok) { this.#changed(); return 'authenticated'; }
    if (result.status === 0 || result.status >= 500) { this.error = 'passkeySignInUncertain'; this.#changed(); return 'reconcile'; }
    this.#failure(result); this.#changed(); return false;
  }

  async enroll(password: string) {
    if (!this.#account || this.pending || this.waiting || !password) return;
    const generation = this.#generation;
    const before = new Set(this.passkeys.map(passkey => passkey.id));
    this.pending = true; this.error = undefined; this.notice = undefined; this.#changed();
    const options = await this.#request<RegistrationOptions>('/passkeys/registration/options', {password});
    if (generation !== this.#generation) return;
    if (!options.ok) { this.pending = false; this.#failure(options, true); this.#changed(); return; }
    let response: RegistrationResponseJSON;
    try { response = await this.#browser.register(options.value.options); }
    catch (error) {
      if (generation !== this.#generation) return;
      this.pending = false;
      if (this.#cancelled(error)) this.notice = 'passkeyCancelled'; else this.error = 'passkeyUnavailable';
      this.#changed(); return;
    }
    const result = await this.#request<PasskeySummary>('/passkeys/registration/verify', {ceremonyId: options.value.ceremonyId, response});
    if (generation !== this.#generation) return;
    if (!result.ok) this.retryAt = Math.max(this.retryAt, Date.now() + result.retryAfterMs);
    const listed = await this.#list(generation);
    if (generation !== this.#generation) return;
    this.pending = false; this.password = '';
    if (listed && (result.ok || this.passkeys.some(passkey => !before.has(passkey.id)))) this.notice = 'passkeyAdded';
    else if (!result.ok && (result.status === 0 || result.status >= 500)) this.error = 'passkeyChangeUncertain';
    else if (!result.ok) this.#failure(result);
    this.#changed();
  }

  async remove(id: string, password: string) {
    if (!this.#account || this.pending || this.waiting || !password || !this.passkeys.some(passkey => passkey.id === id)) return;
    const generation = this.#generation;
    this.pending = true; this.error = undefined; this.notice = undefined; this.#changed();
    const result = await this.#request<void>('/passkeys/remove', {id, password});
    if (generation !== this.#generation) return;
    if (!result.ok) this.retryAt = Math.max(this.retryAt, Date.now() + result.retryAfterMs);
    const listed = await this.#list(generation);
    if (generation !== this.#generation) return;
    this.pending = false; this.password = '';
    if (listed && !this.passkeys.some(passkey => passkey.id === id)) this.notice = 'passkeyRemoved';
    else if (!result.ok && (result.status === 0 || result.status >= 500)) this.error = 'passkeyChangeUncertain';
    else if (!result.ok) this.#failure(result, true);
    else if (!listed) this.error = 'passkeyChangeUncertain';
    this.#changed();
  }
}
