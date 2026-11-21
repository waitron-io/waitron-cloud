import {accountRequest} from './api.ts';
import type {Copy} from './locale.ts';

type BusinessData = {
  organisations: {id: string; name: string | null; canRegister: boolean}[];
  businesses: {id: string; organisationId: string; legalName: string | null; taxNumber: string | null; countryCode: string | null}[];
  canStartOrganisation: boolean;
};

const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const textOrNull = (value: unknown) => value === null || typeof value === 'string';

export function validAccountBusinesses(value: unknown): value is BusinessData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.canStartOrganisation === 'boolean'
    && Array.isArray(data.organisations) && data.organisations.every(o =>
      o && uuid(o.id) && textOrNull(o.name) && typeof o.canRegister === 'boolean')
    && Array.isArray(data.businesses) && data.businesses.every(b =>
      b && uuid(b.id) && uuid(b.organisationId) && textOrNull(b.legalName) && textOrNull(b.taxNumber)
      && (b.countryCode === null || typeof b.countryCode === 'string' && /^[A-Z]{2}$/.test(b.countryCode)));
}

export class AccountBusinessesController {
  data: BusinessData | undefined;
  attempted = false;
  pending = false;
  error: keyof Copy | undefined;
  refusedCountry: string | undefined;
  #account: string | undefined;
  #generation = 0;
  #retryUntil = 0;

  readonly #changed: () => void;
  constructor(changed: () => void) { this.#changed = changed; }

  get waiting() { return Math.max(0, Math.ceil((this.#retryUntil - performance.now()) / 1000)); }

  account(id: string | undefined) {
    if (id === this.#account) return;
    this.#account = id;
    this.#generation++;
    this.data = undefined;
    this.attempted = this.pending = false;
    this.error = this.refusedCountry = undefined;
  }

  async request(path: '/businesses' | '/organisations/rename', body?: Record<string, string>) {
    if (!this.#account || this.pending || this.waiting) return false;
    const generation = this.#generation;
    this.pending = this.attempted = true;
    this.error = this.refusedCountry = undefined;
    this.#changed();
    const result = await accountRequest<BusinessData>(path, body);
    if (generation !== this.#generation) return false;
    this.pending = false;
    if (result.ok) this.data = result.value;
    else {
      this.#retryUntil = Math.max(this.#retryUntil, performance.now() + result.retryAfterMs);
      if (result.status === 401 || result.status === 403) this.data = undefined;
      this.error = result.code === 'country_unavailable' ? 'countryUnavailable'
        : result.code === 'business_match_ambiguous' ? 'businessMatchAmbiguous'
        : result.status === 400 ? 'businessInvalid'
        : result.status === 403 ? 'forbidden' : result.status === 429 ? 'limited' : 'unavailable';
      if (this.error === 'countryUnavailable') this.refusedCountry = body?.countryCode;
    }
    this.#changed();
    return result.ok;
  }
}
