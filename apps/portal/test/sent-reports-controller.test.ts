import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
import {SentReportsController} from '../src/sent-reports-controller.ts';
import type {SentReportDetail, SentReportsPage} from '../src/sent-reports-types.ts';

const first = '12345678-1234-4234-8234-123456789abc';
const second = '22345678-1234-4234-8234-123456789abc';
const item = {installationId: '32345678-1234-4234-8234-123456789abc', reportId: '42345678-1234-4234-8234-123456789abc',
 reportedAt: '2026-11-22T12:00:00.000Z', version: '1.2.3', bugStatus: 'open' as const, fixedVersion: null};
const page = (venueId: string): SentReportsPage => ({venueId, reports: [item], nextCursor: null});
const detail: SentReportDetail = {venueId: first, installationId: item.installationId, reportId: item.reportId, reportBody: 'Exact text', descriptionBody: null};

test('Sent reports discards late lists after a venue change and late details after sign-out', async () => {
 let resolveList!: (result: ApiResult<SentReportsPage>) => void;
 let resolveDetail!: (result: ApiResult<SentReportDetail>) => void;
 const lateList = new Promise<ApiResult<SentReportsPage>>(resolve => { resolveList = resolve; });
 const lateDetail = new Promise<ApiResult<SentReportDetail>>(resolve => { resolveDetail = resolve; });
 let deferList = true;
 const controller = new SentReportsController(() => {}, async <T>(path: string, body?: Record<string, unknown>) => {
  if (path === '/sent-reports/read') return await lateDetail as ApiResult<T>;
  if (body?.venueId === first && deferList) return await lateList as ApiResult<T>;
  return {ok: true, value: page(String(body?.venueId)) as T};
 });
 controller.account('owner');
 const pending = controller.open(first);
 await controller.open(second);
 resolveList({ok: true, value: page(first)});
 await pending;
 assert.equal(controller.page?.venueId, second);
 deferList = false;
 await controller.open(first);
 const reading = controller.read(item);
 controller.account(undefined);
 resolveDetail({ok: true, value: detail});
 await reading;
 assert.equal(controller.detail, undefined);
 assert.equal(controller.page, undefined);
 assert.equal(controller.venueId, undefined);
});

test('Sent reports refuses a mismatched detail and clears content when the account loses access', async () => {
 let reply: ApiResult<SentReportDetail> = {ok: true, value: {...detail, venueId: second}};
 const controller = new SentReportsController(() => {}, async <T>(path: string) =>
  (path === '/sent-reports/read' ? reply : {ok: true, value: page(first)}) as ApiResult<T>);
 controller.account('owner');
 await controller.open(first);
 await controller.read(item);
 assert.equal(controller.detail, undefined);
 reply = {ok: true, value: detail};
 await controller.read(item);
 assert.deepEqual(controller.detail, detail);
 reply = {ok: false, status: 403, retryAfterMs: 0, code: 'permission_denied'};
 await controller.read(item);
 assert.equal(controller.detail, undefined);
 assert.equal(controller.page, undefined);
 assert.equal(controller.error, 'permissionBusiness');
 await controller.load();
 reply = {ok: false, status: 403, retryAfterMs: 0, code: 'forbidden'};
 await controller.read(item);
 assert.equal(controller.error, 'forbidden');
 assert.equal(controller.page, undefined);
});
