import {accountRequest} from './api.ts';
import type {Copy} from './locale.ts';
import type {SentReportDetail, SentReportsPage, SentReportSummary} from './sent-reports-types.ts';

export class SentReportsController {
 venueId: string|undefined;
 page: SentReportsPage|undefined;
 detail: SentReportDetail|undefined;
 error: keyof Copy|undefined;
 pending = false;
 #account: string|undefined;
 #generation = 0;
 #retryUntil = 0;

 readonly #changed: () => void;
 readonly #request: typeof accountRequest;

 constructor(changed: () => void, request = accountRequest) {
  this.#changed = changed;
  this.#request = request;
 }

 get waiting() { return Math.max(0, Math.ceil((this.#retryUntil - performance.now()) / 1000)); }

 account(id: string|undefined) {
  if (id === this.#account) return;
  this.#account = id;
  this.close();
 }

 async open(venueId: string) {
  if (!this.#account) return;
  this.close();
  this.venueId = venueId;
  this.#changed();
  await this.load();
 }

 close() {
  this.#generation++;
  this.venueId = undefined;
  this.page = undefined;
  this.detail = undefined;
  this.error = undefined;
  this.pending = false;
 }

 async load(older = false) {
  const venueId = this.venueId;
  const cursor = older ? this.page?.nextCursor : null;
  if (!venueId || (older && !cursor)) return;
  await this.#load<SentReportsPage>('/sent-reports/list', {venueId, ...(cursor ? {cursor} : {})}, page => {
   if (page.venueId !== venueId) return false;
   this.page = page;
   return true;
  });
 }

 async read({installationId, reportId}: SentReportSummary) {
  const venueId = this.venueId;
  if (!venueId || !this.page?.reports.some(r => r.installationId === installationId && r.reportId === reportId)) return;
  await this.#load<SentReportDetail>('/sent-reports/read', {venueId, installationId, reportId}, detail => {
   if (detail.venueId !== venueId || detail.installationId !== installationId || detail.reportId !== reportId) return false;
   this.detail = detail;
   return true;
  });
 }

 async #load<T>(path: string, body: Record<string, string>, apply: (value: T) => boolean) {
  if (!this.#account || this.pending || this.waiting) return;
  const generation = this.#generation;
  this.pending = true;
  this.detail = undefined;
  this.error = undefined;
  this.#changed();
  const reply = await this.#request<T>(path, body);
  if (generation !== this.#generation) return;
  this.pending = false;
  if (reply.ok) {
   if (!apply(reply.value)) this.error = 'unavailable';
  } else {
   this.#retryUntil = Math.max(this.#retryUntil, performance.now() + reply.retryAfterMs);
   if (reply.status === 401 || reply.status === 403) this.page = undefined;
   this.error = reply.status === 429 ? 'limited' : reply.status === 401 ? 'pairSession'
    : reply.status === 403 ? (reply.code === 'permission_denied' ? 'permissionBusiness' : 'forbidden') : 'unavailable';
  }
  this.#changed();
 }
}
