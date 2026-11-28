import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountRequest} from '../src/api.ts';

const venueId = '12345678-1234-4234-8234-123456789abc';
const installationId = '22345678-1234-4234-8234-123456789abc';
const reportId = '32345678-1234-4234-8234-123456789abc';

test('Sent reports sends browser proof and accepts only a scoped list or exact detail reply', async t => {
 for (const [key, value] of [['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=browser-proof'}]] as const) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, {configurable: true, value});
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
 }
 const list = {venueId, reports: [{installationId, reportId, reportedAt: '2026-11-22T12:00:00.000Z', version: '1.2.3', bugStatus: 'fixed', fixedVersion: '1.2.4'}], nextCursor: null};
 const detail = {venueId, installationId, reportId, reportBody: '  {"version":"1.2.3"}\n', descriptionBody: null};
 let reply: unknown = list;
 const requests: RequestInit[] = [];
 t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
  requests.push(init);
  return Response.json(reply);
 });
 assert.deepEqual(await accountRequest('/sent-reports/list', {venueId}), {ok: true, value: list});
 assert.equal(requests[0]!.method, 'POST');
 assert.equal(new Headers(requests[0]!.headers).get('x-csrf-token'), 'browser-proof');
 reply = detail;
 assert.deepEqual(await accountRequest('/sent-reports/read', {venueId, installationId, reportId}), {ok: true, value: detail});
 assert.equal(new Headers(requests[1]!.headers).get('x-csrf-token'), 'browser-proof');
 for (const invalid of [{...detail, reportBody: {}}, {...detail, descriptionBody: 3}, {...detail, receiptOwnerId: 'unused'}]) {
  reply = invalid;
  assert.equal((await accountRequest('/sent-reports/read', {venueId, installationId, reportId})).ok, false);
 }
 for (const fields of [
  {bugStatus: 'fixed', fixedVersion: null}, {bugStatus: null, fixedVersion: '1.2.4'},
  {bugStatus: 'closed', fixedVersion: null}, {fixedVersion: '01.2.4'}, {fixedVersion: '2147483648.0.0'}, {issue: 18},
 ]) {
  reply = {...list, reports: [{...list.reports[0], ...fields}]};
  assert.equal((await accountRequest('/sent-reports/list', {venueId})).ok, false);
 }
 reply = {...list, reports: [...list.reports, ...list.reports]};
 assert.equal((await accountRequest('/sent-reports/list', {venueId})).ok, false);
});
