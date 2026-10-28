import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';

const account = {accountId: 'signed-in-owner'};
const challenge = {factorRequired: true, challengeToken: 'A'.repeat(43), expiresAt: '2030-01-01T12:05:00.000Z'};
const passwordBody = {email: 'owner@example.test', password: ' exact password '};
const factorBody = {challengeToken: challenge.challengeToken, proof: {kind: 'totp', code: '012345'}};
type Reply = {body?: unknown; status?: number; raw?: string; retry?: string} | 'network';

function fixture(t: TestContext) {
  const replies: Reply[] = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(init);
    requests.push({url: String(url), init});
    assert.ok(replies.length, 'every request needs an explicit HTTP outcome');
    const reply = replies.shift()!;
    if (reply === 'network') throw new TypeError('private transport detail');
    return new Response(reply.status === 204 ? null : reply.raw ?? JSON.stringify(reply.body), {
      status: reply.status ?? 200, headers: reply.retry ? {'Retry-After': reply.retry} : {},
    });
  });
  return {replies, requests};
}

function sent(request: {url: string; init: RequestInit}, path: string, body: Record<string, unknown>) {
  assert.equal(request.url, `/api/account${path}`);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'same-origin');
  assert.deepEqual(request.init.headers, {'Content-Type': 'application/json'});
  assert.equal(request.init.body, JSON.stringify(body));
}

const malformedAccounts: Array<[string, Reply]> = [
  ['null', {body: null}],
  ['array', {body: []}],
  ['missing account', {body: {}}],
  ['empty account', {body: {accountId: ''}}],
  ['numeric account', {body: {accountId: 7}}],
  ['boolean account', {body: {accountId: true}}],
  ['extra private field', {body: {...account, secret: 'private'}}],
  ['mixed account and challenge', {body: {...account, ...challenge}}],
  ['challenge at account status', {body: challenge}],
  ['account at challenge status', {body: account, status: 202}],
  ['account at created status', {body: account, status: 201}],
  ['empty no-content reply', {status: 204}],
  ['broken JSON', {raw: '{unfinished'}],
  ['empty body', {raw: ''}],
];

for (const path of ['/login', '/login/factor']) for (const [label, reply] of malformedAccounts) {
  test(`${path} HTTP rejects ${label} before accepting an explicit valid retry`, async t => {
    const {replies, requests} = fixture(t);
    const body = path === '/login' ? passwordBody : factorBody;
    replies.push(reply);
    assert.deepEqual(await accountRequest(path, body), {ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0});
    assert.equal(requests.length, 1, 'malformed sign-in replies must not repeat a credential request');
    sent(requests[0]!, path, body);
    replies.push({body: account});
    assert.deepEqual(await accountRequest(path, body), {ok: true, value: account});
    assert.equal(requests.length, 2);
    sent(requests[1]!, path, body);
    assert.equal(replies.length, 0);
  });
}

const malformedChallenges: Array<[string, unknown]> = [
  ['missing factor marker', {challengeToken: challenge.challengeToken, expiresAt: challenge.expiresAt}],
  ['false factor marker', {...challenge, factorRequired: false}],
  ['string factor marker', {...challenge, factorRequired: 'true'}],
  ['missing token', {factorRequired: true, expiresAt: challenge.expiresAt}],
  ['short token', {...challenge, challengeToken: 'A'.repeat(42)}],
  ['long token', {...challenge, challengeToken: 'A'.repeat(44)}],
  ['invalid token alphabet', {...challenge, challengeToken: '!'.repeat(43)}],
  ['numeric token', {...challenge, challengeToken: 123}],
  ['missing expiry', {factorRequired: true, challengeToken: challenge.challengeToken}],
  ['invalid expiry', {...challenge, expiresAt: 'later'}],
  ['numeric expiry', {...challenge, expiresAt: 1_893_499_500_000}],
  ['extra account', {...challenge, accountId: account.accountId}],
  ['extra private field', {...challenge, secret: 'private'}],
];

for (const [label, body] of malformedChallenges) {
  test(`password HTTP rejects a challenge with ${label} and retains the valid challenge distinction`, async t => {
    const {replies, requests} = fixture(t);
    replies.push({body, status: 202});
    assert.deepEqual(await accountRequest('/login', passwordBody), {ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0});
    assert.equal(requests.length, 1);
    replies.push({body: challenge, status: 202});
    assert.deepEqual(await accountRequest('/login', passwordBody), {ok: true, value: challenge});
    assert.equal(requests.length, 2);
    for (const request of requests) sent(request, '/login', passwordBody);
  });
}

for (const status of [200, 201, 202]) {
  test(`factor HTTP cannot accept a further factor challenge at status ${status}`, async t => {
    const {replies, requests} = fixture(t);
    replies.push({body: challenge, status});
    assert.deepEqual(await accountRequest('/login/factor', factorBody), {ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0});
    assert.equal(requests.length, 1);
    replies.push({body: account});
    assert.deepEqual(await accountRequest('/login/factor', factorBody), {ok: true, value: account});
    assert.equal(requests.length, 2);
    for (const request of requests) sent(request, '/login/factor', factorBody);
  });
}

for (const path of ['/login', '/login/factor']) for (const [label, reply, expected] of [
  ['credentials refused', {body: {error: 'credentials_invalid'}, status: 401}, {ok: false, status: 401, code: 'credentials_invalid', retryAfterMs: 0}],
  ['permission refused', {body: {error: 'forbidden'}, status: 403}, {ok: false, status: 403, code: 'forbidden', retryAfterMs: 0}],
  ['rate limited', {body: {error: 'rate_limited'}, status: 429, retry: '17'}, {ok: false, status: 429, code: 'rate_limited', retryAfterMs: 17_000}],
  ['temporarily unavailable', {body: {error: 'temporarily_unavailable'}, status: 503, retry: '9'}, {ok: false, status: 503, code: 'temporarily_unavailable', retryAfterMs: 9_000}],
  ['private error refused', {body: {error: 'private internal detail'}, status: 500}, {ok: false, status: 500, code: 'unexpected_response', retryAfterMs: 0}],
  ['network lost', 'network', {ok: false, status: 0, code: 'network_error', retryAfterMs: 0}],
] as const) {
  test(`${path} HTTP reports ${label} without replaying credentials`, async t => {
    const {replies, requests} = fixture(t);
    const body = path === '/login' ? passwordBody : factorBody;
    replies.push(reply);
    assert.deepEqual(await accountRequest(path, body), expected);
    assert.equal(requests.length, 1);
    sent(requests[0]!, path, body);
    replies.push({body: account});
    assert.deepEqual(await accountRequest(path, body), {ok: true, value: account});
    assert.equal(requests.length, 2);
    sent(requests[1]!, path, body);
  });
}

test('a password challenge and recovery proof complete as distinct explicit requests', async t => {
  const {replies, requests} = fixture(t);
  const recoveryBody = {challengeToken: challenge.challengeToken, proof: {kind: 'recovery', code: 'ABCDEF0123456789ABCDEF0123456789'}};
  replies.push({body: challenge, status: 202}, {body: account});
  assert.deepEqual(await accountRequest('/login', passwordBody), {ok: true, value: challenge});
  assert.equal(requests.length, 1, 'a challenge must not submit factor credentials automatically');
  assert.deepEqual(await accountRequest('/login/factor', recoveryBody), {ok: true, value: account});
  assert.equal(requests.length, 2);
  sent(requests[0]!, '/login', passwordBody);
  sent(requests[1]!, '/login/factor', recoveryBody);
  assert.equal(replies.length, 0);
});
