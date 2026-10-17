# Translate all (Cloud side) implementation plan

> **Read first: [bounded collect prerequisite, 2026-10-16](2026-10-16-translation-collect-pages.md).**
> It supersedes conflicting collect interfaces, snippets and tests in this plan, especially
> Tasks 3, 8, 10, 11 and 18. Preserve all 24 task numbers and unrelated behavioral assertions.
> The design and plan, US$5 UTC monthly per-venue cap, and submit admission (4 in flight,
> 1/address) are owner-approved. The amendment preserves accepted input limits.
> Runtime implementation and release qualification remain open.

**Execution:** work inline with failing behavioral tests first, then focused verification.
Do not dispatch an implementer and reviewer automatically for each task. Follow the amendment's
current migration and pre-push rules. Tasks 22–24 remain owner-only after 2026-11-02; preserve
their commands and do not execute them during autonomous implementation.

**Goal:** A connected Waitron box can send its missing customer-facing names to Cloud as one signed job, and collect suggested names written and reviewed by `gpt-6-luna`, with Cloud keeping nothing but usage counts.

**Architecture:** A new workspace package, `packages/translation`, holds the domain: the signed-fingerprint check, job body parsing, batching, prompt assembly, the reply checks and review merge, the OpenAI client, the job store, the four machine actions, consent, the worker and the retention sweep. `account-http` gains four machine routes and one account route that call into it, and runs the retention sweep itself whenever translation is switched on. A new command, `packages/translation/src/worker-cli.ts`, runs jobs on the existing `runWorkerLoop` (`packages/registration/src/worker-loop.ts`) as its own Compose service. Append-only migrations add the job tables (039), lossless retained results (040), and the fourth service (Task 17, using the next available number).

**Tech Stack:** TypeScript run directly by Node 26 (`erasableSyntaxOnly`, so no `enum`, no constructor parameter properties, no namespaces), `node --test`, `pg` against PostgreSQL 18 through `scripts/test-postgres.mjs`, Hono, Node's built-in `fetch`. No new third-party dependency.

**Spec:** [`docs/superpowers/specs/2026-10-14-translate-all-design.md`](../specs/2026-10-14-translate-all-design.md) and the wire contract, section "Translate all, version 1" of [`docs/waitron-integration-contract.md`](../../waitron-integration-contract.md). Read both before any task.

## Global Constraints

- First pass: `gpt-6-luna` at low reasoning effort; review pass: `gpt-6-luna` at medium effort; both "through the Responses API with `store: false`".
- Requests: "a 120 s timeout, redirects refused, and nothing from the request or the reply logged." Key: `CLOUD_OPENAI_API_KEY`, from the environment.
- "The model is pinned by name and recorded per job." Each job also records the provider and the prompt version.
- Batches: "Keep each family together … fill batches of about 90 items, category by category … A family bigger than 90 items stays whole." "Up to four batches run side by side for one job."
- Retries: "Each pass of a batch makes up to four calls: the first, then three retries after 2 s, 8 s and 30 s, or after the provider's `Retry-After` (capped at 60 s)." A batch that still fails marks its items failed; the job ends `partly_done` with reason `provider_failed`, or `failed` with reason `provider_unavailable` if every batch fails.
- Body: "The job body is capped at 1 MiB and 1,000 items"; `houseStyle` "holds 0 to 300 saved names." The field rules, the nine kinds and the context items are in the contract's "Submit" section.
- Request limits (contract, "Request limits"): submit accepts a whole HTTP request of up to 2,113,536 bytes received within 60 s; status, collect and release keep today's 16,384 bytes and 5 s (`packages/account-http/src/request.ts:6,15,22`, `server.ts:37`).
- Submit admission (owner-approved, Task 12): the account server admits at most 8 requests at once (`server.ts:32-35`), and a request keeps its place while its body is read. A submit therefore does not use one of those 8: it has its own allowance of 4 in flight, and at most 1 in flight per client address; past either, it is answered 503 `temporarily_unavailable` with `Retry-After: 1` before its body is read.
- Context items: an item with `missing: []` is accepted only when it heads the family of an item in the job with languages to write; it goes to the model as context, never appears in `results` or `failed`, and does not count in `total`, `done`, `failed` or the cap estimate.
- Reasons (contract, "Status, collect and release"): `partly_done` carries `limit_reached` or `provider_failed`; `failed` carries `provider_unavailable`, `consent_required` or `limit_reached`.
- The cap is refused at submit from an estimate; the worker only stops a running job at the cap. The US$5 per-venue calendar-month (UTC) safety cap is owner-approved (spec, decision 1). Pricing, billing and its replacement allowance remain release gates.
- Signed body: `{ "version": 1, "jobSha256": "<SHA-256 hex of the UTF-8 bytes of body>", "jobBytes": N }`. Cloud checks `jobBytes` and `jobSha256` against `body` before parsing it.
- "One open job per venue." A second submit while one is `queued` or `running` is refused with `translation_job_running`.
- States: `queued`, `running`, `done`, `partly_done`, `failed`, `collected`, `expired`.
- Collect: the [paging amendment](2026-10-16-translation-collect-pages.md) replaces every single-reply collect assumption below. Limit the full compact decoded JSON to 16,777,216 UTF-8 bytes, including UUID and `nextCursor`; use signed optional safe-integer offsets in filtered submit order. Return atomic unchanged items, maximal pages and repeatable reads. Never delete on collect; Waitron must durably reconcile every page before release. Joint paging/recovery proof with lane B A689-21 gates go-live. Its singleton proof uses the existing 1 MiB job bound without a new tag restriction.
- Retention: the body row "is deleted on `translation-release`, or by a sweep 24 hours after the job finished, which also moves an uncollected job to `expired`. A job that never finishes (no worker ran for a day) is swept 24 hours after it was submitted." The sweep runs in the worker and in the account server whenever `CLOUD_TRANSLATION=1`, so menus are deleted when no worker runs at all (Task 18). "No name ever enters a log."
- Consent names "three possible language-model providers: OpenAI, Anthropic and Google". "Until consent is recorded, `translation-submit` is refused with `translation_consent_required`."
- Seeing the service (contract): a `configuration` request whose signed body is exactly `{"servicesVersion":2}` receives four services, `content_translation` among them; `{}` keeps receiving exactly three. Services are matched by name; their order is not significant.
- An abort (worker shutdown, a lost lease) saves nothing for the batch it interrupted: neither a failed batch nor a first-pass-only result.
- Tests never need a real key: every provider test talks to a fake OpenAI server on loopback through the real client.
- Append migrations only; re-read the current directory and `migrationNames` before choosing a number. Jobs (039) and lossless results (040) are implemented. Task 17 must use the next available number (currently 041); its original 040 service snippets are conditional examples superseded by this rule. Update associated filenames, counts, indices and upgrade fixtures; never edit or renumber a landed migration.
- Every implementation task: failing test first and watch it fail, then the implementation, then focused tests green. Commit with `git commit -s` and a plain-English message. Before **every push**, run the full suites of each touched package and all dependent packages, including source/test/fixture readers; run the whole workspace only for shared configuration changes. Preserve normal hooks and require current-head CI results. CI does not replace those local suites.
- Database tests run from the repository root as `node scripts/test-postgres.mjs exec pnpm --dir packages/<pkg> exec node --test --test-timeout=30000 test/<file>.test.ts`; tests with no database run as `pnpm --dir packages/<pkg> exec node --test test/<file>.test.ts`. Read the `tests` count in each summary; a run that prints none proves nothing.
- Keep routine implementation inline. Delegate only independent work when coordination justifies it; there is no automatic per-task agent workflow.

## Review Focus

1. **Bytes, not characters.** A menu in Catalan or Spanish has accented letters, so `jobBytes` (UTF-8 bytes) differs from the JavaScript string length. A submit whose body holds `Cigaló` must be accepted, and a check written with `.length` must fail the test (Task 1, vectors use `Cigaló`).
2. **A legal 1 MiB body inside a larger HTTP request.** The job travels as a JSON string inside the envelope, so its escaped form can be up to twice as large (every `"` becomes `\"`). A body of exactly 1,048,576 bytes made mostly of quote characters must be accepted; 1,048,577 must be refused with 413 `translation_job_too_large`, not the generic `invalid_input` the 16 KiB reader returns (Task 12).
3. **Model replies that answer more than was asked.** A first-pass reply that rewrites a name the venue entered, or adds a language that was not missing, or a review change aimed at a placeholder, must not reach the results; only the item's `missing` languages, trimmed, come back (Task 5).
4. **A worker stopped or crashed mid-job.** A job must resume from its saved batches without sending a finished batch again (no double cost); an abort saves nothing for the batch it interrupted (Task 8); a worker process stopped with SIGTERM during a provider call exits cleanly and hands its lease back (Task 9).
5. **A job that never finishes, or no worker at all.** If no worker runs for a day, the menu must still be deleted 24 hours after the job was created, and the job marked `expired` — by the account server, with no worker process running (Task 18).

---

## File map

Created (all names below are introduced by this plan):

```text
packages/translation/package.json
packages/translation/README.md
packages/translation/src/index.ts              exports
packages/translation/src/errors.ts             TranslationError
packages/translation/src/service.ts            provider, model and prompt-version constants
packages/translation/src/submit-proof.ts       signed fingerprint check
packages/translation/src/job-body.ts           parseJob, kinds, limits
packages/translation/src/batching.ts           planBatches
packages/translation/src/prompt.ts             first-pass and review prompt assembly
packages/translation/src/reply.ts              extractJson, checkFirstPass, mergeReview
packages/translation/src/openai-client.ts      createOpenAiClient, ProviderError
packages/translation/src/batch-runner.ts       translateBatch (retries, review, cap hooks, aborts)
packages/translation/src/job-store.ts          submit, status, collect, release, spend
packages/translation/src/machine.ts            TranslationMachine (the four actions)
packages/translation/src/consent.ts            hasConsent, agreeConsent, withdrawConsent, listConsents
packages/translation/src/worker.ts             TranslationWorker
packages/translation/src/retention.ts          sweepTranslationJobs
packages/translation/src/worker-cli.ts         the translation-worker command
packages/translation/test/*.test.ts, test/fixtures.ts, test/fake-openai.ts
packages/translation/test/make-submit-vectors.ts, test/submit-vectors.json
packages/translation/quality/…                 the hand-run quality harness (Tasks 20 and 21)
packages/registration/migrations/039_translation_jobs.sql
packages/registration/migrations/041_content_translation_service.sql
packages/registration/test/content-translation-readers.test.ts, test/content-translation-service.test.ts
packages/account-http/src/translation.ts, src/translation-consent.ts
packages/account-http/test/translation.test.ts, test/translation-limits.test.ts, test/translation-consent.test.ts,
  test/translation-sweep.test.ts, test/content-translation-readers.test.ts
packages/operations/test/content-translation-readers.test.ts
apps/portal/src/translation-consent-controller.ts, src/translation-consent-screen.ts, test/translation-consent-controller.test.ts
```

Modified: `packages/registration/src/{installation-proof,installations,index,migrate,monitoring,email-outbox,usage-metering}.ts`, `packages/backups/src/replacement.ts`, `packages/operations/src/status.ts`, `packages/account-http/src/{app,request,server,server-cli,diagnostics,venue-overview}.ts`, `apps/portal/src/{app,installation-screen,locale}.ts`, `deploy/local-stack/runtime.mjs`, `compose.yaml`, `.env.example`, root `package.json`, `scripts/ci-scope.test.mjs`, `deploy/local-stack/compose-contract.test.mjs`, `deploy/local-stack/runtime.test.mjs`, the tests that pin the migration list or the service count (named in Tasks 2 and 17), and docs.

---

### Task 1: The signed fingerprint, the four machine actions and the shared test vectors

**Files:**
- Create: `packages/translation/package.json`, `src/index.ts`, `src/errors.ts`, `src/submit-proof.ts`, `test/submit-proof.test.ts`, `test/make-submit-vectors.ts`, `test/submit-vectors.json`
- Modify: `packages/registration/src/installation-proof.ts:4` (the `MachineAction` union) and `:41` (the action list inside `readMachineClaims`), `packages/registration/test/installation-proof.test.ts`, `scripts/ci-scope.test.mjs:26-38`, `pnpm-lock.yaml` (by `pnpm install`), `docs/waitron-integration-contract.md` (section "Shared test vectors", the vectors block only)

**Interfaces:**
- Consumes: `readMachineClaims`, `verifyMachine`, `encodeMachine`, `createLeaseIssuer`, `InstallationError` from `@waitron-cloud/registration`; the fixed keys and lease in `packages/registration/test/installation-vector.json`.
- Produces:
  - `MachineAction` gains `'translation-submit'|'translation-status'|'translation-collect'|'translation-release'`.
  - `export type TranslationErrorCode='invalid_request'|'consent_required'|'job_not_found'|'job_running'|'limit_reached'|'not_ready'|'expired'|'job_too_large'|'conflict'|'forbidden'`
  - `export class TranslationError extends Error {readonly code:TranslationErrorCode;readonly fits:number|undefined}` with `constructor(code,fits?)`.
  - `export const maxJobBytes=1048576, maxJobItems=1000;`
  - `export interface SubmitFingerprint {jobSha256:string;jobBytes:number}`
  - `export function jobFingerprint(body:string):SubmitFingerprint`
  - `export function checkSubmitBody(signedBody:string,body:string):SubmitFingerprint` — throws `InstallationError('invalid_proof')` for a malformed signed body or a mismatch, `TranslationError('job_too_large')` when `jobBytes>maxJobBytes`.

- [ ] **Step 1: Create the package**

`packages/translation/package.json`:

```json
{
  "name": "@waitron-cloud/translation",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc -p ../../tsconfig.json",
    "test": "node --test --test-timeout=30000 test/*.test.ts"
  },
  "dependencies": {
    "@waitron-cloud/registration": "workspace:*",
    "pg": "^8.23.0"
  },
  "devDependencies": {
    "@types/pg": "^8.23.1"
  }
}
```

Run `pnpm install` from the root so the workspace link and `pnpm-lock.yaml` update. The root `tsconfig.json` already includes `packages/**/*.ts`.

- [ ] **Step 2: Write the failing tests for the fingerprint**

`packages/translation/test/submit-proof.test.ts`:

```ts
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {InstallationError} from '@waitron-cloud/registration';
import {checkSubmitBody,jobFingerprint,maxJobBytes,TranslationError} from '../src/index.ts';
const body='{"staffName":"CARAJILLO","names":{"ca":"Cigaló"}}';
const signed=(f:object)=>JSON.stringify({version:1,...f});
test('the fingerprint counts UTF-8 bytes and hashes the exact text',()=>{
 const f=jobFingerprint(body);
 assert.equal(f.jobBytes,Buffer.byteLength(body,'utf8'));
 assert.notEqual(f.jobBytes,body.length);
 assert.equal(f.jobSha256,createHash('sha256').update(body,'utf8').digest('hex'));
 assert.deepEqual(checkSubmitBody(signed(f),body),f);
});
test('a changed byte, a wrong length or a malformed signed body is an invalid proof',()=>{
 const f=jobFingerprint(body);
 for(const [s,b] of [[signed(f),body.replace('Cigaló','Cigalo')],[signed({...f,jobBytes:f.jobBytes+1}),body],
  [signed({...f,jobSha256:f.jobSha256.toUpperCase()}),body],['{"version":2,"jobSha256":"'+f.jobSha256+'","jobBytes":'+f.jobBytes+'}',body],
  [JSON.stringify({...f}),body],[signed({...f,extra:1}),body],['not json',body],[signed({...f,jobBytes:1.5}),body]] as const){
  assert.throws(()=>checkSubmitBody(s,b),(e:unknown)=>e instanceof InstallationError&&e.code==='invalid_proof');
 }
});
test('a declared size over 1 MiB is refused as too large before hashing',()=>{
 assert.throws(()=>checkSubmitBody(signed({jobSha256:'0'.repeat(64),jobBytes:maxJobBytes+1}),'x'),
  (e:unknown)=>e instanceof TranslationError&&e.code==='job_too_large');
 const exact='a'.repeat(maxJobBytes);assert.equal(checkSubmitBody(signed(jobFingerprint(exact)),exact).jobBytes,maxJobBytes);
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --dir packages/translation exec node --test test/submit-proof.test.ts`
Expected: FAIL, cannot find `../src/index.ts`.

- [ ] **Step 4: Implement `errors.ts`, `submit-proof.ts` and `index.ts`**

`src/errors.ts`:

```ts
export type TranslationErrorCode='invalid_request'|'consent_required'|'job_not_found'|'job_running'|'limit_reached'|'not_ready'|'expired'|'job_too_large'|'conflict'|'forbidden';
export class TranslationError extends Error {
 readonly code:TranslationErrorCode;readonly fits:number|undefined;
 constructor(code:TranslationErrorCode,fits?:number){super(code);this.name='TranslationError';this.code=code;this.fits=fits;}
}
export function fail(code:TranslationErrorCode,fits?:number):never{throw new TranslationError(code,fits);}
```

`src/submit-proof.ts`:

```ts
import {createHash} from 'node:crypto';
import {InstallationError} from '@waitron-cloud/registration';
import {fail} from './errors.ts';
export const maxJobBytes=1048576,maxJobItems=1000;
export interface SubmitFingerprint {jobSha256:string;jobBytes:number}
function invalid():never{throw new InstallationError('invalid_proof');}
export function jobFingerprint(body:string):SubmitFingerprint{
 const bytes=Buffer.from(body,'utf8');
 return {jobSha256:createHash('sha256').update(bytes).digest('hex'),jobBytes:bytes.length};
}
export function checkSubmitBody(signedBody:string,body:string):SubmitFingerprint{
 let v:unknown;try{v=JSON.parse(signedBody);}catch{return invalid();}
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='jobBytes,jobSha256,version')return invalid();
 const s=v as Record<string,unknown>;
 if(s.version!==1||typeof s.jobSha256!=='string'||!/^[0-9a-f]{64}$/.test(s.jobSha256)||!Number.isSafeInteger(s.jobBytes)||Number(s.jobBytes)<1)return invalid();
 if(Number(s.jobBytes)>maxJobBytes)fail('job_too_large');
 const actual=jobFingerprint(body);
 if(actual.jobBytes!==s.jobBytes||actual.jobSha256!==s.jobSha256)return invalid();
 return actual;
}
```

`src/index.ts`:

```ts
export {TranslationError,type TranslationErrorCode} from './errors.ts';
export {checkSubmitBody,jobFingerprint,maxJobBytes,maxJobItems,type SubmitFingerprint} from './submit-proof.ts';
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --dir packages/translation exec node --test test/submit-proof.test.ts` — Expected: 3 passing.

- [ ] **Step 6: Add the four actions to the machine namespace, test first**

Append to `packages/registration/test/installation-proof.test.ts`, beside `'managed stream actions use the same signed machine namespace'`:

```ts
test('translation actions use the same signed machine namespace',()=>{
  for(const action of ['translation-submit','translation-status','translation-collect','translation-release'] as const){
    const value={...claims,action};const signed=proof(value);
    assert.equal(readMachineClaims(signed).action,action);
    assert.equal(verifyMachine(signed,publicKey,origin,action,now).action,action);
  }
});
```

Run `node --test packages/registration/test/installation-proof.test.ts` (no database) and watch it fail with `invalid_proof`. Then add the four names to the `MachineAction` union at `installation-proof.ts:4` and to the literal list inside `readMachineClaims` at `:41`. Rerun: pass.

- [ ] **Step 7: Generate the shared vectors from fixed keys**

`packages/translation/test/make-submit-vectors.ts` prints the vectors to stdout. It reuses the installation key, issuer and lease in `packages/registration/test/installation-vector.json`, so the vectors share keys with the existing installation vector:

```ts
import {readFileSync} from 'node:fs';
import {createPrivateKey,sign} from 'node:crypto';
import {encodeMachine} from '@waitron-cloud/registration';
import {jobFingerprint} from '../src/submit-proof.ts';
const v=JSON.parse(readFileSync(new URL('../../registration/test/installation-vector.json',import.meta.url),'utf8'));
const key=createPrivateKey({key:Buffer.from(v.privateKey,'base64url'),format:'der',type:'pkcs8'});
const origin=v.claims.origin,installationId=v.claims.installationId,issuedAt=v.claims.issuedAt,lease=JSON.stringify(v.lease);
const operationId='52345678-1234-4234-8234-123456789abc';
const job=(staffName:string)=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'variant:812',kind:'variant',family:'product:640',category:'TAP BEERS',staffName,existing:{en:'Pint'},missing:['ca','es']}],
 houseStyle:[{kind:'product',staffName:'CARAJILLO',names:{ca:'Cigaló',es:'Carajillo'}}]});
function envelope(signedBody:string,body:string){
 const payload=encodeMachine({origin,action:'translation-submit',installationId,operationId,issuedAt,lease,body:signedBody});
 return {payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url'),body};
}
const valid=job('PINTA'),f=jobFingerprint(valid),signed=JSON.stringify({version:1,...f});
const other=job('CANYA'),g=jobFingerprint(other);
const cases=[
 {name:'valid',expect:'accepted',envelope:envelope(signed,valid)},
 {name:'changed_body',expect:'401 invalid_proof',envelope:{...envelope(signed,valid),body:valid.replace('PINTA','PINTO')}},
 {name:'wrong_length',expect:'401 invalid_proof',envelope:envelope(JSON.stringify({version:1,jobSha256:f.jobSha256,jobBytes:f.jobBytes+1}),valid)},
 {name:'replayed_operation',expect:'409 conflict after valid',envelope:envelope(JSON.stringify({version:1,...g}),other)},
];
process.stdout.write(JSON.stringify({origin,installationId,operationId,issuedAt,publicKey:v.publicKey,issuerPublicKey:v.issuerPublicKey,issuerKeyId:v.issuerKeyId,lease:v.lease,cases},null,2)+'\n');
```

Run: `pnpm --dir packages/translation exec node test/make-submit-vectors.ts > packages/translation/test/submit-vectors.json`. Ed25519 signatures are deterministic, so a second run prints the same bytes; check with `diff`.

- [ ] **Step 8: Test the vectors and their copy in the contract**

Append to `test/submit-proof.test.ts`:

```ts
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readMachineClaims,verifyMachine,verifyLease} from '@waitron-cloud/registration';
const vectors=JSON.parse(readFileSync(new URL('./submit-vectors.json',import.meta.url),'utf8'));
test('the committed vectors are what the generator prints',()=>{
 const printed=execFileSync(process.execPath,[new URL('./make-submit-vectors.ts',import.meta.url).pathname],{encoding:'utf8'});
 assert.equal(printed,readFileSync(new URL('./submit-vectors.json',import.meta.url),'utf8'));
});
test('the contract publishes exactly the committed vectors',()=>{
 const contract=readFileSync(new URL('../../../docs/waitron-integration-contract.md',import.meta.url),'utf8');
 const section=contract.slice(contract.indexOf('### Shared test vectors'));
 const block=/```json\n([\s\S]*?)\n```/.exec(section);assert.ok(block,'vector block');
 assert.deepEqual(JSON.parse(block[1]!),vectors);
});
test('each vector has the outcome it names at the signature and fingerprint stage',()=>{
 const trusted=new Map([[vectors.issuerKeyId,vectors.issuerPublicKey]]);
 assert.equal(verifyLease(vectors.lease,trusted,vectors.origin,vectors.issuedAt).installationId,vectors.installationId);
 const check=(e:{payload:string;signature:string;body:string})=>{
  const claims=verifyMachine({payload:e.payload,signature:e.signature},vectors.publicKey,vectors.origin,'translation-submit',vectors.issuedAt);
  return checkSubmitBody(claims.body,e.body);
 };
 const byName=Object.fromEntries(vectors.cases.map((c:{name:string})=>[c.name,c]));
 assert.equal(check(byName.valid.envelope).jobBytes,Buffer.byteLength(byName.valid.envelope.body));
 for(const name of ['changed_body','wrong_length'])assert.throws(()=>check(byName[name].envelope),(e:unknown)=>e instanceof InstallationError&&e.code==='invalid_proof');
 const replay=byName.replayed_operation.envelope;
 assert.equal(readMachineClaims({payload:replay.payload,signature:replay.signature}).operationId,vectors.operationId);
 assert.notEqual(check(replay).jobSha256,check(byName.valid.envelope).jobSha256);
});
```

The `replayed_operation` refusal itself (409 `conflict`) needs stored jobs; Task 3 asserts it with these same fingerprints.

Run the file: the contract test fails until Step 9.

- [ ] **Step 9: Publish the vectors and the wire details this plan settles in the contract**

In `docs/waitron-integration-contract.md`, section "Shared test vectors", paste the whole content of `packages/translation/test/submit-vectors.json` in a ` ```json ` block below the section's last paragraph. It must be the section's only `json` block, because the test above reads the first one after the heading. The section already describes the document's shape, case names, operation ID and inputs, which this generator follows; if the generator's output disagrees with that description, stop and report it rather than editing either.

The wire details this plan used to settle here (the nine kinds, the field bounds, 401 for a fingerprint mismatch, 409 `conflict`, collect and release in each state, the reasons) were written into the contract when the specs and plans were reconciled on 2026-10-14; add nothing else to the contract in this task.

- [ ] **Step 10: Run the tests and update the CI pins**

Run: `pnpm --dir packages/translation exec node --test test/submit-proof.test.ts` — Expected: 6 passing.

The new package changes two pins in `scripts/ci-scope.test.mjs`: add `'@waitron-cloud/translation'` to the identity dependents list (it depends on registration, which depends on identity) in `'actual manifests resolve portal alone …'`, and change `assert.equal(full.packages.length, 20)` to `21` with the test title's "twenty" changed to "twenty-one". Run: `node --test scripts/ci-scope.test.mjs` — Expected: pass.

- [ ] **Step 11: Commit**

```bash
git add packages/translation packages/registration/src/installation-proof.ts packages/registration/test/installation-proof.test.ts scripts/ci-scope.test.mjs pnpm-lock.yaml docs/waitron-integration-contract.md
git commit -s -m "Add the translation package with the signed job fingerprint check, the four translation machine actions, and the shared signing test vectors in the contract"
```

---
### Task 2: Migration 039 — job, body, consent, price and policy tables

> **Migration numbers are conditional:** [recheck the current inventories](2026-10-16-translation-collect-pages.md#current-migrations-and-push-policy)
> before implementation. Append the then-current next numbers and update all related assertions;
> never edit a landed migration. The current maximum is 038, verified on 2026-10-16.

**Files:**
- Create: `packages/registration/migrations/039_translation_jobs.sql`, `packages/translation/test/schema.test.ts`, `packages/translation/test/fixtures.ts`
- Modify: `packages/registration/src/migrate.ts` (append to `migrationNames`), `packages/registration/src/usage-metering.ts` (types, source map, quantity rule at `:75`), `packages/registration/test/usage-metering.test.ts`, and the tests this migration breaks (Step 6): `packages/registration/test/registration.test.ts:79,82`, `packages/fiscal-allocation/test/schema.test.ts:25-38,82,133,307,309,310`

**Interfaces:**
- Produces tables `translation_prices`, `translation_policy`, `translation_consents`, `translation_jobs`, `translation_job_bodies`; `installation_services.service` accepts `content_translation`; `usage_events` accepts four `translation.*` event types with source kind `translation_job`. Every CHECK this task adds or replaces is named, so a refusal test can name the rule it hits.
- Produces `packages/translation/test/fixtures.ts`: `database()` (re-exported from `packages/account-http/test/fixtures.ts`) and `connectedVenue(db,issuer,origin)` returning `{accountId,organisationId,legalBusinessId,venueId,installationId,installationKey,lease:SignedEnvelope,proof(action,body?,operationId?,lease?,raw?,issuedAt?):SignedEnvelope,submit(job:string,operationId?,issuedAt?):{payload,signature,body}}`, built the way `staffExchangeFixture` in `packages/remote-access/test/staff-exchange-fixture.ts` builds a venue (signup, `RegistrationStore` start/approveCloud/approveLocal/complete, then `InstallationStore.execute('renew',…)` for the lease), without the remote placement. `installationKey` is the installation's public key (base64url SPKI). `submit` signs `{"version":1,…jobFingerprint(job)}` and adds `body`. Later tasks add `readyForTranslation` (Task 10) and `giveConsent` (Task 13) to this file.

- [ ] **Step 1: Write the fixtures**

`packages/translation/test/fixtures.ts`:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {InstallationStore,RegistrationStore,SignupStore,encodeMachine,type LeaseIssuer,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {jobFingerprint} from '../src/submit-proof.ts';
export {database};
export async function connectedVenue(db:Awaited<ReturnType<typeof database>>,issuer:LeaseIssuer,origin:string){
 const email=`translation-${randomUUID()}@example.test`,signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password:'A long enough test password',organisationName:'Cafe Sol',legalBusinessName:'Cafe Sol SL',countryCode:'ES'});
 const key=generateKeyPairSync('ed25519'),installationKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const binding={operationId:randomUUID(),installationKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registrations=new RegistrationStore(db.pool);await registrations.start(binding);await registrations.approveCloud(binding,owner.accountId);await registrations.approveLocal(binding,randomUUID());
 const installation=await registrations.complete(binding);
 function proof(action:string,body:unknown={},operationId=randomUUID(),lease?:SignedEnvelope,raw?:string,issuedAt=Date.now()):SignedEnvelope{
  const payload=encodeMachine({origin,action:action as MachineAction,installationId:installation.installationId,operationId,issuedAt,lease:lease?JSON.stringify(lease):'',body:raw??JSON.stringify(body)});
  return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
 }
 const lease=(await new InstallationStore(db.pool,issuer,origin).execute('renew',proof('renew'))).lease!;
 const submit=(job:string,operationId=randomUUID(),issuedAt=Date.now())=>({...proof('translation-submit',undefined,operationId,lease,JSON.stringify({version:1,...jobFingerprint(job)}),issuedAt),body:job});
 return {...owner,...installation,installationKey,lease,proof,submit};
}
```

- [ ] **Step 2: Write the failing schema test**

`packages/translation/test/schema.test.ts`. Each refusal names the constraint it must hit (`pg` puts the violated constraint's name on the error as `constraint`), so a refusal for some other reason fails the test:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {database,connectedVenue} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
const refusedBy=(name:string)=>(error:unknown)=>{assert.equal((error as {constraint?:string}).constraint,name,String(error));return true;};
const job=(v:{venueId:string;installationId:string},state='queued')=>db.pool.query(`INSERT INTO translation_jobs
 (id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,finished_at)
 VALUES($1,$2,$3,$4,$5,10,$6,1,'openai','gpt-6-luna','translate-all-v1',CASE WHEN $6 IN ('queued','running') THEN NULL ELSE clock_timestamp() END)`,
 [randomUUID(),v.installationId,v.venueId,randomUUID(),'a'.repeat(64),state]);
test('the seeded policy and price are the values the plan derives',async()=>{
 assert.deepEqual((await db.pool.query('SELECT monthly_cap_micro_usd::text,estimate_micro_usd_per_item::text FROM translation_policy')).rows,[{monthly_cap_micro_usd:'5000000',estimate_micro_usd_per_item:'146'}]);
 assert.deepEqual((await db.pool.query("SELECT provider,input_micro_usd_per_million::text,output_micro_usd_per_million::text FROM translation_prices WHERE model='gpt-6-luna'")).rows,
  [{provider:'openai',input_micro_usd_per_million:'100000',output_micro_usd_per_million:'500000'}]);
 await assert.rejects(db.pool.query('INSERT INTO translation_policy VALUES(false,1,1)'),refusedBy('translation_policy_singleton_check'));
 await assert.rejects(db.pool.query('INSERT INTO translation_policy VALUES(true,1,1)'),refusedBy('translation_policy_pkey'));
});
test('a venue holds one open job at a time, and finished ones do not count',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 await job(v);await assert.rejects(job(v),refusedBy('translation_jobs_one_open_idx'));
 await job(v,'done');await job(v,'expired');
});
test('a partly done or failed job carries a reason from its own list',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const finished=(state:string,reason:string|null)=>db.pool.query(`INSERT INTO translation_jobs
  (id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,reason,total,provider,model,prompt_version,finished_at)
  VALUES($1,$2,$3,$4,$5,10,$6,$7,1,'openai','gpt-6-luna','translate-all-v1',clock_timestamp())`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'a'.repeat(64),state,reason]);
 await finished('partly_done','limit_reached');await finished('partly_done','provider_failed');
 await finished('failed','provider_unavailable');await finished('failed','consent_required');await finished('failed','limit_reached');
 for(const [state,reason,rule] of [
  ['partly_done',null,'translation_jobs_reason_required_check'],['failed',null,'translation_jobs_reason_required_check'],
  ['partly_done','provider_unavailable','translation_jobs_partly_done_reason_check'],['failed','provider_failed','translation_jobs_failed_reason_check'],
  ['done','limit_reached','translation_jobs_reason_state_check'],['expired','not_a_reason','translation_jobs_reason_check'],
 ] as const)await assert.rejects(finished(state,reason),refusedBy(rule));
 await assert.rejects(db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version)
  VALUES($1,$2,$3,$4,$5,10,'done',1,'openai','gpt-6-luna','translate-all-v1')`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'a'.repeat(64)]),refusedBy('translation_jobs_finished_at_check'));
});
test('the fourth service name is accepted and an unknown one is not',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 // An upsert, because from migration 040 on (Task 17) every installation already has this row.
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'content_translation','ready')
  ON CONFLICT (installation_id,service) DO UPDATE SET state='ready'`,[v.installationId]);
 await assert.rejects(db.pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'bogus')",[v.installationId]),refusedBy('installation_services_service_check'));
});
test('usage events accept the translation measures with any positive quantity',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const insert=(type:string,quantity:number,kind:string)=>db.pool.query(`INSERT INTO usage_events(organisation_id,venue_id,event_type,quantity,source_kind,source_reference,occurred_at)
  VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`,[v.organisationId,v.venueId,type,quantity,kind,randomUUID()]);
 await insert('translation.cost_micro_usd',731,'translation_job');
 await assert.rejects(insert('translation.cost_micro_usd',5,'backup_point'),refusedBy('usage_events_source_match_check'));
 await assert.rejects(insert('operation.monitoring_probe',2,'monitoring_probe'),refusedBy('usage_events_unit_quantity_check'));
 await assert.rejects(insert('translation.unknown',1,'translation_job'),refusedBy('usage_events_event_type_check'));
});
test('a consent names exactly the three providers, and a venue holds one current consent',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const insert=(providers:string[])=>db.pool.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers)
  VALUES($1,$2,$3,$4,'providers-2026-10-14',$5)`,[randomUUID(),v.venueId,v.organisationId,v.accountId,providers]);
 await assert.rejects(insert(['openai']),refusedBy('translation_consents_providers_check'));await insert(['openai','anthropic','google']);
 await assert.rejects(insert(['openai','anthropic','google']),refusedBy('translation_consents_current_idx'));
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=30000 test/schema.test.ts`
Expected: FAIL, `relation "translation_policy" does not exist`.

- [ ] **Step 4: Write the migration**

The seeded values, so a reviewer can check them: OpenAI's standard prices read on 2026-10-14 (spec, "How the method was chosen") are $0.10 in and $0.50 out per million tokens for `gpt-6-luna`, which is 100,000 and 500,000 micro-US-dollars per million. The trial measured $0.0035 per 100 products for the first pass plus $0.0038 for the review, so 73 micro-dollars per item; the spec asks for twice that, 146. The monthly cap of 5,000,000 micro-dollars (US$5) per venue per calendar month (UTC) is owner-approved (spec, decision 1); at the estimate it allows about 34,000 items a month.

`packages/registration/migrations/039_translation_jobs.sql`:

```sql
ALTER TABLE installation_services DROP CONSTRAINT installation_services_service_check;
ALTER TABLE installation_services ADD CONSTRAINT installation_services_service_check
 CHECK (service IN ('remote_access','continuous_backup','retained_snapshots','content_translation'));

CREATE TABLE translation_prices (
 model text PRIMARY KEY CHECK (length(model) BETWEEN 1 AND 100),
 provider text NOT NULL CHECK (provider IN ('openai','anthropic','google')),
 input_micro_usd_per_million bigint NOT NULL CHECK (input_micro_usd_per_million>=0),
 output_micro_usd_per_million bigint NOT NULL CHECK (output_micro_usd_per_million>=0),
 source text NOT NULL CHECK (length(source) BETWEEN 1 AND 500)
);
INSERT INTO translation_prices VALUES ('gpt-6-luna','openai',100000,500000,
 'developers.openai.com/api/docs/pricing, standard tier, read 2026-10-14');

CREATE TABLE translation_policy (
 singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT translation_policy_singleton_check CHECK (singleton),
 monthly_cap_micro_usd bigint NOT NULL CHECK (monthly_cap_micro_usd>0),
 estimate_micro_usd_per_item bigint NOT NULL CHECK (estimate_micro_usd_per_item>0)
);
INSERT INTO translation_policy VALUES (true,5000000,146);

CREATE TABLE translation_consents (
 id uuid PRIMARY KEY,
 venue_id uuid NOT NULL REFERENCES venues(id),
 organisation_id uuid NOT NULL REFERENCES organisations(id),
 account_id uuid NOT NULL REFERENCES cloud_accounts(id),
 consent_version text NOT NULL CHECK (consent_version ~ '^[a-zA-Z0-9_.:-]{1,100}$'),
 providers text[] NOT NULL CONSTRAINT translation_consents_providers_check CHECK (providers=ARRAY['openai','anthropic','google']),
 consented_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 withdrawn_at timestamptz,
 CONSTRAINT translation_consents_withdrawn_check CHECK (withdrawn_at IS NULL OR withdrawn_at>=consented_at),
 FOREIGN KEY (venue_id,organisation_id) REFERENCES venues(id,organisation_id)
);
CREATE UNIQUE INDEX translation_consents_current_idx ON translation_consents(venue_id) WHERE withdrawn_at IS NULL;

CREATE TABLE translation_jobs (
 id uuid PRIMARY KEY,
 installation_id uuid NOT NULL REFERENCES installations(id),
 venue_id uuid NOT NULL REFERENCES venues(id),
 operation_id uuid NOT NULL,
 job_sha256 text NOT NULL CHECK (job_sha256 ~ '^[0-9a-f]{64}$'),
 job_bytes integer NOT NULL CHECK (job_bytes BETWEEN 1 AND 1048576),
 state text NOT NULL DEFAULT 'queued' CONSTRAINT translation_jobs_state_check
  CHECK (state IN ('queued','running','done','partly_done','failed','collected','expired')),
 reason text CONSTRAINT translation_jobs_reason_check CHECK (reason IN ('limit_reached','provider_failed','provider_unavailable','consent_required')),
 total integer NOT NULL CHECK (total BETWEEN 1 AND 1000),
 done integer NOT NULL DEFAULT 0 CHECK (done>=0),
 failed integer NOT NULL DEFAULT 0 CHECK (failed>=0),
 input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens>=0),
 output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens>=0),
 cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK (cost_micro_usd>=0),
 review_applied integer NOT NULL DEFAULT 0 CHECK (review_applied>=0),
 review_dropped integer NOT NULL DEFAULT 0 CHECK (review_dropped>=0),
 provider text NOT NULL CHECK (provider IN ('openai','anthropic','google')),
 model text NOT NULL REFERENCES translation_prices(model),
 prompt_version text NOT NULL CHECK (prompt_version ~ '^[a-z0-9.-]{1,64}$'),
 lease_id uuid,
 lease_until timestamptz,
 lease_count integer NOT NULL DEFAULT 0 CHECK (lease_count>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,
 finished_at timestamptz,
 collected_at timestamptz,
 UNIQUE (installation_id,operation_id),
 CONSTRAINT translation_jobs_counts_check CHECK (done+failed<=total),
 CONSTRAINT translation_jobs_finished_at_check CHECK ((state IN ('done','partly_done','failed')) <= (finished_at IS NOT NULL)),
 CONSTRAINT translation_jobs_reason_state_check CHECK ((reason IS NOT NULL) <= (state IN ('partly_done','failed','expired','collected'))),
 CONSTRAINT translation_jobs_reason_required_check CHECK ((state IN ('partly_done','failed')) <= (reason IS NOT NULL)),
 CONSTRAINT translation_jobs_partly_done_reason_check CHECK (state<>'partly_done' OR reason IN ('limit_reached','provider_failed')),
 CONSTRAINT translation_jobs_failed_reason_check CHECK (state<>'failed' OR reason IN ('provider_unavailable','consent_required','limit_reached'))
);
CREATE UNIQUE INDEX translation_jobs_one_open_idx ON translation_jobs(venue_id) WHERE state IN ('queued','running');
CREATE INDEX translation_jobs_venue_created_idx ON translation_jobs(venue_id,created_at);
CREATE INDEX translation_jobs_open_idx ON translation_jobs(created_at) WHERE state IN ('queued','running');

CREATE TABLE translation_job_bodies (
 job_id uuid PRIMARY KEY REFERENCES translation_jobs(id),
 body text NOT NULL,
 batch_results jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(batch_results)='object')
);

-- 025's checks are unnamed; replace them by name so this set stays readable.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='usage_events'::regclass AND contype='c' LOOP
  EXECUTE format('ALTER TABLE usage_events DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE usage_events
 ADD CONSTRAINT usage_events_event_type_check CHECK (event_type IN (
  'backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes','backup.restore_bytes',
  'operation.installation_completed','operation.monitoring_probe',
  'message.service_alert_sent','message.service_alert_failed','message.service_alert_expired','message.service_alert_cancelled',
  'translation.items_completed','translation.input_tokens','translation.output_tokens','translation.cost_micro_usd')),
 ADD CONSTRAINT usage_events_quantity_check CHECK (quantity>0),
 ADD CONSTRAINT usage_events_source_kind_check CHECK (source_kind IN (
  'backup_point','backup_recovery','installation_operation','monitoring_probe','service_alert','translation_job')),
 ADD CONSTRAINT usage_events_source_reference_check CHECK (length(source_reference) BETWEEN 1 AND 256
  AND source_reference ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$'),
 ADD CONSTRAINT usage_events_source_match_check CHECK (
  (event_type IN ('backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes') AND source_kind='backup_point')
  OR (event_type='backup.restore_bytes' AND source_kind='backup_recovery')
  OR (event_type='operation.installation_completed' AND source_kind='installation_operation')
  OR (event_type='operation.monitoring_probe' AND source_kind='monitoring_probe')
  OR (event_type LIKE 'message.service_alert_%' AND source_kind='service_alert')
  OR (event_type LIKE 'translation.%' AND source_kind='translation_job')),
 ADD CONSTRAINT usage_events_unit_quantity_check CHECK (event_type LIKE 'backup.%' OR event_type LIKE 'translation.%' OR quantity=1);
```

Before writing the `DROP CONSTRAINT` line, confirm the generated name: `psql … -c "SELECT conname FROM pg_constraint WHERE conrelid='installation_services'::regclass AND contype='c'"` against a migrated test schema must list `installation_services_service_check`. If it does not, use the printed name in the `DROP` and keep `installation_services_service_check` in the `ADD`, which is the name the test expects.

Append `'039_translation_jobs.sql'` to `migrationNames` in `packages/registration/src/migrate.ts`.

- [ ] **Step 5: Match the TypeScript usage vocabulary to the migration**

In `packages/registration/src/usage-metering.ts`, add `'translation.items_completed','translation.input_tokens','translation.output_tokens','translation.cost_micro_usd'` to `usageEventTypes`, add `'translation_job'` to `usageSourceKinds`, map each of the four new types to `'translation_job'` in `expectedSource`, and change the quantity rule at `:75` from `(!input.type.startsWith('backup.')&&input.quantity!==1n)` to `(!input.type.startsWith('backup.')&&!input.type.startsWith('translation.')&&input.quantity!==1n)`. Add to `packages/registration/test/usage-metering.test.ts`:

```ts
test('a translation measure records its quantity once per job and conflicts on a different one',async()=>{
 const input={organisationId,venueId,type:'translation.cost_micro_usd' as const,quantity:731n,sourceKind:'translation_job' as const,sourceReference:randomUUID(),occurredAt:new Date().toISOString()};
 await transaction(pool,c=>recordUsageEvent(c,input));await transaction(pool,c=>recordUsageEvent(c,input));
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE source_reference=$1',[input.sourceReference])).rows[0].n,1);
 await assert.rejects(transaction(pool,c=>recordUsageEvent(c,{...input,quantity:732n})),/usage_conflict/);
});
```

Use that file's existing `organisationId`/`venueId`/`pool` setup and imports; add `randomUUID`, `transaction` or `recordUsageEvent` to its imports if they are missing.

- [ ] **Step 6: Fix the tests this migration breaks**

Each of these pins the migration list at 38 entries, or compares every table before and after an upgrade. Change exactly these lines:

- `packages/registration/test/registration.test.ts:79` `assert.equal(migrationNames.length,38);` becomes `assert.equal(migrationNames.length,39);`, and `:82` `assert.equal(migrationNames.at(-1),'038_fiscal_allocation_registry.sql');` becomes `assert.equal(migrationNames[37],'038_fiscal_allocation_registry.sql');assert.equal(migrationNames[38],'039_translation_jobs.sql');`.
- `packages/fiscal-allocation/test/schema.test.ts`:
  - `:82` `assert.equal(ledger.length, 38);` becomes `assert.equal(ledger.length, migrationNames.length);` (`:83` stays: the ledger is ordered by name, so index 37 is still `038`).
  - `:133` `'38',` becomes `String(migrationNames.length),`.
  - `:307` `assert.equal(migrationNames.at(-1), '038_fiscal_allocation_registry.sql');` becomes `assert.equal(migrationNames[37], '038_fiscal_allocation_registry.sql');`.
  - `:309` `hasReleaseMigrationCount('38')` becomes `hasReleaseMigrationCount(String(migrationNames.length))`.
  - `:310` `for (const count of ['36', '37', '39'])` becomes `for (const count of ['36', '37', String(migrationNames.length - 1), String(migrationNames.length + 1)])`.
  - `oldState` (`:25-38`) lists every table except `fiscal_registry_*` after the upgrade too, so the five new `translation_*` tables (two of them seeded) appear only in the "after" snapshot of `'populated release37 upgrades concurrently without changing any old row or digest'`. Change its table query to `"SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT LIKE 'fiscal_registry_%' AND tablename NOT LIKE 'translation_%' ORDER BY tablename"`. That keeps the test's claim, that no row of an older table changes.

`migrationRelease` (`packages/registration/test/fixtures/migration-release.ts`) only knows releases 33 to 37, so the tests above keep starting from release 37 and upgrading to the current list.

- [ ] **Step 7: Run the focused tests**

```bash
node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=30000 test/schema.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/registration.test.ts test/usage-metering.test.ts test/schema-compatibility.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/fiscal-allocation exec node --test --test-timeout=120000 test/schema.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/registration/migrations/039_translation_jobs.sql packages/registration/src/migrate.ts packages/registration/src/usage-metering.ts packages/registration/test packages/fiscal-allocation/test/schema.test.ts packages/translation/test
git commit -s -m "Add the tables for translation jobs, their bodies, consents, prices and the spending policy, and let usage events record translation measures"
```

---

### Task 3: Job store — submit, status, collect, release and the spending cap

> **Authoritative replacement:** [paging amendment, Task 3 row and behavioral checks](2026-10-16-translation-collect-pages.md#implement-inline-with-failing-behavioral-tests-first).
> The `collectJob(client,row)` interface, batch-order flattening and single-reply expectations
> below are superseded. Accept cursor, reconstruct filtered submit order and return a measured
> maximal page with `nextCursor`. Preserve all submit, cap, state and release assertions.

**Files:**
- Create: `packages/translation/src/service.ts`, `src/job-store.ts`, `test/job-store.test.ts`
- Modify: `packages/translation/src/index.ts`

**Interfaces:**
- Consumes: `TranslationError`, `fail`, `SubmitFingerprint`, `jobFingerprint` (Task 1); the tables and `connectedVenue` (Task 2); `transaction` from `@waitron-cloud/registration`.
- Produces:
  - `service.ts`: `export const translationProvider='openai', translationModel='gpt-6-luna', translationPromptVersion='translate-all-v1';`
  - `export type JobState='queued'|'running'|'done'|'partly_done'|'failed'|'collected'|'expired'`
  - `export interface JobRow {id:string;installation_id:string;venue_id:string;operation_id:string;job_sha256:string;job_bytes:number;state:JobState;reason:string|null;total:number;done:number;failed:number;input_tokens:string;output_tokens:string;cost_micro_usd:string;review_applied:number;review_dropped:number;provider:string;model:string;prompt_version:string;lease_id:string|null;lease_until:Date|null;lease_count:number;created_at:Date;started_at:Date|null;finished_at:Date|null;collected_at:Date|null}` (`bigint` columns arrive from `pg` as strings).
  - `export interface ItemResult {ref:string;names:Record<string,string>;placeholder:boolean;corrections:{field:string;wrong:string;right:string}[]}`; `batch_results` holds `{"<batch index>":{"results":ItemResult[],"failed":string[],"stoppedByCap"?:true}}`.
  - `export async function lockVenue(client:PoolClient,venueId:string):Promise<void>` (transaction advisory lock)
  - `export async function findSubmitted(client,installationId,operationId,fingerprint):Promise<JobRow|undefined>` — throws `conflict` on a different fingerprint.
  - `export async function monthSpend(client,venueId):Promise<bigint>`; `export async function spendingPolicy(client):Promise<{cap:bigint;perItem:bigint}>`
  - `export async function createJob(client,input:{installationId:string;venueId:string;operationId:string;fingerprint:SubmitFingerprint;body:string;total:number}):Promise<JobRow>` — throws `job_running` or `limit_reached` (with `fits`). `total` is the number of items with languages to write (Task 4's `writtenItems`), never counting context items; the caller passes it.
  - `export function submitView(row:JobRow)` (`{version:1,jobId,state,total}`, the contract's submit reply, also what a retried submit returns, with the job's current state), `export function statusView(row:JobRow)` (adds `done`, `failed`, and `reason` for a `partly_done` or `failed` job), `export async function readJob(client,installationId,jobId):Promise<JobRow>` (throws `job_not_found`), `export async function collectJob(client,row:JobRow)`, `export async function releaseJob(client,row:JobRow)`.

- [ ] **Step 1: Write the failing tests**

`packages/translation/test/job-store.test.ts`:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {after,before,test} from 'node:test';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {collectJob,createJob,findSubmitted,jobFingerprint,lockVenue,readJob,releaseJob,statusView,submitView,TranslationError,type SubmitFingerprint} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const vectors=JSON.parse(readFileSync(new URL('./submit-vectors.json',import.meta.url),'utf8'));
before(async()=>{db=await database();});after(async()=>db?.close());
const submit=(v:{installationId:string;venueId:string},operationId:string,body:string,fingerprint:SubmitFingerprint,total:number)=>
 transaction(db.pool,async c=>{await lockVenue(c,v.venueId);return await findSubmitted(c,v.installationId,operationId,fingerprint)
  ??await createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId,fingerprint,body,total});});
const jobs=async(v:{venueId:string})=>(await db.pool.query('SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1',[v.venueId])).rows[0].n as number;
test('a retried submit returns the first job; the same operation with another fingerprint conflicts',async()=>{
 const v=await connectedVenue(db,issuer,origin),op=randomUUID(),body='{"x":1}',fp=jobFingerprint(body);
 const first=await submit(v,op,body,fp,3);
 assert.equal((await submit(v,op,body,fp,3)).id,first.id);
 await assert.rejects(submit(v,op,'{"x":2}',jobFingerprint('{"x":2}'),3),(e:unknown)=>e instanceof TranslationError&&e.code==='conflict');
 assert.equal(await jobs(v),1);
});
test('the shared replayed-operation vector conflicts after the valid one',async()=>{
 const byName=Object.fromEntries(vectors.cases.map((c:{name:string;envelope:{body:string}})=>[c.name,c.envelope.body]));
 const v=await connectedVenue(db,issuer,origin);
 await submit(v,vectors.operationId,byName.valid,jobFingerprint(byName.valid),1);
 await assert.rejects(submit(v,vectors.operationId,byName.replayed_operation,jobFingerprint(byName.replayed_operation),1),(e:unknown)=>e instanceof TranslationError&&e.code==='conflict');
});
test('a second job while one is open is refused, and allowed once the first finishes',async()=>{
 const v=await connectedVenue(db,issuer,origin);await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
 await assert.rejects(submit(v,randomUUID(),'{}',jobFingerprint('{}'),1),(e:unknown)=>e instanceof TranslationError&&e.code==='job_running');
 await db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp() WHERE venue_id=$1",[v.venueId]);
 await submit(v,randomUUID(),'{}',jobFingerprint('{}'),1);
 assert.equal(await jobs(v),2);
});
test('the estimate is refused up front with how many items would fit, and last month does not count',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,cost_micro_usd,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,1,'collected',1,'openai','gpt-6-luna','translate-all-v1',4999000,date_trunc('month',clock_timestamp(),'UTC'),clock_timestamp())`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'b'.repeat(64)]);
 // 1,000 micro-dollars left at 146 each: 6 items fit.
 await assert.rejects(submit(v,randomUUID(),'{}',jobFingerprint('{}'),7),(e:unknown)=>e instanceof TranslationError&&e.code==='limit_reached'&&e.fits===6);
 await submit(v,randomUUID(),'{}',jobFingerprint('{}'),6);
 const w=await connectedVenue(db,issuer,origin);
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,cost_micro_usd,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,1,'collected',1,'openai','gpt-6-luna','translate-all-v1',5000000,date_trunc('month',clock_timestamp(),'UTC')-interval '1 second',clock_timestamp())`,[randomUUID(),w.installationId,w.venueId,randomUUID(),'c'.repeat(64)]);
 await submit(w,randomUUID(),'{}',jobFingerprint('{}'),1000);
});
test('status shows the reason only for a partly done or failed job, and a retried submit returns the first job in its current state',async()=>{
 const v=await connectedVenue(db,issuer,origin),op=randomUUID(),fp=jobFingerprint('{}'),job=await submit(v,op,'{}',fp,2);
 assert.deepEqual(submitView(job),{version:1,jobId:job.id,state:'queued',total:2});
 assert.equal('reason' in statusView(job),false);
 await db.pool.query("UPDATE translation_jobs SET state='running' WHERE id=$1",[job.id]);
 assert.deepEqual(submitView(await submit(v,op,'{}',fp,2)),{version:1,jobId:job.id,state:'running',total:2});
 for(const [state,reason] of [['partly_done','limit_reached'],['partly_done','provider_failed'],['failed','provider_unavailable'],['failed','consent_required']] as const){
  await db.pool.query('UPDATE translation_jobs SET state=$2,reason=$3,finished_at=clock_timestamp() WHERE id=$1',[job.id,state,reason]);
  assert.equal(statusView(await transaction(db.pool,c=>readJob(c,v.installationId,job.id))).reason,reason);
 }
 assert.deepEqual(submitView(await submit(v,op,'{}',fp,2)),{version:1,jobId:job.id,state:'failed',total:2});
 assert.equal(await jobs(v),1);
});
test('another installation cannot read a job, and collect and release follow the contract states',async()=>{
 const a=await connectedVenue(db,issuer,origin),b=await connectedVenue(db,issuer,origin);
 const job=await submit(a,randomUUID(),'{}',jobFingerprint('{}'),2);
 const code=(name:string)=>(e:unknown)=>e instanceof TranslationError&&e.code===name;
 await assert.rejects(transaction(db.pool,c=>readJob(c,b.installationId,job.id)),code('job_not_found'));
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,a.installationId,job.id))),code('not_ready'));
 await assert.rejects(transaction(db.pool,async c=>releaseJob(c,await readJob(c,a.installationId,job.id))),code('not_ready'));
 await db.pool.query(`UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1`,[job.id,{0:{results:[{ref:'product:1',names:{ca:'Cafè'},placeholder:false,corrections:[]}],failed:['product:2']}}]);
 await db.pool.query("UPDATE translation_jobs SET state='partly_done',reason='provider_failed',done=1,failed=1,finished_at=clock_timestamp() WHERE id=$1",[job.id]);
 const collected=await transaction(db.pool,async c=>collectJob(c,await readJob(c,a.installationId,job.id)));
 assert.deepEqual(collected,{version:1,jobId:job.id,state:'partly_done',results:[{ref:'product:1',names:{ca:'Cafè'},placeholder:false,corrections:[]}],failed:['product:2']});
 const released=await transaction(db.pool,async c=>releaseJob(c,await readJob(c,a.installationId,job.id)));
 assert.deepEqual(released,{version:1,jobId:job.id,state:'collected'});
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows[0].n,0);
 assert.deepEqual(await transaction(db.pool,async c=>releaseJob(c,await readJob(c,a.installationId,job.id))),released);
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,a.installationId,job.id))),code('expired'));
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=30000 test/job-store.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 3: Implement `service.ts` and `job-store.ts`**

`src/service.ts`:

```ts
export const translationProvider='openai',translationModel='gpt-6-luna',translationPromptVersion='translate-all-v1';
```

`src/job-store.ts`:

```ts
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {fail} from './errors.ts';
import type {SubmitFingerprint} from './submit-proof.ts';
import {translationModel,translationPromptVersion,translationProvider} from './service.ts';
export type JobState='queued'|'running'|'done'|'partly_done'|'failed'|'collected'|'expired';
export interface ItemResult {ref:string;names:Record<string,string>;placeholder:boolean;corrections:{field:string;wrong:string;right:string}[]}
export interface JobRow {id:string;installation_id:string;venue_id:string;operation_id:string;job_sha256:string;job_bytes:number;state:JobState;reason:string|null;
 total:number;done:number;failed:number;input_tokens:string;output_tokens:string;cost_micro_usd:string;review_applied:number;review_dropped:number;
 provider:string;model:string;prompt_version:string;lease_id:string|null;lease_until:Date|null;lease_count:number;
 created_at:Date;started_at:Date|null;finished_at:Date|null;collected_at:Date|null}
export async function lockVenue(client:PoolClient,venueId:string){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-venue:'||$1,0))",[venueId]);}
export async function findSubmitted(client:PoolClient,installationId:string,operationId:string,f:SubmitFingerprint){
 const row=(await client.query<JobRow>('SELECT * FROM translation_jobs WHERE installation_id=$1 AND operation_id=$2',[installationId,operationId])).rows[0];
 if(row&&(row.job_sha256!==f.jobSha256||row.job_bytes!==f.jobBytes))fail('conflict');
 return row;
}
export async function spendingPolicy(client:PoolClient){
 const r=(await client.query('SELECT monthly_cap_micro_usd::text AS cap,estimate_micro_usd_per_item::text AS per FROM translation_policy')).rows[0];
 if(!r)throw new Error('translation_policy_missing');return {cap:BigInt(r.cap),perItem:BigInt(r.per)};
}
export async function monthSpend(client:PoolClient,venueId:string):Promise<bigint>{
 return BigInt((await client.query(`SELECT COALESCE(sum(cost_micro_usd),0)::text AS spent FROM translation_jobs
  WHERE venue_id=$1 AND created_at>=date_trunc('month',clock_timestamp(),'UTC')`,[venueId])).rows[0].spent);
}
export async function createJob(client:PoolClient,input:{installationId:string;venueId:string;operationId:string;fingerprint:SubmitFingerprint;body:string;total:number}){
 if((await client.query("SELECT 1 FROM translation_jobs WHERE venue_id=$1 AND state IN ('queued','running')",[input.venueId])).rowCount)fail('job_running');
 const {cap,perItem}=await spendingPolicy(client),left=cap-await monthSpend(client,input.venueId),total=BigInt(input.total);
 if(total*perItem>left){const fits=left<=0n?0n:left/perItem;fail('limit_reached',Number(fits<total?fits:total));}
 const row=(await client.query<JobRow>(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,total,provider,model,prompt_version)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[randomUUID(),input.installationId,input.venueId,input.operationId,input.fingerprint.jobSha256,input.fingerprint.jobBytes,input.total,translationProvider,translationModel,translationPromptVersion])).rows[0]!;
 await client.query('INSERT INTO translation_job_bodies(job_id,body) VALUES($1,$2)',[row.id,input.body]);
 return row;
}
export function submitView(r:JobRow){return {version:1,jobId:r.id,state:r.state,total:r.total};}
export function statusView(r:JobRow){return {version:1,jobId:r.id,state:r.state,total:r.total,done:r.done,failed:r.failed,...((r.state==='partly_done'||r.state==='failed')&&r.reason?{reason:r.reason}:{})};}
export async function readJob(client:PoolClient,installationId:string,jobId:string){
 const row=(await client.query<JobRow>('SELECT * FROM translation_jobs WHERE id=$1 AND installation_id=$2 FOR UPDATE',[jobId,installationId])).rows[0];
 return row??fail('job_not_found');
}
export async function collectJob(client:PoolClient,row:JobRow){
 if(row.state==='collected'||row.state==='expired')fail('expired');
 if(row.state!=='done'&&row.state!=='partly_done')fail('not_ready');
 const stored=(await client.query('SELECT batch_results FROM translation_job_bodies WHERE job_id=$1',[row.id])).rows[0];
 if(!stored)fail('expired');
 const batches=Object.entries(stored.batch_results as Record<string,{results:ItemResult[];failed:string[]}>).sort(([a],[b])=>Number(a)-Number(b)).map(([,b])=>b);
 return {version:1,jobId:row.id,state:row.state,results:batches.flatMap(b=>b.results),failed:batches.flatMap(b=>b.failed)};
}
export async function releaseJob(client:PoolClient,row:JobRow){
 if(row.state==='expired')fail('expired');
 if(row.state==='queued'||row.state==='running')fail('not_ready');
 if(row.state!=='collected'){
  await client.query('DELETE FROM translation_job_bodies WHERE job_id=$1',[row.id]);
  await client.query("UPDATE translation_jobs SET state='collected',collected_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=$1",[row.id]);
 }
 return {version:1,jobId:row.id,state:'collected'};
}
```

Two submits can both pass the open-job check before either inserts; `lockVenue` serialises them, and the unique index `translation_jobs_one_open_idx` is the backstop. Step 1's test covers the sequential case.

Add to `src/index.ts`:

```ts
export {translationModel,translationPromptVersion,translationProvider} from './service.ts';
export {collectJob,createJob,findSubmitted,lockVenue,monthSpend,readJob,releaseJob,spendingPolicy,statusView,submitView,type ItemResult,type JobRow,type JobState} from './job-store.ts';
```

- [ ] **Step 4: Run the tests and watch them pass.** Same command; expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/translation
git commit -s -m "Store translation jobs: a retried submit returns its first job in its current state, one open job per venue, the monthly spending estimate is refused up front with how many items fit, and collect and release follow the contract's states"
```

---

### Task 4: Job body parsing and batching

> **Paging:** the [single-item size proof](2026-10-16-translation-collect-pages.md#single-item-size-proof)
> uses the existing job byte limit. Preserve the parser below and its accepted language tags.

**Files:**
- Create: `packages/translation/src/job-body.ts`, `src/batching.ts`, `test/job-body.test.ts`, `test/batching.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `fail`, `TranslationError`, `maxJobItems` (Task 1).
- Produces:
  - `export const translationKinds=['product','variant','option_list','option_label','extra_list','menu','section','included_menu','unit'] as const; export type TranslationKind=typeof translationKinds[number];`
  - `export interface JobItem {ref:string;kind:TranslationKind;family:string;category:string|null;staffName:string;existing:Record<string,string>;missing:string[]}`
  - `export interface HouseStyleName {kind:TranslationKind;staffName:string;names:Record<string,string>}`
  - `export interface ParsedJob {country:string;languages:{default:string;enabled:string[]};items:JobItem[];houseStyle:HouseStyleName[]}`
  - `export function parseJob(text:string):ParsedJob` — throws `invalid_request`, or `job_too_large` over 1,000 items.
  - `export function writtenItems(job:ParsedJob):JobItem[]` — the items with a non-empty `missing`; context items (`missing: []`, contract "Submit") are left out. `total`, `done`, `failed` and the cap estimate count these only.
  - `export const batchTarget=90; export function planBatches(items:readonly JobItem[]):JobItem[][]`

- [ ] **Step 1: Write the failing batching tests**

`test/batching.test.ts` (no database):

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planBatches,type JobItem} from '../src/index.ts';
const item=(ref:string,family=ref,category:string|null='A'):JobItem=>({ref,kind:family===ref?'product':'variant',family,category,staffName:ref.toUpperCase(),existing:{},missing:['ca']});
test('a family is never split across batches',()=>{
 const items=[...Array.from({length:85},(_,i)=>item(`p${i}`)),item('head'),...Array.from({length:9},(_,i)=>item(`v${i}`,'head'))];
 const batches=planBatches(items);
 const holder=batches.filter(b=>b.some(i=>i.family==='head'));
 assert.equal(holder.length,1);assert.equal(holder[0]!.filter(i=>i.family==='head').length,10);
});
test('a family over 90 items stays whole in its own batch',()=>{
 const big=[item('head'),...Array.from({length:119},(_,i)=>item(`v${i}`,'head'))];
 const batches=planBatches([item('a'),...big,item('b')]);
 assert.deepEqual(batches.map(b=>b.length),[1,120,1]);
});
test('a category that fits in a batch is never split, and categories keep their order',()=>{
 const items=[...Array.from({length:50},(_,i)=>item(`a${i}`,`a${i}`,'A')),...Array.from({length:50},(_,i)=>item(`b${i}`,`b${i}`,'B')),...Array.from({length:50},(_,i)=>item(`c${i}`,`c${i}`,'C'))];
 assert.deepEqual(planBatches(items).map(b=>[...new Set(b.map(i=>i.category))]),[['A'],['B'],['C']]);
});
test('items of one category sent apart are batched together, and a family follows its head category',()=>{
 const items=[item('x1','x1','A'),item('y1','y1','B'),item('x2','x2','A'),item('v','x1','B')];
 assert.deepEqual(planBatches(items).map(b=>b.map(i=>i.ref)),[['x1','v','x2','y1']]);
});
test('1,000 items in ten categories of 100 make eleven batches of 90 and one of 10',()=>{
 const items=Array.from({length:1000},(_,i)=>item(`p${i}`,`p${i}`,`C${Math.floor(i/100)}`));
 const batches=planBatches(items);
 assert.deepEqual(batches.map(b=>b.length),[...Array(11).fill(90),10]);
 assert.deepEqual(batches.flat().map(i=>i.ref),items.map(i=>i.ref));
});
test('a context head with nothing missing counts in its batch and stays with its family',()=>{
 const head={...item('head'),missing:[]};
 const items=[...Array.from({length:85},(_,i)=>item(`p${i}`)),head,...Array.from({length:9},(_,i)=>item(`v${i}`,'head'))];
 const holder=planBatches(items).filter(b=>b.some(i=>i.family==='head'));
 assert.equal(holder.length,1);assert.ok(holder[0]!.includes(head));
});
test('a null category is its own group',()=>{
 assert.deepEqual(planBatches([item('a','a',null),item('b','b','B')]).flat().map(i=>i.category),[null,'B']);
});
```

Families are grouped first (in order of first appearance), then grouped by their head's category (the head's own `category`, or the first member's when the head is not in the job), so in the fourth test `v` joins `x1`.

- [ ] **Step 2: Run them and watch them fail** — `pnpm --dir packages/translation exec node --test test/batching.test.ts`; expected: FAIL, `planBatches` is not exported.

- [ ] **Step 3: Implement `batching.ts`**

```ts
import type {JobItem} from './job-body.ts';
export const batchTarget=90;
export function planBatches(items:readonly JobItem[]):JobItem[][]{
 const families=new Map<string,JobItem[]>();
 for(const item of items){const f=families.get(item.family);if(f)f.push(item);else families.set(item.family,[item]);}
 const groups=new Map<string|null,JobItem[][]>();
 for(const members of families.values()){
  const head=members.find(m=>m.ref===m.family)??members[0]!;
  const g=groups.get(head.category);if(g)g.push(members);else groups.set(head.category,[members]);
 }
 const batches:JobItem[][]=[];let current:JobItem[]=[];
 const close=()=>{if(current.length){batches.push(current);current=[];}};
 for(const group of groups.values()){
  const size=group.reduce((n,f)=>n+f.length,0);
  if(size<=batchTarget){if(current.length+size>batchTarget)close();for(const f of group)current.push(...f);continue;}
  for(const family of group){
   if(family.length>batchTarget){close();batches.push([...family]);continue;}
   if(current.length+family.length>batchTarget)close();
   current.push(...family);
  }
 }
 close();return batches;
}
```

Members keep body order; the box sends heads first (contract, "Submit"), and the prompt does not depend on it.

- [ ] **Step 4: Write the failing parse tests**

`test/job-body.test.ts`:

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseJob,TranslationError,writtenItems} from '../src/index.ts';
const valid={version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'variant:812',kind:'variant',family:'product:640',category:'TAP BEERS',staffName:'PINTA',existing:{en:'Pint'},missing:['ca','es']}],
 houseStyle:[{kind:'product',staffName:'CARAJILLO',names:{ca:'Cigaló',es:'Carajillo'}}]};
const refused=(e:unknown)=>e instanceof TranslationError&&e.code==='invalid_request';
test('the contract example parses',()=>{assert.equal(parseJob(JSON.stringify(valid)).items[0]!.ref,'variant:812');});
test('every broken field is an invalid request',()=>{
 const bad=[
  {...valid,version:2},{...valid,country:'Spain'},{...valid,country:'ZZ'},{...valid,extra:1},{...valid,languages:{default:'fr',enabled:['ca']}},
  {...valid,languages:{default:'ca',enabled:['ca','ca']}},{...valid,languages:{default:'ca',enabled:['ca','xx']}},{...valid,items:[]},
  {...valid,items:[{...valid.items[0],kind:'dish'}]},{...valid,items:[{...valid.items[0],missing:['en']}]},
  {...valid,items:[{...valid.items[0],missing:['fr']}]},{...valid,items:[{...valid.items[0],missing:[]}]},
  {...valid,items:[{...valid.items[0],existing:{fr:'x'}}]},{...valid,items:[{...valid.items[0],staffName:''}]},
  {...valid,items:[{...valid.items[0],staffName:'x'.repeat(501)}]},{...valid,items:[{...valid.items[0],ref:'r'.repeat(129)}]},
  {...valid,items:[valid.items[0],valid.items[0]]},{...valid,houseStyle:Array(301).fill(valid.houseStyle[0])},
  {...valid,houseStyle:undefined},{...valid,items:[{...valid.items[0],category:5}]},
  {...valid,items:[{ref:'list:1',kind:'option_list',family:'list:1',category:'TAP BEERS',staffName:'SIZES',existing:{},missing:['ca']}]},
 ];
 for(const b of bad)assert.throws(()=>parseJob(JSON.stringify(b)),refused,JSON.stringify(b).slice(0,120));
 assert.throws(()=>parseJob('not json'),refused);
});
test('only a product or a variant carries a category; every other kind sends null',()=>{
 const list={ref:'list:1',kind:'option_list',family:'list:1',category:null,staffName:'SIZES',existing:{},missing:['ca']};
 assert.equal(parseJob(JSON.stringify({...valid,items:[list]})).items[0]!.category,null);
 assert.equal(parseJob(JSON.stringify({...valid,items:[{...valid.items[0],category:null}]})).items[0]!.category,null);
});
test('a context head with nothing missing is accepted only beside a member it heads',()=>{
 const head={ref:'product:640',kind:'product',family:'product:640',category:'TAP BEERS',staffName:'CANYA',existing:{ca:'Canya',es:'Caña',en:'Half pint'},missing:[]};
 const job=parseJob(JSON.stringify({...valid,items:[head,valid.items[0]]}));
 assert.deepEqual(writtenItems(job).map(i=>i.ref),['variant:812']);
 for(const items of [[head],[{...head,ref:'product:9',family:'product:9'},valid.items[0]],[{...valid.items[0],missing:[]},{...valid.items[0],ref:'variant:813'}]])
  assert.throws(()=>parseJob(JSON.stringify({...valid,items})),refused,JSON.stringify(items).slice(0,120));
});
test('more than 1,000 items is too large, and exactly 1,000 is accepted',()=>{
 const many=(n:number)=>({...valid,items:Array.from({length:n},(_,i)=>({...valid.items[0],ref:`r${i}`,family:`r${i}`}))});
 assert.equal(parseJob(JSON.stringify(many(1000))).items.length,1000);
 assert.throws(()=>parseJob(JSON.stringify(many(1001))),(e:unknown)=>e instanceof TranslationError&&e.code==='job_too_large');
});
```

- [ ] **Step 5: Implement `job-body.ts`**

These are the contract's rules ("Submit"); a rule here that the contract does not state is a contract change, not a plan choice. `Intl.DisplayNames` answers a code it does not know with the code itself, which is how an unknown region or language is refused; on Node v26.7.0 it answered `ZZ` with "Unknown Region" and `und` with "root", so those two are refused by name.

```ts
import {fail} from './errors.ts';
import {maxJobItems} from './submit-proof.ts';
export const translationKinds=['product','variant','option_list','option_label','extra_list','menu','section','included_menu','unit'] as const;
export type TranslationKind=typeof translationKinds[number];
export interface JobItem {ref:string;kind:TranslationKind;family:string;category:string|null;staffName:string;existing:Record<string,string>;missing:string[]}
export interface HouseStyleName {kind:TranslationKind;staffName:string;names:Record<string,string>}
export interface ParsedJob {country:string;languages:{default:string;enabled:string[]};items:JobItem[];houseStyle:HouseStyleName[]}
const languageNames=new Intl.DisplayNames(['en'],{type:'language'}),regionNames=new Intl.DisplayNames(['en'],{type:'region'});
const categorised:readonly TranslationKind[]=['product','variant'];
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function bounded(value:unknown,max:number):value is string{return typeof value==='string'&&value.length>=1&&value.length<=max;}
function region(value:unknown):value is string{return typeof value==='string'&&/^[A-Z]{2}$/.test(value)&&value!=='ZZ'&&regionNames.of(value)!==value;}
function language(value:unknown):value is string{
 if(typeof value!=='string'||value==='und'||!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value))return false;
 try{return languageNames.of(value)!==value;}catch{return false;}
}
function kind(value:unknown):TranslationKind{if(!(translationKinds as readonly unknown[]).includes(value))fail('invalid_request');return value as TranslationKind;}
function names(value:unknown,enabled:ReadonlySet<string>):Record<string,string>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_request');
 const out:Record<string,string>={};
 for(const [lang,text] of Object.entries(value)){if(!enabled.has(lang)||!bounded(text,500))fail('invalid_request');out[lang]=text;}
 return out;
}
function item(raw:unknown,enabled:ReadonlySet<string>):JobItem{
 if(!exact(raw,['ref','kind','family','category','staffName','existing','missing'])||!bounded(raw.ref,128)||!bounded(raw.family,128)
  ||!bounded(raw.staffName,500)||!Array.isArray(raw.missing))fail('invalid_request');
 const itemKind=kind(raw.kind),category=raw.category;
 if(category!==null&&!(categorised.includes(itemKind)&&bounded(category,500)))fail('invalid_request');
 const existing=names(raw.existing,enabled),missing:unknown[]=raw.missing;
 if(!missing.every(l=>typeof l==='string'&&enabled.has(l)&&!(l in existing))||new Set(missing).size!==missing.length)fail('invalid_request');
 return {ref:raw.ref,kind:itemKind,family:raw.family,category:category as string|null,staffName:raw.staffName,existing,missing:missing as string[]};
}
export function parseJob(text:string):ParsedJob{
 let value:unknown;try{value=JSON.parse(text);}catch{return fail('invalid_request');}
 if(!exact(value,['version','country','languages','items','houseStyle'])||value.version!==1||!region(value.country))fail('invalid_request');
 const langs=value.languages;
 if(!exact(langs,['default','enabled'])||!Array.isArray(langs.enabled)||langs.enabled.length<1||langs.enabled.length>20
  ||!langs.enabled.every(language)||new Set(langs.enabled).size!==langs.enabled.length||typeof langs.default!=='string'||!langs.enabled.includes(langs.default))fail('invalid_request');
 const enabled=new Set<string>(langs.enabled as string[]);
 if(!Array.isArray(value.items))fail('invalid_request');
 if(value.items.length>maxJobItems)fail('job_too_large');
 if(value.items.length<1)fail('invalid_request');
 const items=value.items.map((raw:unknown)=>item(raw,enabled));
 if(new Set(items.map(i=>i.ref)).size!==items.length||!items.some(i=>i.missing.length))fail('invalid_request');
 for(const head of items)if(!head.missing.length&&(head.ref!==head.family||!items.some(member=>member!==head&&member.family===head.ref&&member.missing.length)))fail('invalid_request');
 if(!Array.isArray(value.houseStyle)||value.houseStyle.length>300)fail('invalid_request');
 const houseStyle=value.houseStyle.map((raw:unknown):HouseStyleName=>{
  if(!exact(raw,['kind','staffName','names'])||!bounded(raw.staffName,500))fail('invalid_request');
  return {kind:kind(raw.kind),staffName:raw.staffName,names:names(raw.names,enabled)};
 });
 return {country:value.country,languages:{default:langs.default,enabled:[...enabled]},items,houseStyle};
}
export function writtenItems(job:ParsedJob):JobItem[]{return job.items.filter(i=>i.missing.length>0);}
```

Add to `src/index.ts`:

```ts
export {parseJob,translationKinds,writtenItems,type HouseStyleName,type JobItem,type ParsedJob,type TranslationKind} from './job-body.ts';
export {batchTarget,planBatches} from './batching.ts';
```

- [ ] **Step 6: Run both files and watch them pass.** `pnpm --dir packages/translation exec node --test test/batching.test.ts test/job-body.test.ts`; expected: 12 passing.

- [ ] **Step 7: Commit**

```bash
git add packages/translation
git commit -s -m "Parse translation job bodies against the contract's bounds, including that only products and variants carry a category, and plan batches of about 90 that keep families and small categories whole"
```

---

### Task 5: Prompt assembly, reply checks and the review merge

**Files:**
- Create: `packages/translation/src/prompt.ts`, `src/reply.ts`, `test/prompt.test.ts`, `test/reply.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `ParsedJob`, `JobItem`, `parseJob` (Task 4); `ItemResult` (Task 3).
- Produces:
  - `export function batchIds(batch:readonly JobItem[]):string[]` — `p01`…, padded to the batch's width (a 120-item batch uses `p001`).
  - `export function firstPassInstructions(job:ParsedJob):string; export function firstPassInput(job:ParsedJob,batch:readonly JobItem[]):string;`
  - `export function reviewInstructions(job:ParsedJob):string; export function reviewInput(job:ParsedJob,batch:readonly JobItem[],first:readonly ItemResult[]):string|undefined` (undefined when no item in the batch has a non-placeholder first-pass result).
  - `export class ReplyError extends Error {readonly reason:'no_json'|'shape'|'duplicate'|'missing'|'empty'}` (its `message` is the reason)
  - `export function extractJson(text:string):unknown`
  - `export function checkFirstPass(job:ParsedJob,batch:readonly JobItem[],text:string):ItemResult[]`
  - `export function mergeReview(_job:ParsedJob,batch:readonly JobItem[],first:readonly ItemResult[],text:string):{results:ItemResult[];applied:number;dropped:number}`

- [ ] **Step 1: Write the prompt tests first**

`test/prompt.test.ts` pins the template for the trial's venue (Spain, Catalan default, Spanish and English), so any later edit shows in a diff and must be re-scored (Task 22):

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {firstPassInput,firstPassInstructions,parseJob,reviewInput,reviewInstructions,type ItemResult} from '../src/index.ts';
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{},missing:['ca','es','en']},
  {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],
 houseStyle:[{kind:'product',staffName:'CARAJILLO',names:{ca:'Cigaló',es:'Carajillo'}}]}));
test('the first-pass instructions are the fourth prompt with the venue filled in',()=>{
 const text=firstPassInstructions(job);
 assert.ok(text.startsWith("You write customer-facing names for a venue's menu in Spain.\nThe venue's default customer language is Catalan (ca). The other customer languages are Spanish (es) and English (en).\n"));
 assert.ok(text.includes("4. Write each language as a native speaker would. Each language's names use that language's own vocabulary, not another\n   language's words written in its spelling."));
 assert.ok(!/Catalan names use|Spanish names use|café-bar/.test(text));
 for(const example of ['patates braves','truita de patates','brunch','poke bowl','SPECIAL 7'])assert.ok(text.includes(example),example);
 assert.ok(text.includes('2. A dish or drink that has a standard name in a language is called by that name in that language, the way a local\n'));
 assert.ok(text.includes('   to "internal", so staff can fix the internal name too. List only real spelling fixes, not translations,\n   capitalisation or dropped prices.\n'));
 assert.ok(text.includes('{"products": [{"id": "p01", "ca": "...", "es": "...", "en": "...", "placeholder": false,'));
 assert.ok(text.includes('set "placeholder": true and leave all\n   its names empty.'));
 assert.ok(text.endsWith('"corrections" is an empty list when there is nothing to fix.\nEvery product appears once.'));
});
test('one or no other language reads naturally',()=>{
 const two={...job,languages:{default:'es',enabled:['es','en']}},one={...job,languages:{default:'es',enabled:['es']}};
 assert.ok(firstPassInstructions(two).includes('The other customer language is English (en).'));
 assert.ok(firstPassInstructions(one).includes('The venue has no other customer languages.'));
 assert.ok(firstPassInstructions(two).includes('{"id": "p01", "es": "...", "en": "...", "placeholder": false,'));
});
test('the input carries house style, kinds and the family link only to an item in the batch',()=>{
 const input=firstPassInput(job,job.items);
 assert.ok(input.startsWith('Names this venue has saved: follow their wording where they apply.\n'));
 const rows=JSON.parse(input.slice(input.indexOf('Products:\n')+'Products:\n'.length));
 assert.deepEqual(rows,[{id:'p01',kind:'product',internal:'GUILDAS',category:'BAR TAPAS',existing:{}},
  {id:'p02',kind:'variant',internal:'DOBLE',category:'BAR TAPAS',existing:{en:'Double'},partOf:'p01'}]);
 assert.ok(!firstPassInput(job,[job.items[1]!]).includes('partOf'));
 assert.ok(!firstPassInput({...job,houseStyle:[]},job.items).includes('saved'));
});
test('the review lists every language with given ones marked, and skips placeholders',()=>{
 const first:ItemResult[]=[{ref:'product:1',names:{},placeholder:true,corrections:[]},{ref:'variant:2',names:{ca:'Doble',es:'Doble'},placeholder:false,corrections:[]}];
 const rows=JSON.parse(reviewInput(job,job.items,first)!.slice('Names:\n'.length));
 assert.deepEqual(rows,[{id:'p02',internal:'DOBLE',category:'BAR TAPAS',names:{ca:'Doble',es:'Doble',en:'Double'},given:['en']}]);
 assert.ok(reviewInstructions(job).startsWith("You review customer-facing names that someone else wrote for a venue's menu.\nThe venue's customer languages are: ca (Catalan, the default), es (Spanish), en (English).\n"));
 assert.equal(reviewInput(job,[job.items[0]!],[first[0]!]),undefined);
});
```

Run `pnpm --dir packages/translation exec node --test test/prompt.test.ts` and watch it fail (missing exports).

- [ ] **Step 2: Implement `prompt.ts`**

The first-pass template is the spec appendix's "First pass (fourth prompt)" with only the edits the spec lists: line 1 names the country (`Intl.DisplayNames(['en'],{type:'region'})`) and drops "café-bar"; line 2 is built from the job's languages (`Intl.DisplayNames(['en'],{type:'language'})`); rule 4 becomes the spec's sentence, wrapped at the same width; rule 9 says "all its names" instead of "all three names", keeping the appendix's line break; the JSON shape lists the job's languages, default first. Every other line below is the appendix's, character for character. The review template is the appendix's "Review pass" with "for a café-bar's menu" made "for a venue's menu" and its language line built from the job.

```ts
import type {JobItem,ParsedJob} from './job-body.ts';
import type {ItemResult} from './job-store.ts';
const languages=new Intl.DisplayNames(['en'],{type:'language'}),regions=new Intl.DisplayNames(['en'],{type:'region'});
const named=(code:string)=>`${languages.of(code)} (${code})`;
function ordered(job:ParsedJob){return [job.languages.default,...job.languages.enabled.filter(l=>l!==job.languages.default)];}
function joined(parts:string[]){return parts.length<2?parts.join(''):`${parts.slice(0,-1).join(', ')} and ${parts.at(-1)}`;}
export function batchIds(batch:readonly JobItem[]){const width=Math.max(2,String(batch.length).length);return batch.map((_,i)=>'p'+String(i+1).padStart(width,'0'));}
export function firstPassInstructions(job:ParsedJob){
 const [first,...rest]=ordered(job);
 const otherLine=!rest.length?'The venue has no other customer languages.':rest.length===1?`The other customer language is ${named(rest[0]!)}.`:`The other customer languages are ${joined(rest.map(named))}.`;
 const shape=[first!,...rest].map(l=>`"${l}": "..."`).join(', ');
 return `You write customer-facing names for a venue's menu in ${regions.of(job.country)}.
The venue's default customer language is ${named(first!)}. ${otherLine}

Each product has an internal name typed quickly by staff: often in capitals, mixing languages, with typos,
abbreviations, prices or codes. Some products already have a customer-facing name in one or more languages.

Rules:
1. A customer-facing name that is already given is kept exactly as given, character for character.
2. A dish or drink that has a standard name in a language is called by that name in that language, the way a local
   menu would print it, not translated word for word from another language. For example patates braves (ca) /
   patatas bravas (es) / patatas bravas (en); truita de patates (ca) / tortilla de patatas (es) / Spanish omelette
   (en). Keep any detail the existing names add beyond the standard dish: "patatas bravas con alioli" becomes
   "patates braves amb allioli".
   Some names stay as they are on menus here in every language, such as a sandwich or bowl known by an English or
   brand-like name (brunch, poke bowl); do not translate those.
3. Otherwise, write a missing language from the existing customer-facing names (given, or written by you for the
   default language), never from the internal name alone when a customer-facing name exists.
4. Write each language as a native speaker would. Each language's names use that language's own vocabulary, not another
   language's words written in its spelling.
5. Correct typos in dish names and in brand names, and spell a brand as the brand spells it.
6. Keep everything the customer needs to know: what comes with it (with fries, with salad), the serving size
   (33 cl, 50 cl, half, double), and whether it is takeaway. Correct an obviously wrong unit (a 33 ml bottle is
   33 cl). Drop only prices, stock codes and staff notes. Use sentence case.
7. Never change a customer-facing name that is already given, even to fix it. If it has a spelling mistake, list
   the fix under "corrections" with "field" set to its language.
8. When you correct a typo in the internal name (in a dish or a brand), list it under "corrections" with "field" set
   to "internal", so staff can fix the internal name too. List only real spelling fixes, not translations,
   capitalisation or dropped prices.
9. A placeholder product is one whose internal name does not say what the customer gets, such as a "special" sold
   at a price (SPECIAL 7, TAPA SPECIAL 3.00). Do not invent a name for it: set "placeholder": true and leave all
   its names empty.

Reply with JSON only, no prose, in exactly this shape:
{"products": [{"id": "p01", ${shape}, "placeholder": false,
  "corrections": [{"field": "internal", "wrong": "...", "right": "..."}]}]}
"corrections" is an empty list when there is nothing to fix.
Every product appears once.`;
}
export function firstPassInput(job:ParsedJob,batch:readonly JobItem[]){
 const ids=batchIds(batch),idOf=new Map(batch.map((item,i)=>[item.ref,ids[i]!]));
 const rows=batch.map((item,i)=>{
  const head=item.family!==item.ref?idOf.get(item.family):undefined;
  return {id:ids[i]!,kind:item.kind,internal:item.staffName,category:item.category,existing:item.existing,...(head?{partOf:head}:{})};
 });
 const style=job.houseStyle.length
  ?'Names this venue has saved: follow their wording where they apply.\n'+JSON.stringify(job.houseStyle.map(h=>({kind:h.kind,internal:h.staffName,names:h.names})),null,1)+'\n\n':'';
 return style+'Products:\n'+JSON.stringify(rows,null,1);
}
export function reviewInstructions(job:ParsedJob){
 const list=ordered(job).map(l=>`${l} (${languages.of(l)}${l===job.languages.default?', the default':''})`).join(', ');
 return `You review customer-facing names that someone else wrote for a venue's menu.
The venue's customer languages are: ${list}.

For every name in every language, ask: is this exactly how a native speaker writing this venue's menu in that
language would print it? Check that it uses that language's own vocabulary and grammar, the standard local name of
the dish or drink where one exists, no word-for-word copy of another language's phrasing, and that nothing the
customer needs (what comes with it, the serving size, takeaway) has been lost compared with the internal name and
the other languages.

Names marked "given" were entered by the venue and are never changed. Leave a name alone when it is already right.

Reply with JSON only, no prose, listing only the names you would change:
{"changes": [{"id": "p01", "language": "ca", "name": "...", "reason": "..."}]}
"changes" is an empty list when every name is right. Write reasons in English.`;
}
export function reviewInput(job:ParsedJob,batch:readonly JobItem[],first:readonly ItemResult[]){
 const ids=batchIds(batch),byRef=new Map(first.map(r=>[r.ref,r])),order=ordered(job);
 const rows=batch.flatMap((item,i)=>{
  const result=byRef.get(item.ref);
  if(!item.missing.length||!result||result.placeholder)return [];
  return [{id:ids[i]!,internal:item.staffName,category:item.category,
   names:Object.fromEntries(order.map(l=>[l,item.existing[l]??result.names[l]??''])),given:Object.keys(item.existing).sort()}];
 });
 return rows.length?'Names:\n'+JSON.stringify(rows,null,1):undefined;
}
```

`firstPassInput` sends every item in the batch, context items included (their `existing` holds their complete names, which is what a member needs to see). `JSON.stringify(rows,null,1)` prints the same layout as the trial's `json.dumps(…, ensure_ascii=False, indent=1)`.

Rerun the prompt test: 4 passing.

- [ ] **Step 3: Write the reply tests first**

`test/reply.test.ts` — a port of the trial's `ExtractJson`, `Normalise`, `Placeholders` and `ReviewMerge` cases (`test_trial.py`), plus Review Focus 3:

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkFirstPass,extractJson,firstPassInput,mergeReview,parseJob,ReplyError,reviewInput} from '../src/index.ts';
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{},missing:['ca','es','en']},
  {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],houseStyle:[]}));
const reason=(name:string)=>(e:unknown)=>e instanceof ReplyError&&e.reason===name;
test('a fenced reply with prose around it, and a bare reply, both parse; no JSON is a reply error',()=>{
 assert.deepEqual(extractJson('Here you go:\n```json\n{"products": []}\n```\nDone.'),{products:[]});
 assert.deepEqual(extractJson('{"products": [1]}'),{products:[1]});
 assert.throws(()=>extractJson('sorry, I cannot'),reason('no_json'));
});
test('the first pass keeps only missing languages, trimmed, and never a given name',()=>{
 const reply=JSON.stringify({products:[{id:'p01',ca:' Gildes ',es:'Gildas',en:'Gildas',placeholder:false,corrections:[]},
  {id:'p02',ca:'Doble',es:'Doble',en:'Rewritten double',fr:'Double',corrections:[{field:'internal',wrong:'DOBLE',right:'DOBLE'},{field:'en',wrong:'Double',right:'Double shot'},{field:'xx',wrong:'a',right:'b'}]},{id:'p99',ca:'x'}]});
 const got=checkFirstPass(job,job.items,reply);
 assert.deepEqual(got[0],{ref:'product:1',names:{ca:'Gildes',es:'Gildas',en:'Gildas'},placeholder:false,corrections:[]});
 assert.deepEqual(got[1],{ref:'variant:2',names:{ca:'Doble',es:'Doble'},placeholder:false,corrections:[{field:'en',wrong:'Double',right:'Double shot'}]});
});
test('a missing product, a duplicate, or an empty missing language fails the check; a placeholder may be empty',()=>{
 const one=(p:object)=>JSON.stringify({products:[{id:'p01',ca:'a',es:'b',en:'c'},p]});
 assert.throws(()=>checkFirstPass(job,job.items,JSON.stringify({products:[{id:'p01',ca:'a',es:'b',en:'c'}]})),reason('missing'));
 assert.throws(()=>checkFirstPass(job,job.items,one({id:'p01',ca:'a',es:'b',en:'c'})),reason('duplicate'));
 assert.throws(()=>checkFirstPass(job,job.items,one({id:'p02',ca:'',es:'b'})),reason('empty'));
 assert.throws(()=>checkFirstPass(job,job.items,'{"items":[]}'),reason('shape'));
 assert.deepEqual(checkFirstPass(job,job.items,one({id:'p02',placeholder:true}))[1]!.names,{});
});
test('the review merge applies only allowed changes and counts the rest',()=>{
 const first=checkFirstPass(job,job.items,JSON.stringify({products:[{id:'p01',placeholder:true},{id:'p02',ca:'Doble',es:'Doble',en:'Double'}]}));
 const changes={changes:[{id:'p02',language:'ca',name:'Doble (cervesa)'},{id:'p02',language:'en',name:'Not allowed: given'},
  {id:'p01',language:'ca',name:'Placeholder'},{id:'p99',language:'ca',name:'Nobody'},{id:'p02',language:'xx',name:'No such'},
  {id:'p02',language:'es',name:'  '},{id:'p02',language:'ca',name:'Second change'}]};
 const merged=mergeReview(job,job.items,first,JSON.stringify(changes));
 assert.deepEqual(merged.results[1]!.names,{ca:'Doble (cervesa)',es:'Doble'});
 assert.deepEqual(merged.results[0]!.names,{});
 assert.deepEqual([merged.applied,merged.dropped],[1,6]);
 assert.equal(first[1]!.names.ca,'Doble');
 assert.throws(()=>mergeReview(job,job.items,first,'{"nope":[]}'),reason('shape'));
});
test('a context head needs no entry, gets no result and takes no review change',()=>{
 const ctx=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{ca:'Gildes',es:'Gildas',en:'Gildas'},missing:[]},
   {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],houseStyle:[]}));
 const first=checkFirstPass(ctx,ctx.items,JSON.stringify({products:[{id:'p02',ca:'Doble',es:'Doble'}]}));
 assert.deepEqual(first.map(r=>r.ref),['variant:2']);
 assert.deepEqual(checkFirstPass(ctx,ctx.items,JSON.stringify({products:[{id:'p01',ca:'Rewritten'},{id:'p02',ca:'Doble',es:'Doble'}]})).map(r=>r.ref),['variant:2']);
 const merged=mergeReview(ctx,ctx.items,first,JSON.stringify({changes:[{id:'p01',language:'ca',name:'Gildes noves'}]}));
 assert.deepEqual([merged.applied,merged.dropped],[0,1]);
 assert.ok(!reviewInput(ctx,ctx.items,first)!.includes('GUILDAS'));
 assert.ok(firstPassInput(ctx,ctx.items).includes('"partOf": "p01"'));
});
```

Run `pnpm --dir packages/translation exec node --test test/reply.test.ts` and watch it fail (missing exports).

- [ ] **Step 4: Implement `reply.ts`**

`extractJson` ports the trial's `extract_json`: a fenced object if there is one, else the text from the first `{` to the last `}`.

```ts
import type {JobItem,ParsedJob} from './job-body.ts';
import type {ItemResult} from './job-store.ts';
import {batchIds} from './prompt.ts';
export class ReplyError extends Error {
 readonly reason:'no_json'|'shape'|'duplicate'|'missing'|'empty';
 constructor(reason:ReplyError['reason']){super(reason);this.name='ReplyError';this.reason=reason;}
}
export function extractJson(text:string):unknown{
 const fenced=/```(?:json)?\s*(\{[\s\S]*\})\s*```/.exec(text);
 const candidate=fenced?fenced[1]!:text.slice(text.indexOf('{'),text.lastIndexOf('}')+1);
 if(!candidate||text.indexOf('{')<0)throw new ReplyError('no_json');
 try{return JSON.parse(candidate);}catch{throw new ReplyError('no_json');}
}
const trimmed=(value:unknown)=>typeof value==='string'?value.trim():'';
const record=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
function listOf(reply:unknown,key:'products'|'changes'):unknown[]{
 const list=record(reply)?.[key];if(!Array.isArray(list))throw new ReplyError('shape');return list;
}
function corrections(value:unknown,enabled:readonly string[]):ItemResult['corrections']{
 const out:ItemResult['corrections']=[];
 for(const raw of Array.isArray(value)?value:[]){
  if(out.length===10)break;
  const c=record(raw);if(!c)continue;
  const field=c.field,wrong=trimmed(c.wrong),right=trimmed(c.right);
  if(typeof field==='string'&&(field==='internal'||enabled.includes(field))&&wrong&&right&&wrong.length<=500&&right.length<=500&&wrong!==right)out.push({field,wrong,right});
 }
 return out;
}
export function checkFirstPass(job:ParsedJob,batch:readonly JobItem[],text:string):ItemResult[]{
 const ids=batchIds(batch),known=new Set(ids),byId=new Map<string,Record<string,unknown>>();
 for(const raw of listOf(extractJson(text),'products')){
  const entry=record(raw),id=entry?.id;
  if(!entry||typeof id!=='string'||!known.has(id))continue;
  if(byId.has(id))throw new ReplyError('duplicate');
  byId.set(id,entry);
 }
 return batch.flatMap((item,i):ItemResult[]=>{
  if(!item.missing.length)return [];
  const entry=byId.get(ids[i]!);
  if(!entry)throw new ReplyError('missing');
  const fixes=corrections(entry.corrections,job.languages.enabled);
  if(entry.placeholder===true)return [{ref:item.ref,names:{},placeholder:true,corrections:fixes}];
  const names:Record<string,string>={};
  for(const lang of item.missing){const name=trimmed(entry[lang]);if(!name||name.length>500)throw new ReplyError('empty');names[lang]=name;}
  return [{ref:item.ref,names,placeholder:false,corrections:fixes}];
 });
}
export function mergeReview(_job:ParsedJob,batch:readonly JobItem[],first:readonly ItemResult[],text:string){
 const changes=listOf(extractJson(text),'changes'),ids=batchIds(batch),items=new Map(batch.map((item,i)=>[ids[i]!,item]));
 const results=first.map(r=>({...r,names:{...r.names},corrections:r.corrections.map(c=>({...c}))}));
 const byRef=new Map(results.map(r=>[r.ref,r])),seen=new Set<string>();
 let applied=0,dropped=0;
 for(const raw of changes){
  const c=record(raw)??{},item=typeof c.id==='string'?items.get(c.id):undefined,result=item?byRef.get(item.ref):undefined;
  const lang=c.language,name=trimmed(c.name),key=`${String(c.id)}\u001f${String(lang)}`;
  if(!item||!result||result.placeholder||typeof lang!=='string'||!item.missing.includes(lang)||lang in item.existing||!name||name.length>500||seen.has(key)){dropped++;continue;}
  seen.add(key);result.names[lang]=name;applied++;
 }
 return {results,applied,dropped};
}
```

`mergeReview`'s rules do not read the job today; the parameter (named `_job`, as `noUnusedParameters` in the root `tsconfig.json` requires) keeps the two checks' signatures alike.

Add to `src/index.ts`:

```ts
export {batchIds,firstPassInput,firstPassInstructions,reviewInput,reviewInstructions} from './prompt.ts';
export {checkFirstPass,extractJson,mergeReview,ReplyError} from './reply.ts';
```

- [ ] **Step 5: Run both files and watch them pass.** `pnpm --dir packages/translation exec node --test test/prompt.test.ts test/reply.test.ts`; expected: 9 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/translation
git commit -s -m "Assemble the first-pass and review prompts from the job's country and languages, check model replies, and merge review changes only where the venue's own names stay untouched"
```

---

### Task 6: The OpenAI client and the fake OpenAI server

**Files:**
- Create: `packages/translation/src/openai-client.ts`, `test/fake-openai.ts`, `test/openai-client.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `translationModel` (Task 3).
- Produces:
  - `export interface ModelCall {instructions:string;input:string;effort:'low'|'medium'}`
  - `export interface ModelReply {text:string;inputTokens:number;outputTokens:number}`
  - `export interface ModelClient {readonly provider:'openai';readonly model:string;respond(call:ModelCall,signal?:AbortSignal):Promise<ModelReply>}`
  - `export class ProviderError extends Error {readonly kind:'timeout'|'network'|'rate_limited'|'server'|'refused'|'redirect'|'malformed';readonly retryable:boolean;readonly retryAfterMs:number|undefined;readonly usage:{inputTokens:number;outputTokens:number}|undefined}` — `usage` is set when a 200 reply carried token counts but was not a completed reply, because OpenAI bills those tokens.
  - `export function createOpenAiClient(options:{apiKey:string;baseUrl?:string;timeoutMs?:number;maxResponseBytes?:number}):ModelClient` — defaults `https://api.openai.com/v1`, 120,000 ms, 4 MiB.
  - `export function openAiBaseUrl(env:NodeJS.ProcessEnv):string` — reads `CLOUD_OPENAI_BASE_URL` (introduced by this plan, for the fake server in process tests and local runs); accepts only `https:`, or `http:` on `127.0.0.1`/`localhost`, with no user name, password, query or fragment; unset or empty means the default.
  - `test/fake-openai.ts`: `startFakeOpenAi(handler:(r:FakeRequest)=>FakeReply|Promise<FakeReply>):Promise<{baseUrl:string;requests:FakeRequest[];close():Promise<void>}>`, `responsesBody(text:string,usage?:{input_tokens:number;output_tokens:number})`, `echoFirstPass(r:FakeRequest,usage?):FakeReply` (writes `"<internal> [<lang>]"` for every language key named in the instructions' JSON shape, for every row in the input), `emptyReview(usage?):FakeReply`, `isReview(r:FakeRequest):boolean`. `FakeRequest={path:string;headers:IncomingHttpHeaders;body:{model:string;instructions:string;input:string;reasoning:{effort:string};store:boolean}}`; `FakeReply={status?:number;headers?:Record<string,string>;json?:unknown;raw?:string;delayMs?:number}`.

- [ ] **Step 1: Write the fake server**

`test/fake-openai.ts`. `responsesBody` returns the Responses API shape the trial read (`call_openai` in `trial.py`).

```ts
import {once} from 'node:events';
import {createServer,type IncomingHttpHeaders} from 'node:http';
export interface FakeRequest {path:string;headers:IncomingHttpHeaders;body:{model:string;instructions:string;input:string;reasoning:{effort:string};store:boolean}}
export interface FakeReply {status?:number;headers?:Record<string,string>;json?:unknown;raw?:string;delayMs?:number}
type Usage={input_tokens:number;output_tokens:number};
export function responsesBody(text:string,usage:Usage={input_tokens:100,output_tokens:50}){
 return {id:'resp_test',status:'completed',model:'gpt-6-luna',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{...usage,output_tokens_details:{reasoning_tokens:0}}};
}
export const isReview=(r:FakeRequest)=>r.body.instructions.startsWith('You review');
export function echoFirstPass(r:FakeRequest,usage?:Usage):FakeReply{
 const shape=/\{"products": \[\{"id": "p01", (.*?), "placeholder"/.exec(r.body.instructions)?.[1]??'';
 const langs=[...shape.matchAll(/"([^"]+)": "\.\.\."/g)].map(m=>m[1]!);
 const rows=JSON.parse(r.body.input.slice(r.body.input.indexOf('Products:\n')+'Products:\n'.length)) as {id:string;internal:string}[];
 const products=rows.map(row=>({id:row.id,...Object.fromEntries(langs.map(l=>[l,`${row.internal} [${l}]`])),placeholder:false,corrections:[]}));
 return {json:responsesBody(JSON.stringify({products}),usage)};
}
export function emptyReview(usage?:Usage):FakeReply{return {json:responsesBody('{"changes": []}',usage)};}
export async function startFakeOpenAi(handler:(r:FakeRequest)=>FakeReply|Promise<FakeReply>){
 const requests:FakeRequest[]=[];
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);
  const r:FakeRequest={path:req.url??'',headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
  requests.push(r);
  let reply:FakeReply;try{reply=await handler(r);}catch{reply={status:500,json:{error:'fake handler failed'}};}
  if(reply.delayMs)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,reply.delayMs);res.once('close',()=>{clearTimeout(timer);resolve();});});
  if(res.destroyed)return;
  res.writeHead(reply.status??200,{'content-type':'application/json',...reply.headers});
  res.end(reply.raw??(reply.json===undefined?'':JSON.stringify(reply.json)));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();if(!address||typeof address==='string')throw new Error('fake server address');
 return {baseUrl:`http://127.0.0.1:${address.port}`,requests,async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
```

- [ ] **Step 2: Write the failing client tests**

`test/openai-client.test.ts`:

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOpenAiClient,openAiBaseUrl,ProviderError} from '../src/index.ts';
import {responsesBody,startFakeOpenAi,type FakeReply} from './fake-openai.ts';
const call={instructions:'I',input:'U',effort:'low'} as const;
async function failure(reply:FakeReply,options:{timeoutMs?:number;maxResponseBytes?:number}={},signal?:AbortSignal):Promise<ProviderError>{
 const fake=await startFakeOpenAi(()=>reply);
 try{
  const error=await createOpenAiClient({apiKey:'sk-test-key',baseUrl:fake.baseUrl,...options}).respond(call,signal).then(()=>undefined,(e:unknown)=>e);
  assert.ok(error instanceof ProviderError,String(error));return error;
 }finally{await fake.close();}
}
test('a request carries the pinned model, the effort, store false and the key, and returns text and tokens',async()=>{
 const fake=await startFakeOpenAi(()=>({json:responsesBody('{"products":[]}',{input_tokens:1200,output_tokens:340})}));
 try{
  const client=createOpenAiClient({apiKey:'sk-test-key',baseUrl:fake.baseUrl});
  assert.deepEqual(await client.respond(call),{text:'{"products":[]}',inputTokens:1200,outputTokens:340});
  const r=fake.requests[0]!;
  assert.equal(r.path,'/responses');assert.equal(r.headers.authorization,'Bearer sk-test-key');
  assert.deepEqual(r.body,{model:'gpt-6-luna',instructions:'I',input:'U',reasoning:{effort:'low'},store:false});
 }finally{await fake.close();}
});
test('a slow reply times out as a retryable timeout',async()=>{
 const e=await failure({delayMs:500,json:responsesBody('x')},{timeoutMs:100});
 assert.deepEqual([e.kind,e.retryable],['timeout',true]);
});
test("a caller's abort is reported as a network error",async()=>{
 const controller=new AbortController();setTimeout(()=>controller.abort(),50);
 const e=await failure({delayMs:2000,json:responsesBody('x')},{},controller.signal);
 assert.equal(e.kind,'network');
});
test('a server that is not there is a retryable network error',async()=>{
 const fake=await startFakeOpenAi(()=>({json:responsesBody('x')}));await fake.close();
 const e=await createOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}).respond(call).then(()=>undefined,(error:unknown)=>error);
 assert.ok(e instanceof ProviderError);assert.deepEqual([e.kind,e.retryable],['network',true]);
});
test('a 429 carries Retry-After in milliseconds, read as seconds or as a date and capped at 60 seconds',async()=>{
 assert.equal((await failure({status:429,headers:{'retry-after':'3'}})).retryAfterMs,3000);
 assert.equal((await failure({status:429,headers:{'retry-after':'120'}})).retryAfterMs,60000);
 const dated=(await failure({status:429,headers:{'retry-after':new Date(Date.now()+5000).toUTCString()}})).retryAfterMs;
 assert.ok(dated!==undefined&&dated>3000&&dated<=5000,String(dated));
 const plain=await failure({status:429});
 assert.deepEqual([plain.kind,plain.retryable,plain.retryAfterMs],['rate_limited',true,undefined]);
});
test('server errors retry, other refusals do not',async()=>{
 for(const status of [500,503]){const e=await failure({status});assert.deepEqual([e.kind,e.retryable],['server',true]);}
 for(const status of [400,401,403]){const e=await failure({status});assert.deepEqual([e.kind,e.retryable],['refused',false]);}
});
test('a redirect is refused and never followed',async()=>{
 let followed=0;const target=await startFakeOpenAi(()=>{followed++;return {json:responsesBody('x')};});
 const fake=await startFakeOpenAi(()=>({status:307,headers:{location:target.baseUrl+'/responses'}}));
 try{await assert.rejects(createOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}).respond(call),(e:unknown)=>e instanceof ProviderError&&e.kind==='redirect'&&!e.retryable);assert.equal(followed,0);}
 finally{await fake.close();await target.close();}
});
test('a body that is not the Responses shape, an incomplete reply or an oversized body is malformed and retryable',async()=>{
 const cases:[FakeReply,{maxResponseBytes?:number}][]=[[{raw:'not json'},{}],[{json:{...responsesBody('x'),status:'incomplete'}},{}],
  [{json:{...responsesBody('x'),usage:{input_tokens:-1,output_tokens:1}}},{}],[{raw:'x'.repeat(2000)},{maxResponseBytes:1000}]];
 for(const [reply,options] of cases){const e=await failure(reply,options);assert.deepEqual([e.kind,e.retryable],['malformed',true]);}
});
test('an incomplete reply still reports the tokens it was billed for',async()=>{
 const e=await failure({json:{...responsesBody('x',{input_tokens:900,output_tokens:4000}),status:'incomplete'}});
 assert.deepEqual(e.usage,{inputTokens:900,outputTokens:4000});
});
test('the error message never carries the reply or the key',async()=>{
 const e=await failure({status:401,raw:'sk-test-key PRIVATE-NAME'});
 for(const text of [String(e),e.message,e.stack??''])for(const secret of ['sk-test-key','PRIVATE-NAME'])assert.equal(text.includes(secret),false,secret);
});
test('the base URL setting accepts https and loopback http only',()=>{
 assert.equal(openAiBaseUrl({}),'https://api.openai.com/v1');assert.equal(openAiBaseUrl({CLOUD_OPENAI_BASE_URL:''}),'https://api.openai.com/v1');
 assert.equal(openAiBaseUrl({CLOUD_OPENAI_BASE_URL:'http://127.0.0.1:4010/v1'}),'http://127.0.0.1:4010/v1');
 for(const bad of ['http://example.test/v1','ftp://127.0.0.1/','https://user:pw@api.test/v1','https://api.test/v1?x=1','not a url'])assert.throws(()=>openAiBaseUrl({CLOUD_OPENAI_BASE_URL:bad}));
});
```

- [ ] **Step 3: Run them and watch them fail** — `pnpm --dir packages/translation exec node --test test/openai-client.test.ts`; expected: FAIL, missing exports.

- [ ] **Step 4: Implement the client**

`src/openai-client.ts`. `redirect:'manual'` returns a 3xx response unfollowed (Node's `fetch` follows by default), which the redirect test proves. A timeout raises a `DOMException` named `TimeoutError` from `AbortSignal.timeout`; anything else that stops the request, a caller's abort included, is `network`, and the batch runner checks its own signal before it reads the kind (Task 7). `Retry-After` is capped at 60 seconds, as the spec states ("The worker", step 6). Nothing in this file calls `console`.

```ts
import {translationModel} from './service.ts';
export interface ModelCall {instructions:string;input:string;effort:'low'|'medium'}
export interface ModelReply {text:string;inputTokens:number;outputTokens:number}
export interface ModelClient {readonly provider:'openai';readonly model:string;respond(call:ModelCall,signal?:AbortSignal):Promise<ModelReply>}
type Usage={inputTokens:number;outputTokens:number};
export class ProviderError extends Error {
 readonly kind:'timeout'|'network'|'rate_limited'|'server'|'refused'|'redirect'|'malformed';
 readonly retryable:boolean;readonly retryAfterMs:number|undefined;readonly usage:Usage|undefined;
 constructor(kind:ProviderError['kind'],retryAfterMs?:number,usage?:Usage){
  super(kind);this.name='ProviderError';this.kind=kind;this.retryable=kind!=='refused'&&kind!=='redirect';this.retryAfterMs=retryAfterMs;this.usage=usage;
 }
}
const defaultBaseUrl='https://api.openai.com/v1';
export function openAiBaseUrl(env:NodeJS.ProcessEnv):string{
 const value=env.CLOUD_OPENAI_BASE_URL;
 if(value===undefined||value==='')return defaultBaseUrl;
 let url:URL;try{url=new URL(value);}catch{throw new Error('invalid_openai_base_url');}
 const loopback=url.protocol==='http:'&&(url.hostname==='127.0.0.1'||url.hostname==='localhost');
 if((url.protocol!=='https:'&&!loopback)||url.username||url.password||url.search||url.hash)throw new Error('invalid_openai_base_url');
 return value.replace(/\/$/,'');
}
function retryAfter(value:string|null):number|undefined{
 if(value===null)return undefined;
 const text=value.trim(),ms=/^\d+$/.test(text)?Number(text)*1000:Date.parse(text)-Date.now();
 return Number.isFinite(ms)?Math.min(60000,Math.max(0,ms)):undefined;
}
function stopped(error:unknown):ProviderError{
 if(error instanceof ProviderError)return error;
 return new ProviderError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'network');
}
async function bounded(response:Response,max:number):Promise<string>{
 const reader=response.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){
  const {done,value}=await reader.read();if(done)break;
  size+=value.byteLength;if(size>max){await reader.cancel();throw new ProviderError('malformed');}
  chunks.push(value);
 }
 return Buffer.concat(chunks).toString('utf8');
}
const record=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
function parseResponses(text:string):ModelReply{
 let data:Record<string,unknown>|undefined;try{data=record(JSON.parse(text));}catch{throw new ProviderError('malformed');}
 const usage=record(data?.usage),inputTokens=usage?.input_tokens,outputTokens=usage?.output_tokens;
 const counted=Number.isSafeInteger(inputTokens)&&Number.isSafeInteger(outputTokens)&&Number(inputTokens)>=0&&Number(outputTokens)>=0;
 const tokens=counted?{inputTokens:Number(inputTokens),outputTokens:Number(outputTokens)}:undefined;
 if(!data||!tokens||!Array.isArray(data.output))throw new ProviderError('malformed');
 if(data.status!=='completed')throw new ProviderError('malformed',undefined,tokens);
 const reply=data.output.flatMap(item=>{const message=record(item);return message?.type==='message'&&Array.isArray(message.content)?message.content:[];})
  .flatMap(part=>{const content=record(part);return content?.type==='output_text'&&typeof content.text==='string'?[content.text]:[];}).join('');
 return {text:reply,...tokens};
}
export function createOpenAiClient(options:{apiKey:string;baseUrl?:string;timeoutMs?:number;maxResponseBytes?:number}):ModelClient{
 const base=(options.baseUrl??defaultBaseUrl).replace(/\/$/,''),timeout=options.timeoutMs??120000,max=options.maxResponseBytes??4194304;
 return {provider:'openai',model:translationModel,async respond(call,signal){
  const combined=AbortSignal.any([AbortSignal.timeout(timeout),...(signal?[signal]:[])]);
  let response:Response;
  try{response=await fetch(base+'/responses',{method:'POST',redirect:'manual',signal:combined,
   headers:{authorization:`Bearer ${options.apiKey}`,'content-type':'application/json'},
   body:JSON.stringify({model:translationModel,instructions:call.instructions,input:call.input,reasoning:{effort:call.effort},store:false})});}
  catch(error){throw stopped(error);}
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ProviderError('redirect');}
  let text:string;try{text=await bounded(response,max);}catch(error){throw stopped(error);}
  if(response.status===429)throw new ProviderError('rate_limited',retryAfter(response.headers.get('retry-after')));
  if(response.status>=500)throw new ProviderError('server',retryAfter(response.headers.get('retry-after')));
  if(response.status!==200)throw new ProviderError('refused');
  return parseResponses(text);
 }};
}
```

Add to `src/index.ts`:

```ts
export {createOpenAiClient,openAiBaseUrl,ProviderError,type ModelCall,type ModelClient,type ModelReply} from './openai-client.ts';
```

- [ ] **Step 5: Run the tests and watch them pass.** Same command; expected: 11 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/translation
git commit -s -m "Call OpenAI's Responses API with the pinned model, store false, a 120-second limit and redirects refused, tested through the real HTTP client against a local fake server"
```

---

### Task 7: The batch runner — retries, the review pass, the cap hooks and aborts

**Files:**
- Create: `packages/translation/src/batch-runner.ts`, `test/batch-runner.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `ModelClient`, `ProviderError` (Task 6); prompt and reply functions, `ReplyError` (Task 5); `ParsedJob`, `JobItem`, `parseJob` (Task 4); `ItemResult` (Task 3); the fake server (Task 6).
- Produces:
  - `export const retryWaitsMs=[2000,8000,30000] as const;`
  - `export interface BatchHooks {mayCall():Promise<boolean>;spent(usage:{inputTokens:number;outputTokens:number}):Promise<void>;attempted():Promise<void>;wait(ms:number,signal:AbortSignal):Promise<void>}`
  - `export type BatchOutcome={kind:'done';results:ItemResult[];reviewApplied:number;reviewDropped:number;reviewFailed:boolean}|{kind:'failed';reason:'provider_unavailable'|'cap_reached'}|{kind:'aborted'}`
  - `export async function translateBatch(job:ParsedJob,batch:readonly JobItem[],client:ModelClient,hooks:BatchHooks,signal:AbortSignal):Promise<BatchOutcome>`

The retry rule, from the spec: one call, then up to three retries waiting 2 s, 8 s and 30 s, so four calls at most per pass. A provider `Retry-After` replaces the scheduled wait. A refusal (`refused`, `redirect`) ends the pass at once. A reply that fails `checkFirstPass` or `mergeReview` is retried like a provider failure. `hooks.attempted()` runs after every call, success or failure, so the worker can renew its lease (Task 8). `hooks.spent()` runs for every reply that carried token counts, whether or not its text passed the check and whether or not it was a completed reply, because OpenAI bills it. `hooks.mayCall()` runs before every call; `false` stops the batch (`cap_reached`) if the first pass has not finished, or skips the review (keeping first-pass names) if it has.

**An abort is not a result.** If `signal` aborts during either pass, `translateBatch` returns `{kind:'aborted'}`: never `failed` with `provider_unavailable`, and never a `done` holding only first-pass names. The worker saves nothing for an aborted batch (Task 8), so a restart runs it again.

- [ ] **Step 1: Write the failing tests against the fake server**

`test/batch-runner.test.ts`. The hooks record waits and spend without sleeping; the client gives up after 100 ms unless a test says otherwise.

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOpenAiClient,parseJob,translateBatch,type BatchHooks,type ModelClient} from '../src/index.ts';
import {echoFirstPass,emptyReview,isReview,responsesBody,startFakeOpenAi,type FakeReply,type FakeRequest} from './fake-openai.ts';
const job=parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},
 items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR TAPAS',staffName:'GUILDAS',existing:{},missing:['ca','es','en']},
  {ref:'variant:2',kind:'variant',family:'product:1',category:'BAR TAPAS',staffName:'DOBLE',existing:{en:'Double'},missing:['ca','es']}],houseStyle:[]}));
const echoed=[{ca:'GUILDAS [ca]',es:'GUILDAS [es]',en:'GUILDAS [en]'},{ca:'DOBLE [ca]',es:'DOBLE [es]'}];
function hooksFor(allow:()=>boolean=()=>true){
 const waits:number[]=[],spent:number[]=[];
 const hooks:BatchHooks={mayCall:async()=>allow(),spent:async u=>{spent.push(u.inputTokens+u.outputTokens);},attempted:async()=>{},wait:async ms=>{waits.push(ms);}};
 return {waits,spent,hooks};
}
async function withFake(handler:(r:FakeRequest)=>FakeReply|Promise<FakeReply>,run:(client:ModelClient,fake:Awaited<ReturnType<typeof startFakeOpenAi>>)=>Promise<void>,timeoutMs=100){
 const fake=await startFakeOpenAi(handler);
 try{await run(createOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl,timeoutMs}),fake);}finally{await fake.close();}
}
const live=()=>new AbortController().signal;
test('a timeout, malformed JSON and a missing product each retry, then the batch succeeds',async()=>{
 const failures:FakeReply[]=[{delayMs:500,json:{}},{json:responsesBody('no json here')},{json:responsesBody('{"products":[]}')}];
 await withFake(r=>isReview(r)?emptyReview():failures.shift()??echoFirstPass(r),async(client,fake)=>{
  const {waits,hooks}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.equal(outcome.kind,'done');assert.deepEqual(waits,[2000,8000,30000]);
  assert.equal(fake.requests.filter(r=>r.body.reasoning.effort==='low').length,4);
  assert.equal(fake.requests.filter(r=>r.body.reasoning.effort==='medium').length,1);
 });
});
test('a 429 with Retry-After waits what the provider asked, then succeeds',async()=>{
 let first=true;
 await withFake(r=>{if(isReview(r))return emptyReview();if(first){first=false;return {status:429,headers:{'retry-after':'7'}};}return echoFirstPass(r);},async client=>{
  const {waits,hooks}=hooksFor();
  assert.equal((await translateBatch(job,job.items,client,hooks,live())).kind,'done');assert.deepEqual(waits,[7000]);
 });
});
for(const [name,reply] of [['timeout',{delayMs:500,json:{}}],['malformed JSON',{json:responsesBody('no json here')}],['missing product',{json:responsesBody('{"products":[]}')}],['429',{status:429}]] as [string,FakeReply][])
 test(`four ${name} replies fail the batch without a review`,async()=>{
  await withFake(()=>reply,async(client,fake)=>{
   const {waits,hooks}=hooksFor();
   assert.deepEqual(await translateBatch(job,job.items,client,hooks,live()),{kind:'failed',reason:'provider_unavailable'});
   assert.equal(fake.requests.length,4);assert.equal(fake.requests.filter(isReview).length,0);assert.deepEqual(waits,[2000,8000,30000]);
  });
 });
test('a refusal ends the pass after one call',async()=>{
 await withFake(()=>({status:401}),async(client,fake)=>{
  const {waits,hooks}=hooksFor();
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,live()),{kind:'failed',reason:'provider_unavailable'});
  assert.equal(fake.requests.length,1);assert.deepEqual(waits,[]);
 });
});
test('a review that always times out keeps the first-pass names',async()=>{
 await withFake(r=>isReview(r)?{delayMs:500,json:{}}:echoFirstPass(r),async(client,fake)=>{
  const {hooks}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.ok(outcome.kind==='done');assert.equal(outcome.reviewFailed,true);
  assert.deepEqual(outcome.results.map(r=>r.names),echoed);
  assert.equal(fake.requests.filter(isReview).length,4);
 });
});
test('the review applies an allowed change and drops one for a language the venue entered',async()=>{
 const review={json:responsesBody(JSON.stringify({changes:[{id:'p02',language:'en',name:'Not allowed'},{id:'p02',language:'ca',name:'Doble (cervesa)'}]}))};
 await withFake(r=>isReview(r)?review:echoFirstPass(r),async client=>{
  const {hooks}=hooksFor(),outcome=await translateBatch(job,job.items,client,hooks,live());
  assert.ok(outcome.kind==='done');
  assert.deepEqual([outcome.reviewApplied,outcome.reviewDropped,outcome.reviewFailed],[1,1,false]);
  assert.deepEqual(outcome.results[1]!.names,{ca:'Doble (cervesa)',es:'DOBLE [es]'});
 });
});
test('the cap stops a batch before its first call, and skips the review once the first pass is done',async()=>{
 await withFake(r=>isReview(r)?emptyReview():echoFirstPass(r),async(client,fake)=>{
  assert.deepEqual(await translateBatch(job,job.items,client,hooksFor(()=>false).hooks,live()),{kind:'failed',reason:'cap_reached'});
  assert.equal(fake.requests.length,0);
  let calls=0;const outcome=await translateBatch(job,job.items,client,hooksFor(()=>calls++===0).hooks,live());
  assert.ok(outcome.kind==='done');assert.equal(outcome.reviewFailed,false);assert.deepEqual(outcome.results.map(r=>r.names),echoed);
  assert.equal(fake.requests.filter(isReview).length,0);
 });
});
test('tokens are counted for a reply whose text fails the check and for an incomplete reply',async()=>{
 const replies:FakeReply[]=[{json:responsesBody('no json here',{input_tokens:10,output_tokens:5})},{json:{...responsesBody('x',{input_tokens:7,output_tokens:3}),status:'incomplete'}}];
 await withFake(r=>isReview(r)?emptyReview({input_tokens:1,output_tokens:1}):replies.shift()??echoFirstPass(r,{input_tokens:2,output_tokens:2}),async client=>{
  const {spent,hooks}=hooksFor();
  assert.equal((await translateBatch(job,job.items,client,hooks,live())).kind,'done');
  assert.deepEqual(spent,[15,10,4,2]);
 });
});
test('aborting during a first-pass call returns aborted with no wait and no further call',async()=>{
 const controller=new AbortController();
 await withFake(()=>{setTimeout(()=>controller.abort(),50);return {delayMs:2000,json:responsesBody('x')};},async(client,fake)=>{
  const {waits,hooks}=hooksFor();
  assert.deepEqual(await translateBatch(job,job.items,client,hooks,controller.signal),{kind:'aborted'});
  assert.equal(fake.requests.length,1);assert.deepEqual(waits,[]);
 },5000);
});
test('aborting during the review returns aborted, not the first-pass names',async()=>{
 const controller=new AbortController();
 await withFake(r=>{if(!isReview(r))return echoFirstPass(r);setTimeout(()=>controller.abort(),50);return {delayMs:2000,json:{}};},async(client,fake)=>{
  assert.deepEqual(await translateBatch(job,job.items,client,hooksFor().hooks,controller.signal),{kind:'aborted'});
  assert.equal(fake.requests.filter(isReview).length,1);
 },5000);
});
```

- [ ] **Step 2: Run them and watch them fail** — `pnpm --dir packages/translation exec node --test test/batch-runner.test.ts`; expected: FAIL, `translateBatch` is not exported.

- [ ] **Step 3: Implement `translateBatch`**

`src/batch-runner.ts`:

```ts
import type {JobItem,ParsedJob} from './job-body.ts';
import type {ItemResult} from './job-store.ts';
import {ProviderError,type ModelClient,type ModelReply} from './openai-client.ts';
import {firstPassInput,firstPassInstructions,reviewInput,reviewInstructions} from './prompt.ts';
import {checkFirstPass,mergeReview,ReplyError} from './reply.ts';
export const retryWaitsMs=[2000,8000,30000] as const;
export interface BatchHooks {mayCall():Promise<boolean>;spent(usage:{inputTokens:number;outputTokens:number}):Promise<void>;attempted():Promise<void>;wait(ms:number,signal:AbortSignal):Promise<void>}
export type BatchOutcome={kind:'done';results:ItemResult[];reviewApplied:number;reviewDropped:number;reviewFailed:boolean}|{kind:'failed';reason:'provider_unavailable'|'cap_reached'}|{kind:'aborted'};
type Attempt<T>={ok:true;value:T}|{ok:false;stop:'cap'|'gave_up'|'aborted'};
async function withRetries<T>(hooks:BatchHooks,signal:AbortSignal,call:()=>Promise<T>):Promise<Attempt<T>>{
 for(let attempt=0;attempt<=retryWaitsMs.length;attempt++){
  if(signal.aborted)return {ok:false,stop:'aborted'};
  if(!await hooks.mayCall())return {ok:false,stop:'cap'};
  let wait:number|undefined;
  try{const value=await call();await hooks.attempted();return {ok:true,value};}
  catch(error){
   await hooks.attempted();
   if(signal.aborted)return {ok:false,stop:'aborted'};
   if(!(error instanceof ProviderError)&&!(error instanceof ReplyError))throw error;
   if(error instanceof ProviderError&&!error.retryable)return {ok:false,stop:'gave_up'};
   wait=error instanceof ProviderError?error.retryAfterMs:undefined;
  }
  if(attempt===retryWaitsMs.length)break;
  await hooks.wait(wait??retryWaitsMs[attempt]!,signal);
 }
 return {ok:false,stop:'gave_up'};
}
export async function translateBatch(job:ParsedJob,batch:readonly JobItem[],client:ModelClient,hooks:BatchHooks,signal:AbortSignal):Promise<BatchOutcome>{
 const ask=async(instructions:string,input:string,effort:'low'|'medium')=>{
  let reply:ModelReply;
  try{reply=await client.respond({instructions,input,effort},signal);}
  catch(error){if(error instanceof ProviderError&&error.usage)await hooks.spent(error.usage);throw error;}
  await hooks.spent({inputTokens:reply.inputTokens,outputTokens:reply.outputTokens});
  return reply.text;
 };
 const first=await withRetries(hooks,signal,async()=>checkFirstPass(job,batch,await ask(firstPassInstructions(job),firstPassInput(job,batch),'low')));
 if(!first.ok)return first.stop==='aborted'?{kind:'aborted'}:{kind:'failed',reason:first.stop==='cap'?'cap_reached':'provider_unavailable'};
 const input=reviewInput(job,batch,first.value);
 if(!input)return {kind:'done',results:first.value,reviewApplied:0,reviewDropped:0,reviewFailed:false};
 const review=await withRetries(hooks,signal,async()=>mergeReview(job,batch,first.value,await ask(reviewInstructions(job),input,'medium')));
 if(!review.ok){
  if(review.stop==='aborted')return {kind:'aborted'};
  return {kind:'done',results:first.value,reviewApplied:0,reviewDropped:0,reviewFailed:review.stop==='gave_up'};
 }
 return {kind:'done',results:review.value.results,reviewApplied:review.value.applied,reviewDropped:review.value.dropped,reviewFailed:false};
}
```

`ask` calls `hooks.spent` before the reply check runs, which is how the token-counting test passes.

Add to `src/index.ts`:

```ts
export {retryWaitsMs,translateBatch,type BatchHooks,type BatchOutcome} from './batch-runner.ts';
```

- [ ] **Step 4: Run the tests and watch them pass.** Same command; expected: 13 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/translation
git commit -s -m "Run one translation batch: retry failed or unusable replies after 2, 8 and 30 seconds or the provider's Retry-After, keep first-pass names when the review fails, stop at the spending cap, and report an abort as an abort rather than a result"
```

---

### Task 8: The worker — leases, four batches side by side, the cap, finishing and usage events

**Implementation note:** append-only migration `040_translation_result_json.sql` preserves
accepted escaped NUL and lone-surrogate text by storing batch outcomes as JSON. The worker
updates the complete retained batch object under the job row lock and counts its outcomes in
JavaScript; the JSONB update/aggregation snippet below is superseded. The wire shape is unchanged.
Task 17 must re-read the migration inventory; 040 is now used, and 041 is the next candidate.
The worker's abort listener covers loading and exhausted-lease handling too. Both spending and
renewal callback failures are retained when they happen together. The tests in `worker.test.ts`
and `result-storage-upgrade.test.ts` qualify these additions with real PostgreSQL.

> **Authoritative replacement:** [paging amendment, Task 8 row and behavioral checks](2026-10-16-translation-collect-pages.md#implement-inline-with-failing-behavioral-tests-first).
> Collect helpers must walk pages. Prove submit-order results despite reversed batch/completion
> order, and preserve lease, retry, context, cap and usage assertions.

**Files:**
- Create: `packages/translation/src/worker.ts`, `test/worker.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: Tasks 3–7; `recordUsageEvent`, `transaction` from `@waitron-cloud/registration`. Consent is not checked yet; Task 13 adds the check at lease and its test.
- Produces: `export class TranslationWorker {constructor(pool:Pool,client:ModelClient,options?:{batchConcurrency?:number;leaseMs?:number;maxLeases?:number;wait?:BatchHooks['wait']});runOnce(signal:AbortSignal):Promise<boolean>}` — defaults 4, 600,000 ms, 3. `runOnce` returns `false` when there was nothing to lease.

Behaviour of `runOnce`:
1. **Lease** in one transaction: pick the oldest job that is `queued`, or `running` with `lease_until<clock_timestamp()`, `FOR UPDATE SKIP LOCKED`; set `state='running'`, a new `lease_id`, `lease_until=clock_timestamp()+leaseMs`, `lease_count=lease_count+1`, `started_at=COALESCE(started_at,clock_timestamp())`. The cap is not checked here: submit refused an over-cap estimate already (Task 3).
2. **Too many leases.** A job whose `lease_count` after leasing is above `maxLeases` (a worker died on it repeatedly) makes no provider call: every batch not yet saved is saved as failed and the job finishes as in step 5. The contract's reason list has no reason for a worker that keeps dying, so this ends with `provider_failed` (some batches done) or `provider_unavailable` (none).
3. **Load** the body and `batch_results`, `parseJob`, `planBatches`; the batches still to run are those whose index is not a key of `batch_results`.
4. **Run** up to `batchConcurrency` batches at once with `translateBatch`. Hooks: `spent` adds tokens and cost (`ceil((input*input_price+output*output_price)/1,000,000)` micro-dollars, from `translation_prices` for the job's model, in `BigInt`) to the job row, guarded by the lease; `attempted` renews `lease_until`, guarded by the lease; a guarded write that changes no row means the lease was lost and aborts the job's own signal; `mayCall` is `false` once `monthSpend(venue) >= cap`; `wait` is the injected function or `setTimeout` from `node:timers/promises` with the signal. Batches already running when the cap is reached finish; the overshoot is at most those calls (Task 19 states this in the README).
5. **Save each batch as it finishes**, in a transaction guarded by `lease_id`: set `batch_results[index]` to `{results,failed:[]}` (done) or `{results:[],failed:[every ref in the batch with languages to write]}` (failed; a context item is never listed), plus `stoppedByCap:true` when the cap failed it; recompute `done` and `failed` from `batch_results`; add `review_applied`/`review_dropped`. An aborted batch (`kind:'aborted'`, or any outcome that arrives after the job's signal aborted) is not saved.
6. **Finish** when every batch has an entry: `state` is `done` if no item failed, `failed` if every item with languages to write failed, else `partly_done`; the reason is `limit_reached` if any batch was stopped by the cap, else `provider_unavailable` for a `failed` job and `provider_failed` for a `partly_done` one. Set `finished_at`, clear the lease, and in the same transaction record the usage events with `recordUsageEvent`: `translation.items_completed` (quantity `done`), `translation.input_tokens`, `translation.output_tokens`, `translation.cost_micro_usd`, each only when its quantity is above zero, all with `sourceKind:'translation_job'`, `sourceReference:<job id>`, the venue and its organisation, and `occurredAt` the finish time. `usage_events` holds one quantity per row (`025_usage_metering.sql:12`, unit rule `:29`), so a job records up to four events sharing one source reference, as the spec says.
7. **Stop on abort**: if the caller's `signal` aborts, in-flight calls are cancelled, nothing is saved for them, and the lease is handed back (`lease_until=clock_timestamp()`, and `lease_count` reduced by one, so a clean shutdown does not count towards step 2) so the next start resumes at once.

- [ ] **Step 1: Write the failing worker tests**

`test/worker.test.ts` (database plus fake server; `wait` is injected as an immediate resolve, and the client gives up after 100 ms unless a test says otherwise):

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {collectJob,createJob,createOpenAiClient,jobFingerprint,lockVenue,parseJob,readJob,TranslationWorker,writtenItems} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,responsesBody,startFakeOpenAi,type FakeReply} from './fake-openai.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 // Every test leases "the oldest open job", so jobs left open by an earlier test are closed first.
 await db.pool.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE state IN ('queued','running')");
 await db.pool.query('UPDATE translation_policy SET monthly_cap_micro_usd=5000000');
});
type Venue=Awaited<ReturnType<typeof connectedVenue>>;
const item=(ref:string,category:string,staffName:string,over:Record<string,unknown>={})=>({ref,kind:'product',family:ref,category,staffName,existing:{},missing:['ca','es'],...over});
const many=(prefix:string,category:string,n:number,staff=(i:number)=>`${prefix}-${i}`)=>Array.from({length:n},(_,i)=>item(`${prefix}:${i}`,category,staff(i)));
const body=(items:object[])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items,houseStyle:[]});
async function queue(items:object[]):Promise<{v:Venue;job:{id:string}}>{
 const v=await connectedVenue(db,issuer,origin),text=body(items);
 const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);
  return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:writtenItems(parseJob(text)).length});});
 return {v,job};
}
const worker=(baseUrl:string,options:{batchConcurrency?:number;maxLeases?:number}={},timeoutMs=100)=>
 new TranslationWorker(db.pool,createOpenAiClient({apiKey:'k',baseUrl,timeoutMs}),{wait:async()=>{},...options});
const row=async(id:string)=>(await db.pool.query('SELECT *,lease_until<=clock_timestamp() AS lease_free FROM translation_jobs WHERE id=$1',[id])).rows[0];
const saved=async(id:string)=>(await db.pool.query('SELECT batch_results FROM translation_job_bodies WHERE job_id=$1',[id])).rows[0]?.batch_results as Record<string,unknown>|undefined;
const collected=(v:Venue,id:string)=>transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,id)));
const refs=(items:{ref:string}[])=>items.map(i=>i.ref).sort();
const live=()=>new AbortController().signal;
async function until(check:()=>Promise<boolean>|boolean,ms=5000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('condition timed out');await delay(10);}}

for(const [name,failure] of [['a timeout',{delayMs:500,json:{}}],['malformed JSON',{json:responsesBody('no json here')}],['a missing product',{json:responsesBody('{"products":[]}')}],['a 429 with Retry-After',{status:429,headers:{'retry-after':'1'}}]] as [string,FakeReply][])
test(`one batch failing with ${name} ends partly done with provider_failed`,async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():r.body.input.includes('FAIL-')?failure:echoFirstPass(r));
 try{
  const {v,job}=await queue([...many('ok','A',60),...many('bad','B',60,i=>`FAIL-${i}`)]);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),true);
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed],['partly_done','provider_failed',60,60]);
  const result=await collected(v,job.id);
  assert.equal(result.results.length,60);assert.deepEqual(result.failed.sort(),refs(many('bad','B',60)));
 }finally{await fake.close();}
});
test('every batch failing ends failed with provider_unavailable, and collect is refused',async()=>{
 const fake=await startFakeOpenAi(()=>({status:500}));
 try{
  const {v,job}=await queue([...many('a','A',60),...many('b','B',60)]);
  await worker(fake.baseUrl).runOnce(live());
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed],['failed','provider_unavailable',0,120]);
  await assert.rejects(collected(v,job.id),/not_ready/);
  // A 500 carries no token counts, so nothing was billed and no usage is recorded.
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE source_reference=$1',[job.id])).rows[0].n,0);
 }finally{await fake.close();}
});
test('a review that always times out leaves the job done with the first-pass names',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?{delayMs:500,json:{}}:echoFirstPass(r));
 try{
  const {v,job}=await queue(many('p','A',3));
  await worker(fake.baseUrl).runOnce(live());
  assert.equal((await row(job.id)).state,'done');
  assert.deepEqual((await collected(v,job.id)).results.map(r=>r.names),[0,1,2].map(i=>({ca:`p-${i} [ca]`,es:`p-${i} [es]`})));
 }finally{await fake.close();}
});
test('four batches run side by side and a fifth waits for one to finish',async()=>{
 let open=0,peak=0;const waiting:(()=>void)[]=[];
 const fake=await startFakeOpenAi(async r=>{
  if(isReview(r))return emptyReview();
  open++;peak=Math.max(peak,open);
  if(open===4)for(const release of waiting.splice(0))release();
  else if(peak<4)await new Promise<void>(resolve=>waiting.push(resolve));
  open--;return echoFirstPass(r);
 });
 try{
  const {job}=await queue(['A','B','C','D','E'].flatMap(c=>many(c.toLowerCase(),c,60)));
  await worker(fake.baseUrl,{},5000).runOnce(live());
  assert.equal((await row(job.id)).state,'done');assert.equal(peak,4);
  const firstPasses=fake.requests.flatMap((r,i)=>isReview(r)?[]:[i]),firstReview=fake.requests.findIndex(isReview);
  assert.equal(firstPasses.length,5);assert.ok(firstPasses[4]!>firstReview,'the fifth batch started before any batch finished');
 }finally{await fake.close();}
});
test('reaching the cap mid-job stops later batches without calling the provider',async()=>{
 const usage={input_tokens:10000,output_tokens:2000};
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview(usage):echoFirstPass(r,usage));
 try{
  const {v,job}=await queue([...many('a','A',60),...many('b','B',60),...many('c','C',60)]);
  // 10,000 input and 2,000 output tokens cost 1,000 + 1,000 micro-dollars at the seeded prices, so the first call reaches this cap.
  await db.pool.query('UPDATE translation_policy SET monthly_cap_micro_usd=2000');
  await worker(fake.baseUrl,{batchConcurrency:1}).runOnce(live());
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed,ended.cost_micro_usd],['partly_done','limit_reached',60,120,'2000']);
  assert.equal(fake.requests.length,1);
  assert.deepEqual((await collected(v,job.id)).results.slice(0,2).map(r=>r.names),[{ca:'a-0 [ca]',es:'a-0 [es]'},{ca:'a-1 [ca]',es:'a-1 [es]'}]);
 }finally{await fake.close();}
});
test('a finished job records four usage events naming the job and no name',async()=>{
 const usage={input_tokens:1000,output_tokens:200};
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview(usage):echoFirstPass(r,usage));
 try{
  const {job}=await queue(many('SENTINEL-STAFF','A',3));
  await worker(fake.baseUrl).runOnce(live());
  // Two calls of 1,000 in and 200 out: 200 micro-dollars each.
  assert.deepEqual((await db.pool.query(`SELECT event_type,quantity::text,source_kind,source_reference FROM usage_events WHERE source_reference=$1 ORDER BY event_type`,[job.id])).rows,[
   {event_type:'translation.cost_micro_usd',quantity:'400',source_kind:'translation_job',source_reference:job.id},
   {event_type:'translation.input_tokens',quantity:'2000',source_kind:'translation_job',source_reference:job.id},
   {event_type:'translation.items_completed',quantity:'3',source_kind:'translation_job',source_reference:job.id},
   {event_type:'translation.output_tokens',quantity:'400',source_kind:'translation_job',source_reference:job.id}]);
  const stored=JSON.stringify([(await db.pool.query('SELECT * FROM usage_events WHERE source_reference=$1',[job.id])).rows,await row(job.id)]);
  assert.equal(stored.includes('SENTINEL'),false);
 }finally{await fake.close();}
});
test('an abort during a batch saves nothing for it, hands the lease back, and a restart sends only the unfinished batch',async()=>{
 const controller=new AbortController();
 const fake=await startFakeOpenAi(r=>{
  if(isReview(r))return emptyReview();
  if(r.body.input.includes('"b-0"')&&!controller.signal.aborted){controller.abort();return {delayMs:2000,json:{}};}
  return echoFirstPass(r);
 });
 try{
  const {job}=await queue([...many('a','A',60),...many('b','B',60)]);
  const w=worker(fake.baseUrl,{batchConcurrency:1},5000);
  assert.equal(await w.runOnce(controller.signal),true);
  const stopped=await row(job.id);
  assert.deepEqual([stopped.state,stopped.lease_free,stopped.lease_count,stopped.done,stopped.failed],['running',true,0,60,0]);
  assert.deepEqual(Object.keys((await saved(job.id))!),['0']);
  const sentBefore=fake.requests.length;
  assert.equal(await w.runOnce(live()),true);
  assert.equal(fake.requests.slice(sentBefore).some(r=>r.body.input.includes('"a-0"')),false);
  assert.equal((await row(job.id)).state,'done');
 }finally{await fake.close();}
});
test('an abort during the review saves no first-pass-only result',async()=>{
 const controller=new AbortController();
 const fake=await startFakeOpenAi(r=>{if(!isReview(r))return echoFirstPass(r);controller.abort();return {delayMs:2000,json:{}};});
 try{
  const {job}=await queue(many('a','A',3));
  await worker(fake.baseUrl,{},5000).runOnce(controller.signal);
  const stopped=await row(job.id);
  assert.deepEqual([stopped.state,stopped.done,stopped.failed],['running',0,0]);
  assert.deepEqual(await saved(job.id),{});
 }finally{await fake.close();}
});
test("another worker's live lease is respected",async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const fake=await startFakeOpenAi(async r=>{if(isReview(r))return emptyReview();await held;return echoFirstPass(r);});
 try{
  const {job}=await queue(many('a','A',3));
  const first=worker(fake.baseUrl,{},5000).runOnce(live());
  await until(()=>fake.requests.length===1);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),false);
  release();assert.equal(await first,true);assert.equal((await row(job.id)).state,'done');
 }finally{await fake.close();}
});
test('a job leased more than three times ends with its unfinished batches failed and no provider call; a third lease still runs',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 const diedOn=async(leases:number)=>{
  const queued=await queue([...many('a','A',60),...many('b','B',60)]);
  const results=many('a','A',60).map(i=>({ref:i.ref,names:{ca:'x',es:'y'},placeholder:false,corrections:[]}));
  await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[queued.job.id,{0:{results,failed:[]}}]);
  await db.pool.query(`UPDATE translation_jobs SET state='running',lease_id=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second',
   lease_count=$2,done=60,started_at=clock_timestamp() WHERE id=$1`,[queued.job.id,leases]);
  return queued;
 };
 try{
  const {v,job}=await diedOn(3);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),true);
  assert.equal(fake.requests.length,0);
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed,ended.lease_count],['partly_done','provider_failed',60,60,4]);
  assert.deepEqual((await collected(v,job.id)).failed.sort(),refs(many('b','B',60)));
  const third=await diedOn(2);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),true);
  assert.equal((await row(third.job.id)).state,'done');assert.ok(fake.requests.length>0);
 }finally{await fake.close();}
});
test('a context head is sent but never returned or failed',async()=>{
 const head=item('product:9','A','CANYA',{existing:{ca:'Canya',es:'Caña'},missing:[]});
 const variants=[item('variant:1','A','PINTA',{kind:'variant',family:'product:9'}),item('variant:2','A','GERRA',{kind:'variant',family:'product:9'})];
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 const failing=await startFakeOpenAi(()=>({status:500}));
 try{
  const ok=await queue([head,...variants]);
  assert.equal((await row(ok.job.id)).total,2);
  await worker(fake.baseUrl).runOnce(live());
  assert.deepEqual([(await row(ok.job.id)).state,(await row(ok.job.id)).done],['done',2]);
  assert.ok(fake.requests[0]!.body.input.includes('CANYA'));
  const okResult=await collected(ok.v,ok.job.id);
  assert.deepEqual([okResult.results.map(r=>r.ref),okResult.failed],[['variant:1','variant:2'],[]]);
  const bad=await queue([head,...variants]);
  await worker(failing.baseUrl).runOnce(live());
  assert.deepEqual([(await row(bad.job.id)).state,(await row(bad.job.id)).failed],['failed',2]);
  assert.deepEqual(((await saved(bad.job.id)) as Record<string,{failed:string[]}>)['0']!.failed,['variant:1','variant:2']);
 }finally{await fake.close();await failing.close();}
});
```

- [ ] **Step 2: Run them and watch them fail** — `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=30000 test/worker.test.ts`; expected: FAIL, `TranslationWorker` is not exported.

- [ ] **Step 3: Implement `worker.ts`**

Every statement runs on one transaction at a time, and no transaction is held across a provider call.

```ts
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {Pool,PoolClient} from 'pg';
import {recordUsageEvent,transaction} from '@waitron-cloud/registration';
import {translateBatch,type BatchHooks} from './batch-runner.ts';
import {planBatches} from './batching.ts';
import {parseJob,type JobItem} from './job-body.ts';
import {monthSpend,spendingPolicy,type ItemResult,type JobRow} from './job-store.ts';
import type {ModelClient} from './openai-client.ts';
interface StoredBatch {results:ItemResult[];failed:string[];stoppedByCap?:true}
type StoredBatches=Record<string,StoredBatch>;
const failedRefs=(batch:readonly JobItem[])=>batch.filter(item=>item.missing.length>0).map(item=>item.ref);
async function defaultWait(ms:number,signal:AbortSignal){try{await delay(ms,undefined,{signal});}catch{/* an abort ends the wait early */}}
async function recordJobUsage(client:PoolClient,job:JobRow&{finished_at:Date},organisationId:string){
 const occurredAt=job.finished_at.toISOString();
 const measures=[['translation.items_completed',BigInt(job.done)],['translation.input_tokens',BigInt(job.input_tokens)],
  ['translation.output_tokens',BigInt(job.output_tokens)],['translation.cost_micro_usd',BigInt(job.cost_micro_usd)]] as const;
 for(const [type,quantity] of measures)if(quantity>0n)
  await recordUsageEvent(client,{organisationId,venueId:job.venue_id,type,quantity,sourceKind:'translation_job',sourceReference:job.id,occurredAt});
}
export class TranslationWorker {
 readonly #pool:Pool;readonly #client:ModelClient;readonly #concurrency:number;readonly #leaseMs:number;readonly #maxLeases:number;readonly #wait:BatchHooks['wait'];
 constructor(pool:Pool,client:ModelClient,options:{batchConcurrency?:number;leaseMs?:number;maxLeases?:number;wait?:BatchHooks['wait']}={}){
  this.#pool=pool;this.#client=client;this.#concurrency=options.batchConcurrency??4;this.#leaseMs=options.leaseMs??600000;
  this.#maxLeases=options.maxLeases??3;this.#wait=options.wait??defaultWait;
 }
 async runOnce(signal:AbortSignal):Promise<boolean>{
  if(signal.aborted)return false;
  const lease=await this.#lease();
  if(!lease)return false;
  const {job,leaseId}=lease;
  const stored=(await this.#pool.query<{body:string;batch_results:StoredBatches}>('SELECT body,batch_results FROM translation_job_bodies WHERE job_id=$1',[job.id])).rows[0];
  if(!stored)return true;
  const parsed=parseJob(stored.body),batches=planBatches(parsed.items);
  const pending=batches.map((batch,index)=>({batch,index})).filter(({index})=>!(String(index) in stored.batch_results));
  if(job.lease_count>this.#maxLeases){
   for(const {batch,index} of pending)if(!await this.#save(job.id,leaseId,index,{results:[],failed:failedRefs(batch)}))return true;
   await this.#finish(job.id,leaseId,batches.length);return true;
  }
  const local=new AbortController(),stop=()=>local.abort();
  signal.addEventListener('abort',stop,{once:true});
  try{
   const hooks=await this.#hooks(job,leaseId,local);
   const run=async()=>{
    for(let next=pending.shift();next&&!local.signal.aborted;next=pending.shift()){
     const outcome=await translateBatch(parsed,next.batch,this.#client,hooks,local.signal);
     if(local.signal.aborted||outcome.kind==='aborted')return;
     const entry:StoredBatch=outcome.kind==='done'?{results:outcome.results,failed:[]}
      :{results:[],failed:failedRefs(next.batch),...(outcome.reason==='cap_reached'?{stoppedByCap:true as const}:{})};
     if(!await this.#save(job.id,leaseId,next.index,entry,outcome.kind==='done'?outcome:undefined))local.abort();
    }
   };
   const runners=Array.from({length:Math.min(this.#concurrency,pending.length)},()=>run().catch((error:unknown)=>{local.abort();throw error;}));
   const failure=(await Promise.allSettled(runners)).find((s):s is PromiseRejectedResult=>s.status==='rejected');
   if(failure)throw failure.reason;
  }finally{signal.removeEventListener('abort',stop);}
  if(signal.aborted){await this.#handBack(job.id,leaseId);return true;}
  if(local.signal.aborted)return true;
  await this.#finish(job.id,leaseId,batches.length);
  return true;
 }
 async #lease():Promise<{job:JobRow;leaseId:string}|undefined>{
  return transaction(this.#pool,async client=>{
   const candidate=(await client.query<{id:string}>(`SELECT id FROM translation_jobs WHERE state='queued' OR (state='running' AND lease_until<clock_timestamp())
    ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
   if(!candidate)return undefined;
   const leaseId=randomUUID();
   const job=(await client.query<JobRow>(`UPDATE translation_jobs SET state='running',lease_id=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond',
    lease_count=lease_count+1,started_at=COALESCE(started_at,clock_timestamp()) WHERE id=$1 RETURNING *`,[candidate.id,leaseId,this.#leaseMs])).rows[0]!;
   return {job,leaseId};
  });
 }
 async #hooks(job:JobRow,leaseId:string,local:AbortController):Promise<BatchHooks>{
  const price=(await this.#pool.query<{input:string;output:string}>('SELECT input_micro_usd_per_million::text AS input,output_micro_usd_per_million::text AS output FROM translation_prices WHERE model=$1',[job.model])).rows[0];
  if(!price)throw new Error('translation_price_missing');
  const input=BigInt(price.input),output=BigInt(price.output);
  const guarded=async(sql:string,values:unknown[])=>{if((await this.#pool.query(sql,values)).rowCount!==1)local.abort();};
  return {
   mayCall:()=>transaction(this.#pool,async client=>(await monthSpend(client,job.venue_id))<(await spendingPolicy(client)).cap),
   spent:async usage=>{
    const cost=(BigInt(usage.inputTokens)*input+BigInt(usage.outputTokens)*output+999999n)/1000000n;
    await guarded(`UPDATE translation_jobs SET input_tokens=input_tokens+$3,output_tokens=output_tokens+$4,cost_micro_usd=cost_micro_usd+$5
     WHERE id=$1 AND lease_id=$2 AND state='running'`,[job.id,leaseId,usage.inputTokens,usage.outputTokens,cost.toString()]);
   },
   attempted:()=>guarded(`UPDATE translation_jobs SET lease_until=clock_timestamp()+$3*interval '1 millisecond' WHERE id=$1 AND lease_id=$2 AND state='running'`,[job.id,leaseId,this.#leaseMs]),
   wait:this.#wait,
  };
 }
 async #save(jobId:string,leaseId:string,index:number,entry:StoredBatch,review?:{reviewApplied:number;reviewDropped:number}):Promise<boolean>{
  return transaction(this.#pool,async client=>{
   if(!(await client.query("SELECT 1 FROM translation_jobs WHERE id=$1 AND lease_id=$2 AND state='running' FOR UPDATE",[jobId,leaseId])).rowCount)return false;
   await client.query('UPDATE translation_job_bodies SET batch_results=batch_results||jsonb_build_object($2::text,$3::jsonb) WHERE job_id=$1',[jobId,String(index),JSON.stringify(entry)]);
   await client.query(`UPDATE translation_jobs j SET done=c.done,failed=c.failed,review_applied=j.review_applied+$2,review_dropped=j.review_dropped+$3
    FROM (SELECT COALESCE(sum(jsonb_array_length(e.value->'results')),0)::integer AS done,COALESCE(sum(jsonb_array_length(e.value->'failed')),0)::integer AS failed
     FROM translation_job_bodies b CROSS JOIN LATERAL jsonb_each(b.batch_results) e WHERE b.job_id=$1) c WHERE j.id=$1`,[jobId,review?.reviewApplied??0,review?.reviewDropped??0]);
   return true;
  });
 }
 async #finish(jobId:string,leaseId:string,batchCount:number):Promise<void>{
  await transaction(this.#pool,async client=>{
   const row=(await client.query<JobRow&{organisation_id:string;batch_results:StoredBatches}>(`SELECT j.*,v.organisation_id,b.batch_results FROM translation_jobs j
    JOIN venues v ON v.id=j.venue_id JOIN translation_job_bodies b ON b.job_id=j.id WHERE j.id=$1 AND j.lease_id=$2 AND j.state='running' FOR UPDATE OF j`,[jobId,leaseId])).rows[0];
   if(!row)return;
   const entries=Object.values(row.batch_results);
   if(entries.length!==batchCount)return;
   const state=row.failed===0?'done':row.done===0?'failed':'partly_done';
   const reason=state==='done'?null:entries.some(e=>e.stoppedByCap)?'limit_reached':state==='failed'?'provider_unavailable':'provider_failed';
   const finished=(await client.query<JobRow&{finished_at:Date}>(`UPDATE translation_jobs SET state=$2,reason=$3,finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL
    WHERE id=$1 RETURNING *`,[jobId,state,reason])).rows[0]!;
   await recordJobUsage(client,finished,row.organisation_id);
  });
 }
 async #handBack(jobId:string,leaseId:string){
  await this.#pool.query(`UPDATE translation_jobs SET lease_until=clock_timestamp(),lease_count=GREATEST(lease_count-1,0)
   WHERE id=$1 AND lease_id=$2 AND state='running'`,[jobId,leaseId]);
 }
}
```

Add to `src/index.ts`:

```ts
export {TranslationWorker} from './worker.ts';
```

- [ ] **Step 4: Run the tests and watch them pass.** Same command as Step 2; expected: 14 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/translation
git commit -s -m "Run translation jobs in a worker: lease a job, send up to four batches at once, save each batch as it finishes so a restart resumes without paying twice, save nothing for a batch an abort interrupted, stop at the monthly cap, end a job a worker keeps dying on, and record the job's usage when it finishes"
```

---

### Task 9: The worker command

**Files:**
- Create: `packages/translation/src/worker-cli.ts`, `test/worker-cli.test.ts`
- Modify: `packages/translation/package.json` (script `"worker": "node src/worker-cli.ts"`), root `package.json` (script `"translation:worker": "node --env-file-if-exists=.env packages/translation/src/worker-cli.ts"`)

**Interfaces:**
- Consumes: `TranslationWorker` (Task 8); `createOpenAiClient`, `openAiBaseUrl` (Task 6); `migrationNames`, `runWorkerLoop` from `@waitron-cloud/registration`.
- Produces: the command `node packages/translation/src/worker-cli.ts [--once]`, needing `DATABASE_URL` and `CLOUD_OPENAI_API_KEY`, optional `CLOUD_OPENAI_BASE_URL`. A fatal failure prints exactly `Translation worker failed; check database, migrations and provider configuration` once on stderr and exits 1. Recoverable loop-pass errors print `Translation worker pass failed; retrying`. After module loading installs the handlers, SIGTERM or SIGINT stops it with exit 0 if cleanup succeeds; a failed lease return exits 1. Task 18 adds the retention sweep to it.

- [x] **Step 1: Write the failing command tests**

`test/worker-cli.test.ts` spawns the command the way `packages/account-http/test/server.test.ts:133-147` spawns the account server:

```ts
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createJob,jobFingerprint,lockVenue,parseJob,writtenItems} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from './fake-openai.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const failed='Translation worker failed; check database, migrations and provider configuration\n';
before(async()=>{db=await database();});after(async()=>db?.close());
function command(args:string[],overrides:NodeJS.ProcessEnv={}){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
 const child=spawn(process.execPath,[new URL('../src/worker-cli.ts',import.meta.url).pathname,...args],{env:{...process.env,
  DATABASE_URL:url.href,CLOUD_OPENAI_API_KEY:'sk-private-cli-key',CLOUD_OPENAI_BASE_URL:'',...overrides},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);
 const exited=once(child,'exit').then(([code,signal])=>{clearTimeout(deadline);return {code,signal,stdout,stderr};});
 return {child,exited};
}
async function queue(){
 const v=await connectedVenue(db,issuer,origin);
 const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']}],houseStyle:[]});
 return transaction(db.pool,async c=>{await lockVenue(c,v.venueId);
  return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:writtenItems(parseJob(text)).length});});
}
async function until(check:()=>boolean,ms=10000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('condition timed out');await delay(20);}}
test('bad settings exit 1 with one fixed line and no private value',async()=>{
 const cases:[string[],NodeJS.ProcessEnv][]=[[['--once'],{CLOUD_OPENAI_API_KEY:''}],[['--once'],{CLOUD_OPENAI_BASE_URL:'http://private-host.example/v1'}],
  [['--private-flag'],{}],[['--once','--once'],{}],[['--once'],{DATABASE_URL:''}]];
 for(const [args,env] of cases){
  const out=await command(args,env).exited;
  assert.equal(out.code,1,JSON.stringify(args));assert.equal(out.stdout,'');assert.equal(out.stderr,failed);
  for(const secret of ['sk-private-cli-key','private-host','private-flag'])assert.equal((out.stdout+out.stderr).includes(secret),false,secret);
 }
});
test('a schema missing a migration exits 1 with the fixed line',async()=>{
 const saved=(await db.pool.query("DELETE FROM schema_migrations WHERE name='039_translation_jobs.sql' RETURNING *")).rows[0];
 try{const out=await command(['--once']).exited;assert.equal(out.code,1);assert.equal(out.stderr,failed);}
 finally{await db.pool.query('INSERT INTO schema_migrations(name,digest,applied_at) VALUES($1,$2,$3)',[saved.name,saved.digest,saved.applied_at]);}
});
test('--once runs a queued job to the end and prints nothing',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const job=await queue(),out=await command(['--once'],{CLOUD_OPENAI_BASE_URL:fake.baseUrl}).exited;
  assert.deepEqual([out.code,out.stdout,out.stderr],[0,'','']);
  assert.equal((await db.pool.query('SELECT state FROM translation_jobs WHERE id=$1',[job.id])).rows[0].state,'done');
 }finally{await fake.close();}
});
test('SIGTERM during a provider call exits 0, saves nothing and hands the lease back',async()=>{
 const fake=await startFakeOpenAi(()=>new Promise(()=>{}));
 try{
  const job=await queue(),run=command([],{CLOUD_OPENAI_BASE_URL:fake.baseUrl});
  await until(()=>fake.requests.length===1);
  run.child.kill('SIGTERM');
  const out=await run.exited;
  assert.deepEqual([out.code,out.stdout,out.stderr],[0,'','']);
  assert.deepEqual((await db.pool.query(`SELECT j.state,j.lease_count,j.lease_until<=clock_timestamp() AS free,b.batch_results
   FROM translation_jobs j JOIN translation_job_bodies b ON b.job_id=j.id WHERE j.id=$1`,[job.id])).rows,[{state:'running',lease_count:0,free:true,batch_results:{}}]);
 }finally{await fake.close();}
});
```

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=60000 test/worker-cli.test.ts` and watch it fail (the command does not exist).

- [x] **Step 2: Write `src/worker-cli.ts`**

Shaped like `packages/registration/src/email-worker-cli.ts`:

```ts
import {validateHeaderValue} from 'node:http';
import {Pool} from 'pg';
import {migrationNames,runWorkerLoop} from '@waitron-cloud/registration';
import {createOpenAiClient,openAiBaseUrl} from './openai-client.ts';
import {TranslationWorker} from './worker.ts';
let pool:Pool|undefined;
let failed=false;
const stop=new AbortController(),shutdown=()=>stop.abort(),jobConcurrency=2;
function fail(){
 if(!failed){console.error('Translation worker failed; check database, migrations and provider configuration');failed=true;}
 process.exitCode=1;stop.abort();
}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
try{
 const args=process.argv.slice(2);
 if(args.length>1||(args.length===1&&args[0]!=='--once')||!process.env.DATABASE_URL||!process.env.CLOUD_OPENAI_API_KEY?.trim())throw Error();
 validateHeaderValue('authorization',`Bearer ${process.env.CLOUD_OPENAI_API_KEY}`);
 const client=createOpenAiClient({apiKey:process.env.CLOUD_OPENAI_API_KEY,baseUrl:openAiBaseUrl(process.env)});
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:jobConcurrency+2,connectionTimeoutMillis:5000,statement_timeout:10000});
 // A client can emit an error while borrowed or being discarded, outside the idle pool handler.
 pool.on('connect',client=>{client.on('error',fail);});
 pool.on('error',fail);
 const installed=await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM schema_migrations WHERE name=ANY($1::text[])',[migrationNames]);
 if(installed.rows[0]?.count!==migrationNames.length)throw Error();
 const worker=new TranslationWorker(pool,client);
 if(args[0]==='--once')await worker.runOnce(stop.signal);
 else await runWorkerLoop({signal:stop.signal,concurrency:jobConcurrency,scheduleIntervalMs:60000,pollIntervalMs:1000,
  runOnce:signal=>worker.runOnce(signal),onError(error){if(stop.signal.aborted)throw error;console.error('Translation worker pass failed; retrying');}});
}catch{
 // Provider and database errors can carry request text; operational output stays fixed.
 fail();
}finally{
 try{await pool?.end();}catch{fail();}
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
```

Two jobs side by side at four batches each is at most eight provider calls at once; the trial sent 12 side by side without a refusal on 2026-10-14 (spec, "The worker", step 3).

Add the two `package.json` scripts named in **Files**.

- [x] **Step 3: Run the command tests and watch them pass.** Same command as Step 1; expected: 23 passing, including header validation, idle signals, two-job concurrency and database-failure diagnostics.

- [x] **Step 4: Commit**

```bash
git add packages/translation package.json
git commit -s -m "Add the translation-worker command: fixed failure output, a --once mode, and a clean stop on SIGTERM that hands the job's lease back"
```

---

### Task 10: The four machine actions at the store level

> **Authoritative replacement:** [paging amendment, Task 10 row and behavioral checks](2026-10-16-translation-collect-pages.md#implement-inline-with-failing-behavioral-tests-first).
> The shared exact-body parser below applies only to status/release. Collect allows optional
> cursor; perform the installation-scoped lookup before validating cursor and its range.

**Files:**
- Create: `packages/translation/src/machine.ts`, `test/machine.test.ts`
- Modify: `packages/translation/src/index.ts`, `test/fixtures.ts` (add `readyForTranslation`)

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `InstallationError`, `InstallationStore`, `createLeaseTrust`, `readMachineClaims`, `transaction`, `verifyLease`, `verifyMachine`, `type LeaseIssuer` from `@waitron-cloud/registration`.
- Produces:
  - `export type TranslationAction='translation-submit'|'translation-status'|'translation-collect'|'translation-release'`
  - `export class TranslationMachine {constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trusted?:ReadonlyMap<string,string>);authenticate(action:TranslationAction,envelope:unknown);execute(action:TranslationAction,envelope:unknown,jobBody?:string):Promise<Record<string,unknown>>}` — `authenticate` is `InstallationStore.authenticate` (a preliminary check that protects the per-installation rate allowance); `execute` rechecks everything under a lock.
  - `test/fixtures.ts`: `export async function readyForTranslation(db,v:{installationId:string}):Promise<void>` — upserts the venue's `content_translation` row as `ready` (until Task 17 creates it for every installation).

`execute` for every action, in one transaction: lock the installation row `FOR SHARE` joined to its venue and its `content_translation` row; `verifyMachine` against the stored key; revoked → `InstallationError('revoked')`; parse and verify the lease and check it names this installation, venue, environment and key (as `StaffCertificateExchange.execute` does in `packages/remote-access/src/staff-exchange.ts:34-37`). Then:

- **submit**, in the contract's order of checks ("Submit"): `checkSubmitBody(claims.body,jobBody)` before any parsing of the job; `parseJob(jobBody)`; `lockVenue`; `findSubmitted` (a retry returns `submitView` of the first job at once, with its current state, and checks nothing further); entitlement: the installation's `content_translation` row must have `state='ready'`, else `InstallationError('permission_denied')`; (consent, added in Task 13); `createJob` with `total=writtenItems(parsed).length`, which checks the open job and then the cap; reply `submitView`.
- **status/collect/release**: the signed body must be exactly `{"version":1,"jobId":"<lowercase uuid>"}` (else `invalid_request`); `readJob` → `statusView`, `collectJob` or `releaseJob`.

- [ ] **Step 1: Add the fixture and write the failing tests**

Append to `test/fixtures.ts`:

```ts
export async function readyForTranslation(db:Awaited<ReturnType<typeof database>>,v:{installationId:string}){
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'content_translation','ready')
  ON CONFLICT (installation_id,service) DO UPDATE SET state='ready'`,[v.installationId]);
}
```

`test/machine.test.ts` holds the ordering facts the HTTP tests in Task 11 cannot see:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {createLeaseIssuer,InstallationError} from '@waitron-cloud/registration';
import {jobFingerprint,TranslationError,TranslationMachine} from '../src/index.ts';
import {connectedVenue,database,readyForTranslation} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
const machine=()=>new TranslationMachine(db.pool,issuer,origin);
async function venue(){const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);return v;}
const setService=(v:{installationId:string},state:string)=>db.pool.query("UPDATE installation_services SET state=$2 WHERE installation_id=$1 AND service='content_translation'",[v.installationId,state]);
const item=(ref:string)=>({ref,kind:'product',family:ref,category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']});
const jobText=(refs=['product:1'])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items:refs.map(item),houseStyle:[]});
const code=(name:string)=>(e:unknown)=>(e instanceof TranslationError||e instanceof InstallationError)&&e.code===name;
const envelopeOf=(e:{payload:string;signature:string})=>({payload:e.payload,signature:e.signature});
const jobs=async(v:{venueId:string})=>(await db.pool.query('SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1',[v.venueId])).rows[0].n as number;
test('the fingerprint is checked before the job is parsed',async()=>{
 const v=await venue(),signed=v.submit('not json');
 await assert.rejects(machine().execute('translation-submit',envelopeOf(signed),'not json!'),code('invalid_proof'));
 await assert.rejects(machine().execute('translation-submit',envelopeOf(signed),'not json'),code('invalid_request'));
 assert.equal(await jobs(v),0);
});
test('a retry returns its job even after the service stops being ready; a new job is then refused before the cap is read',async()=>{
 const v=await venue(),text=jobText(),signed=v.submit(text);
 const first=await machine().execute('translation-submit',envelopeOf(signed),text);
 await setService(v,'unconfigured');
 assert.deepEqual(await machine().execute('translation-submit',envelopeOf(signed),text),first);
 await db.pool.query('UPDATE translation_policy SET monthly_cap_micro_usd=1');
 try{
  const other=jobText(['product:2']);
  await assert.rejects(machine().execute('translation-submit',envelopeOf(v.submit(other)),other),code('permission_denied'));
 }finally{await db.pool.query('UPDATE translation_policy SET monthly_cap_micro_usd=5000000');}
 assert.equal(await jobs(v),1);
});
test('status, collect and release take exactly a version and a lowercase job id',async()=>{
 const v=await venue(),text=jobText();
 const {jobId}=await machine().execute('translation-submit',envelopeOf(v.submit(text)),text) as {jobId:string};
 for(const body of [{version:1,jobId,extra:1},{version:2,jobId},{version:1,jobId:jobId.toUpperCase()},{version:1},{version:1,jobId:'not-a-uuid'}])
  await assert.rejects(machine().execute('translation-status',v.proof('translation-status',body,randomUUID(),v.lease)),code('invalid_request'),JSON.stringify(body));
 assert.equal((await machine().execute('translation-status',v.proof('translation-status',{version:1,jobId},randomUUID(),v.lease)) as {state:string}).state,'queued');
});
test('a lease naming another installation, a missing job body and a revoked installation are refused',async()=>{
 const a=await venue(),b=await venue(),text=jobText();
 const crossed=a.proof('translation-submit',undefined,randomUUID(),b.lease,JSON.stringify({version:1,...jobFingerprint(text)}));
 await assert.rejects(machine().execute('translation-submit',crossed,text),code('invalid_proof'));
 await assert.rejects(machine().execute('translation-submit',envelopeOf(a.submit(text))),code('invalid_proof'));
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[a.installationId]);
 await assert.rejects(machine().execute('translation-submit',envelopeOf(a.submit(text)),text),code('revoked'));
 assert.equal(await jobs(a),0);
});
```

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=30000 test/machine.test.ts` and watch it fail (`TranslationMachine` is not exported).

- [ ] **Step 2: Implement `machine.ts`**

```ts
import type {Pool} from 'pg';
import {createLeaseTrust,InstallationError,InstallationStore,readMachineClaims,transaction,verifyLease,verifyMachine,type LeaseIssuer} from '@waitron-cloud/registration';
import {fail} from './errors.ts';
import {parseJob,writtenItems} from './job-body.ts';
import {collectJob,createJob,findSubmitted,lockVenue,readJob,releaseJob,statusView,submitView} from './job-store.ts';
import {checkSubmitBody} from './submit-proof.ts';
export type TranslationAction='translation-submit'|'translation-status'|'translation-collect'|'translation-release';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
function jobReference(body:string):string{
 let value:unknown;try{value=JSON.parse(body);}catch{return fail('invalid_request');}
 const v=value as {version?:unknown;jobId?:unknown};
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof v.jobId!=='string'||!uuid.test(v.jobId)
  ||JSON.stringify({version:1,jobId:v.jobId})!==body)fail('invalid_request');
 return v.jobId as string;
}
export class TranslationMachine {
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trusted=createLeaseTrust(issuer)){this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;}
 authenticate(action:TranslationAction,envelope:unknown){return new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate(action,envelope);}
 async execute(action:TranslationAction,envelope:unknown,jobBody?:string):Promise<Record<string,unknown>>{
  const routing=readMachineClaims(envelope);
  return transaction(this.#pool,async client=>{
   const row=(await client.query(`SELECT i.id,i.venue_id,i.public_key,i.revoked_at,v.environment,s.state AS translation_state
    FROM installations i JOIN venues v ON v.id=i.venue_id
    LEFT JOIN installation_services s ON s.installation_id=i.id AND s.service='content_translation'
    WHERE i.id=$1 FOR SHARE OF i`,[routing.installationId])).rows[0];
   if(!row)throw new InstallationError('invalid_proof');
   const claims=verifyMachine(envelope,row.public_key,this.#origin,action);
   if(row.revoked_at)throw new InstallationError('revoked');
   let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
   if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
   const lease=verifyLease(encoded,this.#trusted,this.#origin);
   if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.environment!==row.environment||lease.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
   if(action==='translation-submit'){
    if(typeof jobBody!=='string')throw new InstallationError('invalid_proof');
    const fingerprint=checkSubmitBody(claims.body,jobBody),parsed=parseJob(jobBody);
    await lockVenue(client,row.venue_id);
    const prior=await findSubmitted(client,row.id,claims.operationId,fingerprint);
    if(prior)return submitView(prior);
    if(row.translation_state!=='ready')throw new InstallationError('permission_denied');
    return submitView(await createJob(client,{installationId:row.id,venueId:row.venue_id,operationId:claims.operationId,fingerprint,body:jobBody,total:writtenItems(parsed).length}));
   }
   const job=await readJob(client,row.id,jobReference(claims.body));
   if(action==='translation-status')return statusView(job);
   if(action==='translation-collect')return collectJob(client,job);
   return releaseJob(client,job);
  });
 }
}
```

Add to `src/index.ts`:

```ts
export {TranslationMachine,type TranslationAction} from './machine.ts';
```

- [ ] **Step 3: Run the tests and watch them pass.** Same command as Step 1; expected: 4 passing.

- [ ] **Step 4: Commit**

```bash
git add packages/translation
git commit -s -m "Check and run the four translation machine actions at the store level, in the contract's order: proof and lease, the fingerprint before the job is parsed, a retried submit before the entitlement"
```

---

### Task 11: The four machine routes in account-http

> **Authoritative replacement:** [paging amendment, Task 11 row and behavioral checks](2026-10-16-translation-collect-pages.md#implement-inline-with-failing-behavioral-tests-first).
> Replace single-collect shape assertions with paged replies including `nextCursor`; measure
> the exact compact full response through a real listener without changing security checks.

**Files:**
- Create: `packages/account-http/src/translation.ts`, `packages/account-http/test/translation.test.ts`
- Modify: `packages/account-http/src/app.ts` (option, constructor, dispatch above the staff-certificate line at `:135`), `src/server.ts:17` (option type), `src/server-cli.ts:26-27,43` (`CLOUD_TRANSLATION` flag), `packages/account-http/package.json` (dependency `"@waitron-cloud/translation": "workspace:*"`), `pnpm-lock.yaml` (by `pnpm install`), `scripts/ci-scope.test.mjs` (only if Step 5 shows a pin moved)

**Interfaces:**
- Consumes: `TranslationMachine`, `TranslationError`, `type TranslationAction` (Tasks 1 and 10); `readyForTranslation`, `connectedVenue` (Tasks 2 and 10); `readBoundedJsonObject` (`src/request.ts`).
- Produces:
  - `export const translationPaths:string[]` and `export async function translationResponse(c,options:{machine?:TranslationMachine;ip:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>` in `packages/account-http/src/translation.ts`.
  - `createAccountApp({…,translation?:boolean})` and `startAccountServer({…,translation?:boolean})`; `CLOUD_TRANSLATION` (introduced; `'0'` default, `'1'` enables, anything else refuses to start), read as `CLOUD_STAFF_CERTIFICATES` is in `server-cli.ts:26`. Enabling it without a lease issuer throws `translation.installation_issuer_required`.

The routes read the request with today's 16 KiB, 5-second reader; Task 12 gives submit its own limits and admission. The outer request (contract, "Submit"): a request not sent as `application/json` gets the reader's 415 `invalid_input`, a body that is not a JSON object its 400 `invalid_input`; a JSON object with keys other than `payload`, `signature` (and `body` for submit), or a non-string value, is an invalid envelope (401).

- [ ] **Step 1: Write the failing HTTP tests**

`packages/account-http/test/translation.test.ts`. Each venue gets its own client address, so the 60-a-minute per-address allowance does not couple the tests.

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {jobFingerprint} from '@waitron-cloud/translation';
import {createAccountApp} from '../src/app.ts';
import {connectedVenue,database,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='https://cloud.example.test';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,addresses=0;
const config=()=>({portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[] as string[]});
before(async()=>{db=await database();app=createAccountApp({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:config()});});
after(async()=>db?.close());
type Venue=Awaited<ReturnType<typeof connectedVenue>>&{ip:string};
async function venue():Promise<Venue>{const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);return {...v,ip:`203.0.113.${++addresses}`};}
function post(v:{ip:string},action:string,body:unknown,headers:Record<string,string>={},target=app){
 return target.request(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json',...headers},
  body:typeof body==='string'?body:JSON.stringify(body)},{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
}
const item=(ref:string,over:Record<string,unknown>={})=>({ref,kind:'product',family:ref,category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es','en'],...over});
const jobText=(items:object[]=[item('product:1')])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},items,houseStyle:[]});
const reference=(v:Venue,action:string,jobId:string)=>v.proof(action,{version:1,jobId},randomUUID(),v.lease);
const error=async(response:Response)=>[response.status,((await response.json()) as {error:string}).error];
const jobCount=async(v:Venue)=>(await db.pool.query('SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1',[v.venueId])).rows[0].n as number;
test('submit, status, collect and release follow the contract shapes',async()=>{
 const v=await venue(),submitted=await post(v,'translation-submit',v.submit(jobText()));
 assert.equal(submitted.status,200);assert.equal(submitted.headers.get('cache-control'),'no-store');
 const {jobId,...reply}=(await submitted.json()) as {jobId:string};
 assert.deepEqual(reply,{version:1,state:'queued',total:1});
 assert.deepEqual(await (await post(v,'translation-status',reference(v,'translation-status',jobId))).json(),{version:1,jobId,state:'queued',total:1,done:0,failed:0});
 const result={ref:'product:1',names:{ca:'Cafè',es:'Café',en:'Coffee'},placeholder:false,corrections:[]};
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[jobId,{0:{results:[result],failed:[]}}]);
 await db.pool.query("UPDATE translation_jobs SET state='done',done=1,finished_at=clock_timestamp() WHERE id=$1",[jobId]);
 assert.deepEqual(await (await post(v,'translation-collect',reference(v,'translation-collect',jobId))).json(),{version:1,jobId,state:'done',results:[result],failed:[]});
 assert.deepEqual(await (await post(v,'translation-release',reference(v,'translation-release',jobId))).json(),{version:1,jobId,state:'collected'});
 assert.deepEqual(await error(await post(v,'translation-collect',reference(v,'translation-collect',jobId))),[410,'translation_expired']);
});
test('a resent submit returns the same job, and its operation with another body conflicts',async()=>{
 const v=await venue(),op=randomUUID(),envelope=v.submit(jobText(),op);
 const first=await (await post(v,'translation-submit',envelope)).json();
 assert.deepEqual(await (await post(v,'translation-submit',envelope)).json(),first);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText([item('product:2')]),op))),[409,'conflict']);
 assert.equal(await jobCount(v),1);
});
test('a changed byte of the body or a wrong length is an invalid proof and creates nothing',async()=>{
 const v=await venue(),text=jobText(),good=v.submit(text);
 assert.deepEqual(await error(await post(v,'translation-submit',{...good,body:text.replace('CAFE','CAFF')})),[401,'invalid_proof']);
 const {jobSha256,jobBytes}=jobFingerprint(text);
 const wrong=v.proof('translation-submit',undefined,randomUUID(),v.lease,JSON.stringify({version:1,jobSha256,jobBytes:jobBytes+1}));
 assert.deepEqual(await error(await post(v,'translation-submit',{...wrong,body:text})),[401,'invalid_proof']);
 assert.equal(await jobCount(v),0);
});
test('a proof signed 61 seconds ago is refused',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText(),randomUUID(),Date.now()-61000))),[401,'invalid_proof']);
});
test('an expired lease is refused',async()=>{
 const v=await venue(),now=Date.now(),text=jobText();
 const lease=issuer.issue({origin,leaseId:randomUUID(),installationId:v.installationId,venueId:v.venueId,environment:'test',publicKey:v.installationKey,issuedAt:now-3600000,expiresAt:now-1});
 const envelope=v.proof('translation-submit',undefined,randomUUID(),lease,JSON.stringify({version:1,...jobFingerprint(text)}));
 assert.deepEqual(await error(await post(v,'translation-submit',{...envelope,body:text})),[401,'invalid_proof']);
});
test('a browser origin, a service that is not ready and a revoked installation are each refused with 403',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText()),{origin})),[403,'forbidden']);
 await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='content_translation'",[v.installationId]);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText()))),[403,'permission_denied']);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installationId]);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText()))),[403,'revoked']);
});
test("another installation's job is not found on status, collect and release",async()=>{
 const a=await venue(),b=await venue();
 const {jobId}=(await (await post(a,'translation-submit',a.submit(jobText()))).json()) as {jobId:string};
 for(const action of ['translation-status','translation-collect','translation-release'])
  assert.deepEqual(await error(await post(b,action,reference(b,action,jobId))),[404,'translation_job_not_found']);
});
test('a second submit while one is queued is refused',async()=>{
 const v=await venue();assert.equal((await post(v,'translation-submit',v.submit(jobText()))).status,200);
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText([item('product:2')])))),[409,'translation_job_running']);
});
test('the cap refusal carries exactly how many items fit, with the usual security headers',async()=>{
 const v=await venue();
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,cost_micro_usd,finished_at)
  VALUES($1,$2,$3,$4,$5,1,'collected',1,'openai','gpt-6-luna','translate-all-v1',4999000,clock_timestamp())`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'b'.repeat(64)]);
 const response=await post(v,'translation-submit',v.submit(jobText(Array.from({length:7},(_,i)=>item(`product:${i}`)))));
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'translation_limit_reached',fits:6});
 for(const [name,value] of [['cache-control','no-store'],['x-content-type-options','nosniff'],['referrer-policy','no-referrer']] as const)assert.equal(response.headers.get(name),value,name);
});
test('a job field that breaks a rule is an invalid request',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',v.submit(jobText([item('product:1',{kind:'dish'})])))),[400,'invalid_request']);
});
test('with translation off all four routes answer 503, and turning it on needs a lease issuer',async()=>{
 const off=createAccountApp({pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,config:config()}),v=await venue();
 for(const action of ['translation-submit','translation-status','translation-collect','translation-release'])
  assert.deepEqual(await error(await post(v,action,{},{},off)),[503,'temporarily_unavailable']);
 assert.throws(()=>createAccountApp({translation:true,pool:db.pool,outbox:db.outbox,config:config()}),/translation\.installation_issuer_required/);
});
test('the outer request: other keys are an invalid envelope, a non-object is the reader’s 400 and another type its 415',async()=>{
 const v=await venue(),good=v.submit(jobText());
 for(const body of [{payload:good.payload,signature:good.signature},{...good,extra:'x'},{...good,body:5}])
  assert.deepEqual(await error(await post(v,'translation-submit',body)),[401,'invalid_proof'],JSON.stringify(Object.keys(body)));
 assert.deepEqual(await error(await post(v,'translation-status',{...reference(v,'translation-status',randomUUID()),body:'x'})),[401,'invalid_proof']);
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify([good]))),[400,'invalid_input']);
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify(good),{'content-type':'text/plain'})),[415,'invalid_input']);
});
test('a context head counts for nothing in total, and one that heads nothing is refused',async()=>{
 const v=await venue(),head=item('product:640',{missing:[],existing:{ca:'Canya',es:'Caña',en:'Half pint'}});
 const variant=item('variant:812',{kind:'variant',family:'product:640',existing:{en:'Pint'},missing:['ca','es']});
 assert.equal(((await (await post(v,'translation-submit',v.submit(jobText([head,variant])))).json()) as {total:number}).total,1);
 const w=await venue();
 assert.deepEqual(await error(await post(w,'translation-submit',w.submit(jobText([item('product:9',{missing:[],existing:{ca:'a',es:'b',en:'c'}}),item('product:10')])))),[400,'invalid_request']);
});
```

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/translation.test.ts` and watch it fail (the routes answer 404 or the option does not exist).

- [ ] **Step 2: Write `packages/account-http/src/translation.ts`**

```ts
import type {Context} from 'hono';
import {InstallationError} from '@waitron-cloud/registration';
import {TranslationError,type TranslationAction,type TranslationMachine} from '@waitron-cloud/translation';
import {readBoundedJsonObject} from './request.ts';
import {AccountHttpError,type ErrorStatus} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export const translationPaths=['/api/installations/translation-submit','/api/installations/translation-status','/api/installations/translation-collect','/api/installations/translation-release'];
const codes:Record<TranslationError['code'],[ErrorStatus,string]>={invalid_request:[400,'invalid_request'],consent_required:[403,'translation_consent_required'],
 job_not_found:[404,'translation_job_not_found'],job_running:[409,'translation_job_running'],limit_reached:[409,'translation_limit_reached'],
 not_ready:[409,'translation_not_ready'],expired:[410,'translation_expired'],job_too_large:[413,'translation_job_too_large'],conflict:[409,'conflict'],forbidden:[403,'forbidden']};
export async function translationResponse(c:Context,options:{machine?:TranslationMachine;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable');
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const action=c.req.path.slice('/api/installations/'.length) as TranslationAction,submit=action==='translation-submit';
 const parsed=await readBoundedJsonObject(c.req.raw);
 const fields=submit?['body','payload','signature']:['payload','signature'];
 if(Object.keys(parsed).sort().join(',')!==fields.join(',')||fields.some(f=>typeof parsed[f]!=='string'))throw new InstallationError('invalid_proof');
 const envelope={payload:parsed.payload as string,signature:parsed.signature as string};
 const claims=await options.machine.authenticate(action,envelope);
 await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 try{return c.json(await options.machine.execute(action,envelope,submit?parsed.body as string:undefined));}
 catch(error){
  if(!(error instanceof TranslationError))throw error;
  const [status,code]=codes[error.code];
  if(error.code==='limit_reached')return c.json({error:code,fits:error.fits},409);
  throw new AccountHttpError(status,code);
 }
}
```

`ErrorStatus` is the status union `packages/account-http/src/errors.ts:1` exports. `c.json` on a refusal still carries the security headers, because `protect(c)` runs first for every request (`app.ts:105`).

- [ ] **Step 3: Wire the app, the server option and the command flag**

`packages/account-http/src/app.ts`:
- import `{TranslationMachine}` from `@waitron-cloud/translation` and `{translationPaths,translationResponse}` from `./translation.ts`;
- add `translation?:boolean` to `createAccountApp`'s options type;
- beside the other issuer checks at `:77-79`: `if(options.translation&&!options.leaseIssuer)throw Error('translation.installation_issuer_required');`
- beside `staffExchange` at `:88`: `const translation=options.translation&&options.leaseIssuer?new TranslationMachine(pool,options.leaseIssuer,config.portalOrigin,options.leaseTrust):undefined;`
- above the staff-certificate line at `:135`: `if(translationPaths.includes(c.req.path))return translationResponse(c,{machine:translation,ip,consume});`

`packages/account-http/src/server.ts:17`: add `translation?:boolean` to `startAccountServer`'s options type (it already passes its options to `createAccountApp`).

`packages/account-http/src/server-cli.ts`, after `:27`:

```ts
  const translationFlag=process.env.CLOUD_TRANSLATION??'0';if(!['0','1'].includes(translationFlag))throw new Error();
  const translation=translationFlag==='1';
```

and pass `translation` in the `startAccountServer({…})` call at `:43`.

Add `"@waitron-cloud/translation": "workspace:*"` to `packages/account-http/package.json` and run `pnpm install`.

- [ ] **Step 4: Run the tests and watch them pass.** The Step 1 command; expected: 13 passing. Also run `test/server.test.ts` and `test/staff-certificates.test.ts` in account-http, which exercise the app factory and the command's flags.

- [ ] **Step 5: Check the CI pins.** The new dependency edge (account-http on translation) can change `scripts/ci-scope.test.mjs`'s dependents lists. Run `node --test scripts/ci-scope.test.mjs`; if a pinned list fails, update it to the package names the failure prints, and say which in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/account-http pnpm-lock.yaml scripts/ci-scope.test.mjs
git commit -s -m "Serve the four translation machine routes with the contract's refusals, off unless CLOUD_TRANSLATION=1"
```

---

### Task 12: Submit's own request limits and admission

**Files:**
- Create: `packages/account-http/test/translation-limits.test.ts`
- Modify: `packages/account-http/src/request.ts:2,6,15,22` (size and time parameters), `src/translation.ts` (submit's reader limits, its 413), `src/server.ts:17-37` (submit admission, request time limit)

**Interfaces:**
- Consumes: Task 11's routes; `clientAddress` (`src/client-address.ts`).
- Produces:
  - `readBoundedJsonObject(request,maxBytes=16384,timeoutMs=5000)`; `readAccountBody` keeps the defaults.
  - In `src/translation.ts`: `export const maxSubmitRequestBytes=2*1048576+16384, submitRequestMs=60000, submitSlots=4, submitPath='/api/installations/translation-submit';` (contract, "Request limits"; the slot numbers are this plan's).

Why the admission: the server answers 503 once 8 requests are in flight (`server.ts:32-35`), and a request keeps its place while its body is read. A submit may take 60 seconds to arrive, and up to 60 a minute are allowed per client address, so without its own allowance one client sending slow submits could hold all 8 places and stall the whole account API, readiness checks included. When translation is on, a submit therefore never takes one of the 8: it takes one of 4 submit places, at most 1 per client address, and is answered 503 `temporarily_unavailable` with `Retry-After: 1` before its body is read when none is free. The per-address and per-installation rate limits still apply inside the route.

- [ ] **Step 1: Write the failing tests**

`packages/account-http/test/translation-limits.test.ts`:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {request,type IncomingHttpHeaders} from 'node:http';
import {after,before,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {startAccountServer} from '../src/server.ts';
import {connectedVenue,database,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='http://localhost';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,addresses=0;
const config=()=>({portalOrigin:origin,production:false,rateKey:db.rateKey,trustedProxyIps:[] as string[]});
before(async()=>{db=await database();app=createAccountApp({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:config()});});
after(async()=>db?.close());
beforeEach(async()=>{await db.pool.query('TRUNCATE account_rate_limits');});
type Venue=Awaited<ReturnType<typeof connectedVenue>>&{ip:string};
async function venue():Promise<Venue>{const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);return {...v,ip:`198.51.100.${++addresses}`};}
const post=(v:{ip:string},action:string,body:string)=>app.request(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json'},body},{incoming:{socket:{remoteAddress:v.ip}}} as HttpBindings);
const error=async(response:Response)=>[response.status,((await response.json()) as {error:string}).error];
const item=(ref:string,staffName='CAFE',category:string|null='x')=>({ref,kind:'product',family:ref,category,staffName,existing:{},missing:['ca','es','en']});
const jobText=(items:object[])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},items,houseStyle:[]});
// A field of 1 + extra JSON bytes, at most 500 characters, for extra up to 997.
const pad=(extra:number)=>extra%2?'xx'+'"'.repeat((extra-1)/2):'x'+'"'.repeat(extra/2);
// A valid job of exactly `target` UTF-8 bytes, about nine tenths of them escaped quote characters.
function quoteHeavyJob(target:number){
 const full=(k:number)=>item(`product:${k}`,'"'.repeat(500)),small=(k:number,staff='x',category='x')=>item(`product:${k}`,staff,category);
 const items:object[]=[],size=(list:object[])=>Buffer.byteLength(jobText(list),'utf8');
 while(size([...items,full(items.length),small(items.length+1)])<=target)items.push(full(items.length));
 const gap=target-size([...items,small(items.length)]),first=Math.min(gap,997),second=gap-first;
 assert.ok(gap>=0&&second<=997,`gap ${gap}`);
 const text=jobText([...items,small(items.length,pad(first),pad(second))]);
 assert.equal(Buffer.byteLength(text,'utf8'),target);assert.ok(items.length<1000);
 return text;
}
type Reply={status:number;headers:IncomingHttpHeaders;body:string};
function send(port:number,path:string,body:string,from?:string){
 return new Promise<Reply>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path,method:'POST',headers:{host:'localhost','content-type':'application/json',...(from?{'x-forwarded-for':from}:{})}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:text}));});
  req.on('error',reject);req.end(body);
 });
}
function trickle(port:number,path:string,body:string,pieces:number,pauseMs:number){
 return new Promise<Reply>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path,method:'POST',headers:{host:'localhost','content-type':'application/json','content-length':String(Buffer.byteLength(body))}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:text}));});
  req.on('error',()=>{});
  const size=Math.ceil(body.length/pieces);
  void (async()=>{for(let i=0;i<pieces;i++){if(req.destroyed)return;req.write(body.slice(i*size,(i+1)*size));if(i<pieces-1)await delay(pauseMs);}req.end();})().catch(reject);
 });
}
// A submit that announces a large body, sends one byte of it and then waits.
function hold(port:number,from:string){
 const req=request({host:'127.0.0.1',port,path:'/api/installations/translation-submit',method:'POST',
  headers:{host:'localhost','content-type':'application/json','content-length':'1000000','x-forwarded-for':from}});
 req.on('error',()=>{});req.write('{');
 return {abort(){req.destroy();}};
}
function ready(port:number,from:string){
 return new Promise<Reply>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:'/api/health/ready',headers:{host:'localhost','x-forwarded-for':from}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:text}));});
  req.on('error',reject);req.end();
 });
}
async function until(check:()=>Promise<boolean>,ms=5000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('condition timed out');await delay(20);}}
async function host(trustedProxyIps:string[]=[]){
 const running=await startAccountServer({pool:db.pool,outbox:db.outbox,config:{...config(),trustedProxyIps},port:0,translation:true,leaseIssuer:issuer});
 const address=running.server.address();assert.ok(address&&typeof address!=='string');return {...running,port:address.port};
}
test('a 1 MiB job made mostly of quote characters is accepted, and one byte more is refused as too large',async()=>{
 const v=await venue(),exact=quoteHeavyJob(1048576),request=JSON.stringify(v.submit(exact));
 assert.ok(Buffer.byteLength(request)>16384*100);
 const accepted=await post(v,'translation-submit',request);
 assert.equal(accepted.status,200,await accepted.clone().text());
 const w=await venue();
 assert.deepEqual(await error(await post(w,'translation-submit',JSON.stringify(w.submit(quoteHeavyJob(1048577))))),[413,'translation_job_too_large']);
});
test('more than 1,000 items is too large',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify(v.submit(jobText(Array.from({length:1001},(_,i)=>item(`product:${i}`))))))),[413,'translation_job_too_large']);
});
test('a request over the submit limit is refused as too large, and status keeps the 16 KiB limit',async()=>{
 const v=await venue();
 assert.deepEqual(await error(await post(v,'translation-submit',JSON.stringify({payload:'x',signature:'y',body:'a'.repeat(2113536)}))),[413,'translation_job_too_large']);
 assert.deepEqual(await error(await post(v,'translation-status',JSON.stringify({payload:'x'.repeat(20480),signature:'y'}))),[413,'invalid_input']);
});
test('submit may take up to 60 seconds to arrive; status still has 5',async()=>{
 const running=await host();
 try{
  const v=await venue();
  const submitted=await trickle(running.port,'/api/installations/translation-submit',JSON.stringify(v.submit(jobText([item('product:1')]))),3,3000);
  assert.equal(submitted.status,200,submitted.body);
  const status=JSON.stringify(v.proof('translation-status',{version:1,jobId:JSON.parse(submitted.body).jobId},randomUUID(),v.lease));
  assert.equal((await trickle(running.port,'/api/installations/translation-status',status,3,3000)).status,408);
 }finally{await running.close();}
});
test('stalled submits never take the eight places every other request shares, and one address holds one submit at a time',async()=>{
 // The server trusts loopback as a proxy here, so each stalled submit can come from its own forwarded address.
 const running=await host(['127.0.0.1']),addresses=Array.from({length:8},(_,i)=>`198.18.0.${i+1}`),held:{abort():void}[]=[];
 const attempts=async()=>Number((await db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n);
 try{
  const v=await venue(),body=()=>JSON.stringify(v.submit(jobText([item('product:1')])));
  held.push(hold(running.port,addresses[0]!));
  // The route's per-address rate rule is consumed before the body is read, so a counted attempt means the stalled submit is inside.
  await until(async()=>await attempts()>=2);
  const sameAddress=await send(running.port,'/api/installations/translation-submit',body(),addresses[0]);
  assert.deepEqual([sameAddress.status,sameAddress.headers['retry-after']],[503,'1']);
  for(const from of addresses.slice(1))held.push(hold(running.port,from));
  await until(async()=>await attempts()>=8);
  assert.equal((await send(running.port,'/api/installations/translation-submit',body(),'198.18.0.9')).status,503);
  const probe=await ready(running.port,'198.18.0.10');
  assert.deepEqual([probe.status,JSON.parse(probe.body)],[200,{status:'ready'}]);
  assert.equal((await send(running.port,'/api/installations/translation-status',JSON.stringify({payload:'x',signature:'y'}),'198.18.0.11')).status,401);
  held[0]!.abort();
  await until(async()=>(await send(running.port,'/api/installations/translation-submit',body(),addresses[0])).status===200);
 }finally{for(const h of held)h.abort();await running.close();}
});
```

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=60000 test/translation-limits.test.ts` and watch the first four fail with the 16 KiB reader's `413 invalid_input` or its 5-second `408`, and the fifth fail: today every stalled submit takes one of the 8 places, so the second submit from the same address is read normally and, with 8 stalled, the readiness check is answered 503.

- [ ] **Step 2: Give the reader its parameters**

`packages/account-http/src/request.ts`: change the signature at `:2` to `export async function readBoundedJsonObject(request: Request, maxBytes = 16384, timeoutMs = 5000): Promise<Record<string, unknown>>`, use `maxBytes` in both size checks (`:6` `Number(length) > maxBytes`, `:22` `size > maxBytes`) and `timeoutMs` for the timer (`:15` `timer = setTimeout(onAbort, timeoutMs);`). `readAccountBody` calls it with the defaults.

- [ ] **Step 3: Give submit its limits in the route**

In `packages/account-http/src/translation.ts`, add the four constants named in **Interfaces**, and replace the line `const parsed=await readBoundedJsonObject(c.req.raw);` with:

```ts
 let parsed:Record<string,unknown>;
 try{parsed=await readBoundedJsonObject(c.req.raw,submit?maxSubmitRequestBytes:16384,submit?submitRequestMs:5000);}
 catch(error){if(submit&&error instanceof AccountHttpError&&error.status===413)throw new AccountHttpError(413,'translation_job_too_large');throw error;}
```

- [ ] **Step 4: Give submit its own admission and the longer request time limit**

`packages/account-http/src/server.ts`: import `{clientAddress}` from `./client-address.ts` and `{submitPath,submitRequestMs,submitSlots}` from `./translation.ts`. Inside `startAccountServer`, beside `let active = 0;`, add `let submitting=0;const submitters=new Set<string>();`. In the listener, after the `/api/health/live` line (`:30`) and before `const readiness=…`:

```ts
    if (options.translation && url.pathname === submitPath) {
      let ip: string | undefined;
      try {ip = clientAddress(bindings.incoming.socket.remoteAddress ?? '', request.headers.get('x-forwarded-for') ?? undefined, options.config.trustedProxyIps);}
      catch {ip = undefined;}
      if (ip !== undefined) {
        if (submitting >= submitSlots || submitters.has(ip)) return unavailable();
        submitting++; submitters.add(ip);
        try {return await app.fetch(request, bindings);}
        finally {submitting--; submitters.delete(ip);}
      }
    }
```

An address the server cannot read falls through to the general admission, where the app refuses it with 400 before reading the body. Change `requestTimeout: 5000` at `:37` to `requestTimeout: options.translation ? submitRequestMs : 5000` and leave `headersTimeout` at 5,000. Every other route stays bounded at 5 seconds because it reads its body through `readBoundedJsonObject`'s own timer with the default. Before relying on that, run `git grep -n "req.raw\|req.json\|req.text\|req.arrayBuffer\|req.parseBody" packages/account-http/src`: every body read must go through `readBoundedJsonObject` or `readAccountBody` (on 2026-10-14 every one did). Any other one found gets a 408 case like the status one in Step 1.

- [ ] **Step 5: Run the tests and watch them pass.** The Step 1 command; expected: 5 passing. Then rerun `test/translation.test.ts`, `test/server.test.ts` (which holds the 8-place admission and the receive-deadline tests) and `test/staff-certificates.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/account-http
git commit -s -m "Give translation submit its own limits: a 2 MiB request read within 60 seconds, and an allowance of four in flight and one per address outside the eight places every other request shares, so slow submits cannot stall the account API"
```

---

### Task 13: Consent — the store, and the checks at submit and in the worker

**Implementation note (2026-10-17):** agreement and withdrawal both serialize on the
same consent lock. Recording and withdrawing consent also hold shared locks on the
account, credential, membership and venue rows in that order, following relay
authorization, to recheck changes that commit during a wait without the reproduced
account-first writer deadlock. Listing omits disabled or unverified accounts. The worker checks
after leasing, within its existing shutdown cleanup, and fences a refusal by its lease.
All earlier behavioral assertions and deadlines remain; fixtures now record consent,
including the direct paged-worker fixture that does not use `queue()` and the
bounded-collect HTTP fixtures introduced by the paging amendment.

**Files:**
- Create: `packages/translation/src/consent.ts`, `packages/translation/test/consent.test.ts`
- Modify: `packages/translation/src/machine.ts` (submit), `src/worker.ts` (after leasing), `src/index.ts`, `test/fixtures.ts` (add `giveConsent`), and the earlier tests that now need a consenting venue: `packages/translation/test/machine.test.ts`, `test/worker.test.ts`, `test/worker-cli.test.ts`, `packages/account-http/test/translation.test.ts`, `test/translation-limits.test.ts`

**Interfaces:**
- Consumes: `fail`, `TranslationError` (Task 1); `transaction` from `@waitron-cloud/registration`.
- Produces:
  - `export const translationConsentVersion='providers-2026-10-14'; export const translationProviders=['openai','anthropic','google'] as const;`
  - `export interface ConsentView {venueId:string;consented:boolean;consentedAt:string|null}`
  - `export async function hasConsent(client:PoolClient,venueId:string):Promise<boolean>` — a row with `withdrawn_at IS NULL` and the current version, whose account is still enabled (`cloud_accounts.disabled_at IS NULL`), email-verified (`cloud_credentials.email_verified_at IS NOT NULL`) and an owner (`organisation_memberships.is_owner`) of the venue's organisation — the same three checks `account()` and `authority()` make in `packages/registration/src/relay-grants.ts:36-49`.
  - `export async function listConsents(client:PoolClient,accountId:string):Promise<ConsentView[]>` — every venue of an organisation the account owns, ordered by venue id.
  - `export async function agreeConsent(client:PoolClient,accountId:string,input:{venueId:string;consentVersion:string}):Promise<ConsentView>` and `export async function withdrawConsent(client:PoolClient,accountId:string,input:{venueId:string}):Promise<ConsentView>` — both throw `forbidden` unless the account is a current, enabled, verified owner of the venue's organisation, and `invalid_request` for a venue id that is not a UUID or a version that is not the current one. The caller resolves the session (Task 14).
  - `test/fixtures.ts`: `export async function giveConsent(db,v:{venueId:string;organisationId:string;accountId:string}):Promise<void>`.

Rules, from the relay pattern (`docs/transactional-email-relay-contract.md`, "Authority belongs to an installation and a consenting account"): only a current, enabled, verified owner of the venue's organisation may agree or withdraw; the venue is derived from records, never trusted from the body beyond its id; agreeing needs the exact current `consentVersion`; a new owner needs fresh consent (a consent whose account lost ownership no longer counts, and agreeing again closes it and records a new row); any current owner may withdraw; withdrawal sets `withdrawn_at` and keeps the row.

The submit check sits after the entitlement check and before `createJob`, matching the contract's order ("Submit", step 6: service ready, consent, open job, cap). The worker check sits after leasing: a job without consent finishes `failed` with `reason='consent_required'`, no provider call and no usage events.

- [ ] **Step 1: Write the failing tests**

Append to `test/fixtures.ts`:

```ts
export async function giveConsent(db:Awaited<ReturnType<typeof database>>,v:{venueId:string;organisationId:string;accountId:string}){
 await db.pool.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers)
  VALUES($1,$2,$3,$4,'providers-2026-10-14',ARRAY['openai','anthropic','google'])`,[randomUUID(),v.venueId,v.organisationId,v.accountId]);
}
```

`packages/translation/test/consent.test.ts`:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {PoolClient} from 'pg';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {agreeConsent,hasConsent,listConsents,translationConsentVersion,TranslationError,withdrawConsent} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
const tx=<T>(work:(client:PoolClient)=>Promise<T>)=>transaction(db.pool,work);
const code=(name:string)=>(e:unknown)=>e instanceof TranslationError&&e.code===name;
async function account(organisationId:string,owner:boolean){
 const id=randomUUID();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
 await db.pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[id,`consent-${id}@example.test`]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,false,$3)',[id,organisationId,owner]);
 return id;
}
test('consent counts only while its owner is a current, enabled, verified owner and its version is current',async()=>{
 const v=await connectedVenue(db,issuer,origin),has=()=>tx(c=>hasConsent(c,v.venueId));
 const agree=()=>tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 const withdraw=()=>tx(c=>withdrawConsent(c,v.accountId,{venueId:v.venueId}));
 assert.equal(await has(),false);await agree();assert.equal(await has(),true);await withdraw();assert.equal(await has(),false);
 for(const [change,undo] of [
  ['UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1','UPDATE organisation_memberships SET is_owner=true WHERE account_id=$1'],
  ['UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1','UPDATE cloud_accounts SET disabled_at=NULL WHERE id=$1'],
  ['UPDATE cloud_credentials SET email_verified_at=NULL WHERE account_id=$1','UPDATE cloud_credentials SET email_verified_at=clock_timestamp() WHERE account_id=$1'],
  ["UPDATE translation_consents SET consent_version='providers-2026-01-01' WHERE account_id=$1 AND withdrawn_at IS NULL","UPDATE translation_consents SET consent_version='providers-2026-10-14' WHERE account_id=$1 AND withdrawn_at IS NULL"],
 ]){
  await agree();assert.equal(await has(),true);
  await db.pool.query(change!,[v.accountId]);assert.equal(await has(),false,change);
  await db.pool.query(undo!,[v.accountId]);await withdraw();
 }
});
test('only an owner of the venue may agree, with the current version; any owner may withdraw',async()=>{
 const v=await connectedVenue(db,issuer,origin),other=await connectedVenue(db,issuer,origin);
 const member=await account(v.organisationId,false),second=await account(v.organisationId,true);
 const agreeAs=(accountId:string,consentVersion=translationConsentVersion,venueId=v.venueId)=>tx(c=>agreeConsent(c,accountId,{venueId,consentVersion}));
 await assert.rejects(agreeAs(member),code('forbidden'));
 await assert.rejects(agreeAs(other.accountId),code('forbidden'));
 await assert.rejects(agreeAs(v.accountId,'providers-2026-01-01'),code('invalid_request'));
 await assert.rejects(agreeAs(v.accountId,translationConsentVersion,'not-a-venue'),code('invalid_request'));
 assert.equal((await agreeAs(v.accountId)).consented,true);
 assert.equal((await tx(c=>withdrawConsent(c,second,{venueId:v.venueId}))).consented,false);
 const rows=(await db.pool.query('SELECT providers,withdrawn_at FROM translation_consents WHERE venue_id=$1',[v.venueId])).rows;
 assert.equal(rows.length,1);assert.deepEqual(rows[0].providers,['openai','anthropic','google']);assert.ok(rows[0].withdrawn_at);
 assert.deepEqual((await tx(c=>listConsents(c,second))).map(x=>[x.venueId,x.consented]),[[v.venueId,false]]);
 assert.deepEqual(await tx(c=>listConsents(c,member)),[]);
});
test('a new owner needs fresh consent, and agreeing replaces the one whose owner left',async()=>{
 const v=await connectedVenue(db,issuer,origin),second=await account(v.organisationId,true);
 await tx(c=>agreeConsent(c,v.accountId,{venueId:v.venueId,consentVersion:translationConsentVersion}));
 await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[v.accountId]);
 assert.equal(await tx(c=>hasConsent(c,v.venueId)),false);
 assert.equal((await tx(c=>agreeConsent(c,second,{venueId:v.venueId,consentVersion:translationConsentVersion}))).consented,true);
 assert.deepEqual((await db.pool.query('SELECT account_id,withdrawn_at IS NULL AS current FROM translation_consents WHERE venue_id=$1 ORDER BY consented_at',[v.venueId])).rows,
  [{account_id:v.accountId,current:false},{account_id:second,current:true}]);
});
```

Append to `packages/translation/test/machine.test.ts`, and change its `venue()` helper to `async function venue(){const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);await giveConsent(db,v);return v;}` (import `giveConsent` from `./fixtures.ts`):

```ts
test('submit without consent is refused and stores nothing, after the entitlement check; a retry from before the withdrawal still returns its job',async()=>{
 const v=await connectedVenue(db,issuer,origin),text=jobText();await readyForTranslation(db,v);
 await assert.rejects(machine().execute('translation-submit',envelopeOf(v.submit(text)),text),code('consent_required'));
 assert.equal(await jobs(v),0);
 await setService(v,'unconfigured');
 await assert.rejects(machine().execute('translation-submit',envelopeOf(v.submit(text)),text),code('permission_denied'));
 await setService(v,'ready');await giveConsent(db,v);
 const signed=v.submit(text),first=await machine().execute('translation-submit',envelopeOf(signed),text);
 await db.pool.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1',[v.venueId]);
 assert.deepEqual(await machine().execute('translation-submit',envelopeOf(signed),text),first);
});
```

In `packages/translation/test/worker.test.ts`, add `await giveConsent(db,v);` to `queue()` after `connectedVenue` (import `giveConsent`), and append:

```ts
test('a job whose consent was withdrawn before it was leased ends failed with consent_required and calls nothing',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r));
 try{
  const {v,job}=await queue(many('a','A',3));
  await db.pool.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1',[v.venueId]);
  assert.equal(await worker(fake.baseUrl).runOnce(live()),true);
  const ended=await row(job.id);
  assert.deepEqual([ended.state,ended.reason,ended.done,ended.failed,ended.lease_id],['failed','consent_required',0,3,null]);
  assert.equal(fake.requests.length,0);
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE source_reference=$1',[job.id])).rows[0].n,0);
 }finally{await fake.close();}
});
```

In `packages/translation/test/worker-cli.test.ts`, add `await giveConsent(db,v);` to `queue()` after `connectedVenue`. In `packages/account-http/test/translation.test.ts` and `test/translation-limits.test.ts`, add `await giveConsent(db,v);` to `venue()` after `readyForTranslation` (import it from `../../translation/test/fixtures.ts`). Every assertion those files make stays as it is.

Run `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=60000 test/consent.test.ts test/machine.test.ts test/worker.test.ts` and watch the new cases fail (missing exports, then no consent check).

- [ ] **Step 2: Implement `consent.ts`**

```ts
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {fail} from './errors.ts';
export const translationConsentVersion='providers-2026-10-14';
export const translationProviders=['openai','anthropic','google'] as const;
export interface ConsentView {venueId:string;consented:boolean;consentedAt:string|null}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const current=`SELECT c.consented_at FROM translation_consents c
 JOIN venues v ON v.id=c.venue_id AND v.organisation_id=c.organisation_id
 JOIN organisation_memberships m ON m.account_id=c.account_id AND m.organisation_id=v.organisation_id AND m.is_owner
 JOIN cloud_accounts a ON a.id=c.account_id AND a.disabled_at IS NULL
 JOIN cloud_credentials k ON k.account_id=c.account_id AND k.email_verified_at IS NOT NULL
 WHERE c.venue_id=$1 AND c.withdrawn_at IS NULL AND c.consent_version=$2`;
export async function hasConsent(client:PoolClient,venueId:string):Promise<boolean>{
 return !!(await client.query(current,[venueId,translationConsentVersion])).rowCount;
}
async function view(client:PoolClient,venueId:string):Promise<ConsentView>{
 const row=(await client.query<{consented_at:Date}>(current,[venueId,translationConsentVersion])).rows[0];
 return {venueId,consented:!!row,consentedAt:row?row.consented_at.toISOString():null};
}
async function ownedVenue(client:PoolClient,accountId:string,venueId:string):Promise<{organisation_id:string}>{
 if(!uuid.test(venueId))fail('invalid_request');
 const row=(await client.query<{organisation_id:string}>(`SELECT v.organisation_id FROM venues v
  JOIN organisation_memberships m ON m.organisation_id=v.organisation_id AND m.account_id=$2 AND m.is_owner
  JOIN cloud_accounts a ON a.id=m.account_id AND a.disabled_at IS NULL
  JOIN cloud_credentials k ON k.account_id=m.account_id AND k.email_verified_at IS NOT NULL
  WHERE v.id=$1 FOR SHARE OF v,m`,[venueId,accountId])).rows[0];
 return row??fail('forbidden');
}
export async function listConsents(client:PoolClient,accountId:string):Promise<ConsentView[]>{
 const venues=(await client.query<{id:string}>(`SELECT v.id FROM venues v JOIN organisation_memberships m ON m.organisation_id=v.organisation_id
  WHERE m.account_id=$1 AND m.is_owner ORDER BY v.id`,[accountId])).rows;
 const out:ConsentView[]=[];
 for(const venue of venues)out.push(await view(client,venue.id));
 return out;
}
export async function agreeConsent(client:PoolClient,accountId:string,input:{venueId:string;consentVersion:string}):Promise<ConsentView>{
 if(input.consentVersion!==translationConsentVersion)fail('invalid_request');
 const venue=await ownedVenue(client,accountId,input.venueId);
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[input.venueId]);
 if(!await hasConsent(client,input.venueId)){
  await client.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1 AND withdrawn_at IS NULL',[input.venueId]);
  await client.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers) VALUES($1,$2,$3,$4,$5,$6)`,
   [randomUUID(),input.venueId,venue.organisation_id,accountId,translationConsentVersion,[...translationProviders]]);
 }
 return view(client,input.venueId);
}
export async function withdrawConsent(client:PoolClient,accountId:string,input:{venueId:string}):Promise<ConsentView>{
 await ownedVenue(client,accountId,input.venueId);
 await client.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1 AND withdrawn_at IS NULL',[input.venueId]);
 return view(client,input.venueId);
}
```

Add to `src/index.ts`:

```ts
export {agreeConsent,hasConsent,listConsents,translationConsentVersion,translationProviders,withdrawConsent,type ConsentView} from './consent.ts';
```

- [ ] **Step 3: Add the two checks**

`src/machine.ts`: import `{hasConsent}` from `./consent.ts`, and directly after the line `if(row.translation_state!=='ready')throw new InstallationError('permission_denied');` add:

```ts
    if(!await hasConsent(client,row.venue_id))fail('consent_required');
```

`src/worker.ts`: import `{hasConsent}` from `./consent.ts`; in `runOnce`, directly after `const {job,leaseId}=lease;`, add:

```ts
  if(!await transaction(this.#pool,client=>hasConsent(client,job.venue_id))){
   await this.#pool.query(`UPDATE translation_jobs SET state='failed',reason='consent_required',done=0,failed=total,finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL
    WHERE id=$1 AND lease_id=$2 AND state='running'`,[job.id,leaseId]);
   return true;
  }
```

- [ ] **Step 4: Run every changed test file and watch them pass.**

```bash
node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=60000 test/consent.test.ts test/machine.test.ts test/worker.test.ts test/worker-cli.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=60000 test/translation.test.ts test/translation-limits.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/translation packages/account-http/test
git commit -s -m "Require a venue owner's recorded consent to the three named language-model providers before a translation job is accepted or sent"
```

---

### Task 14: Consent — the account route

**Files:**
- Create: `packages/account-http/src/translation-consent.ts`, `packages/account-http/test/translation-consent.test.ts`
- Modify: `packages/account-http/src/app.ts` (dispatch beside the alerts route at `:139`)

**Interfaces:**
- Consumes: `agreeConsent`, `withdrawConsent`, `listConsents`, `TranslationError` (Tasks 1 and 13); `resolveSession` from `@waitron-cloud/identity`; `readAccountBody`, `readSessionCookie`, `AccountHttpError`.
- Produces: account route `GET|POST /api/account/translation-consent`. POST body `{"venueId":"<uuid>","choice":"agree","consentVersion":"providers-2026-10-14"}` or `{"venueId":"<uuid>","choice":"withdraw"}`. Both reply `{"consents":[{"venueId","consented","consentedAt"}]}` for every venue the account owns.

The route follows `alertPreferencesResponse` (`packages/account-http/src/alerts.ts`): a POST needs the portal `Origin` and the CSRF token; the session is resolved with `touch:false` before the rate rule, and resolved again inside the transaction before and after the change, so a session that ends while the write waits rolls it back. Rate rule `{scope:'translation-consent-account',subject:accountId,limit:30,windowSeconds:60}`.

- [ ] **Step 1: Write the failing tests**

`packages/account-http/test/translation-consent.test.ts`:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {connectedVenue,database,readyForTranslation} from '../../translation/test/fixtures.ts';
const origin='https://cloud.example.test';
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,addresses=0;
before(async()=>{db=await database();app=createAccountApp({translation:true,leaseIssuer:issuer,pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});});
after(async()=>db?.close());
const bindings=()=>({incoming:{socket:{remoteAddress:`192.0.2.${++addresses}`}}}) as HttpBindings;
type Session={token:string;csrfToken:string};
async function owner(){
 const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);
 return {v,session:await transaction(db.pool,c=>createSession(c,v.accountId)) as Session};
}
function consent(session:Session,body?:unknown,headers:Record<string,string>={}){
 return app.request(origin+'/api/account/translation-consent',{method:body===undefined?'GET':'POST',
  headers:{origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken,...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})},bindings());
}
const agree=(venueId:string)=>({venueId,choice:'agree',consentVersion:'providers-2026-10-14'});
const rows=async(venueId:string)=>(await db.pool.query('SELECT count(*)::integer AS n FROM translation_consents WHERE venue_id=$1',[venueId])).rows[0].n as number;
test('an owner lists, agrees and withdraws',async()=>{
 const {v,session}=await owner();
 assert.deepEqual(await (await consent(session)).json(),{consents:[{venueId:v.venueId,consented:false,consentedAt:null}]});
 const agreed=(await (await consent(session,agree(v.venueId))).json()) as {consents:{consented:boolean;consentedAt:string|null}[]};
 assert.equal(agreed.consents[0]!.consented,true);assert.ok(agreed.consents[0]!.consentedAt);
 const withdrawn=(await (await consent(session,{venueId:v.venueId,choice:'withdraw'})).json()) as {consents:{consented:boolean}[]};
 assert.equal(withdrawn.consents[0]!.consented,false);
});
test('a write needs the portal origin and the CSRF token',async()=>{
 const {v,session}=await owner();
 assert.equal((await consent(session,agree(v.venueId),{origin:'https://elsewhere.test'})).status,403);
 assert.equal((await consent(session,agree(v.venueId),{'x-csrf-token':'wrong'})).status,403);
 assert.equal(await rows(v.venueId),0);
});
test('a member who is not an owner sees no venues and cannot agree',async()=>{
 const {v}=await owner(),member=randomUUID();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[member]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,false,false)',[member,v.organisationId]);
 const session=await transaction(db.pool,c=>createSession(c,member)) as Session;
 assert.deepEqual(await (await consent(session)).json(),{consents:[]});
 assert.equal((await consent(session,agree(v.venueId))).status,403);
 assert.equal(await rows(v.venueId),0);
});
test('an unknown field, a bad choice, a missing or stray version, or a bad venue id is refused',async()=>{
 const {v,session}=await owner();
 for(const body of [{...agree(v.venueId),accountId:'x'},{...agree(v.venueId),choice:'maybe'},{venueId:v.venueId,choice:'agree'},
  {venueId:v.venueId,choice:'withdraw',consentVersion:'providers-2026-10-14'},{...agree(v.venueId),consentVersion:'providers-2026-01-01'},agree('not-a-venue')])
  assert.equal((await consent(session,body)).status,400,JSON.stringify(body));
 assert.equal(await rows(v.venueId),0);
});
test('a machine submit is refused until an owner agrees',async()=>{
 const {v,session}=await owner();
 const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']}],houseStyle:[]});
 const submit=()=>app.request(origin+'/api/installations/translation-submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v.submit(text))},bindings());
 const refused=await submit();
 assert.equal(refused.status,403);assert.deepEqual(await refused.json(),{error:'translation_consent_required'});
 assert.equal((await consent(session,agree(v.venueId))).status,200);
 assert.equal((await submit()).status,200);
});
```

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/translation-consent.test.ts` and watch it fail (404 for the route).

- [ ] **Step 2: Write `packages/account-http/src/translation-consent.ts`**

```ts
import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {agreeConsent,listConsents,TranslationError,withdrawConsent} from '@waitron-cloud/translation';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function translationConsentResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>}){
 const {pool,origin,consume}=options,write=c.req.method==='POST';
 if(!['GET','POST'].includes(c.req.method))throw new AccountHttpError(405,'method_not_allowed');
 if(write&&c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'';
 const proof={touch:false,...(write?{csrfToken:c.req.header('x-csrf-token')??''}:{})};
 const identity=await transaction(pool,client=>resolveSession(client,token,proof));
 await consume([{scope:'translation-consent-account',subject:identity.accountId,limit:30,windowSeconds:60}]);
 const body=write?await readAccountBody(c.req.raw,['venueId','choice'],['consentVersion']):undefined;
 if(body&&(!['agree','withdraw'].includes(body.choice!)||(body.choice==='agree')!==(body.consentVersion!==undefined)))throw new AccountHttpError(400,'invalid_input');
 try{
  return c.json(await transaction(pool,async client=>{
   const session=await resolveSession(client,token,proof);
   if(body?.choice==='agree')await agreeConsent(client,session.accountId,{venueId:body.venueId!,consentVersion:body.consentVersion!});
   else if(body)await withdrawConsent(client,session.accountId,{venueId:body.venueId!});
   const consents=await listConsents(client,session.accountId);
   await resolveSession(client,token,proof);return {consents};
  }));
 }catch(error){
  if(error instanceof TranslationError)throw new AccountHttpError(error.code==='forbidden'?403:400,error.code==='forbidden'?'forbidden':'invalid_input');
  throw error;
 }
}
```

`packages/account-http/src/app.ts`: import `{translationConsentResponse}` from `./translation-consent.ts`, and beside the alerts line at `:139` add `if(c.req.path==='/api/account/translation-consent')return translationConsentResponse(c,{pool,origin:config.portalOrigin,consume});`.

- [ ] **Step 3: Run the tests and watch them pass.** Same command as Step 1; expected: 5 passing.

- [ ] **Step 4: Commit**

```bash
git add packages/account-http
git commit -s -m "Let a venue owner agree to or withdraw menu translation through the account API, with the portal's browser checks"
```

---

### Task 15: The portal consent control (draft wording)

**Files:**
- Create: `apps/portal/src/translation-consent-controller.ts`, `src/translation-consent-screen.ts`, `apps/portal/test/translation-consent-controller.test.ts`
- Modify: `apps/portal/src/app.ts` (field, construction beside `this.alerts` at `:61`, the `pagehide` reset at `:87`, `#sessionChanged` at `:106-107`, the retry deadline at `:133`), `src/installation-screen.ts` (render the control per owned installation), `src/locale.ts` (English and Spanish copy), and the browser tests that answer every account route themselves: `apps/portal/test/session.test.ts:14,52` and `apps/portal/test/browser-failures.test.ts:92,129`

**Interfaces:**
- Consumes: `accountRequest`, `ApiResult` from `apps/portal/src/api.ts`; the route from Task 14.
- Produces: `TranslationConsentController` with `consents`, `loaded`, `pending`, `error`, `retryAt`, `waiting`, `account(id)`, `load()`, `agree(venueId)`, `withdraw(venueId)`, `consented(venueId):boolean`, built like `AlertController` (`apps/portal/src/alert-controller.ts`), including its generation fence and its 401/403 clearing; `translationConsentScreen(app,venueId)`.

**Where it lives.** The contract ("Consent") tells Waitron the control is on the portal's account page, `<Cloud origin>/account`, in the venue's entry, and Waitron's dialog links there. That page renders `installationScreen(app)` (`apps/portal/src/screens.ts:39-41`), which is why the control goes in `installation-screen.ts`, beside the owner-only `backupScreen`. Moving the control to another page is a contract change.

**The wording is draft.** The spec lists "The consent wording itself, in English and Spanish" as an open item. Use the text below, mark the PR description "consent wording awaits the owner", and change nothing else when the owner rewrites it:

- `translationConsent`: "Menu translation" / "Traducción del menú"
- `translationConsentHelp`: "Translate all sends this venue's menu names — staff names, customer-facing names and categories — to a language-model provider, which suggests names in your other languages. Waitron Cloud may use OpenAI, Anthropic or Google. Cloud deletes the names once your server has collected the suggestions, or after 24 hours. Staff names can hold anything typed into them, so keep personal details out of them." / "Traducir todo envía los nombres del menú de este local (nombres internos, nombres para clientes y categorías) a un proveedor de modelos de lenguaje, que sugiere nombres en tus otros idiomas. Waitron Cloud puede usar OpenAI, Anthropic o Google. Cloud borra los nombres cuando tu servidor ha recogido las sugerencias, o a las 24 horas. Los nombres internos pueden contener cualquier cosa que se escriba, así que no pongas datos personales en ellos."
- `translationConsentAgree`: "Allow menu translation" / "Permitir la traducción del menú"
- `translationConsentWithdraw`: "Stop menu translation" / "Dejar de traducir el menú"
- `translationConsentOn`: "Menu translation is allowed for this venue." / "La traducción del menú está permitida en este local."
- `translationConsentUncertain`: "We could not confirm your choice. Try again." / "No hemos podido confirmar tu elección. Vuelve a intentarlo."

- [ ] **Step 1: Write the failing controller test**

`apps/portal/test/translation-consent-controller.test.ts`, modelled on `apps/portal/test/alert-controller.test.ts`:

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';
import type {ApiResult} from '../src/api.ts';
const venueId='12345678-1234-4234-8234-123456789abc';
const listed=(consented:boolean)=>({ok:true as const,value:{consents:[{venueId,consented,consentedAt:consented?'2026-10-14T10:00:00.000Z':null}]}});
test('an account change fences a pending reply and clears what is shown',async()=>{
 let finish!:(v:ApiResult<unknown>)=>void;
 const c=new TranslationConsentController(()=>{},<T>()=>new Promise<ApiResult<T>>(r=>{finish=r as typeof finish;}));
 c.account('one');const loading=c.load();c.account('two');finish(listed(true) as ApiResult<unknown>);await loading;
 assert.equal(c.consented(venueId),false);assert.equal(c.loaded,false);assert.equal(c.pending,false);
});
test('agree and withdraw send the contract bodies and show the answer',async()=>{
 const calls:{path:string;body?:Record<string,unknown>}[]=[];let on=false;
 const c=new TranslationConsentController(()=>{},async<T>(path:string,body?:Record<string,unknown>):Promise<ApiResult<T>>=>{
  calls.push({path,...(body?{body}:{})});if(body)on=body.choice==='agree';return listed(on) as ApiResult<T>;});
 c.account('one');await c.load();assert.equal(c.consented(venueId),false);
 await c.agree(venueId);
 assert.deepEqual(calls.at(-1),{path:'/translation-consent',body:{venueId,choice:'agree',consentVersion:'providers-2026-10-14'}});
 assert.equal(c.consented(venueId),true);
 await c.withdraw(venueId);
 assert.deepEqual(calls.at(-1),{path:'/translation-consent',body:{venueId,choice:'withdraw'}});
 assert.equal(c.consented(venueId),false);
});
test('an unanswered agree is reported as uncertain, a refused session clears the choice, and a limit is kept across accounts',async()=>{
 let mode='ok';
 const c=new TranslationConsentController(()=>{},async<T>():Promise<ApiResult<T>>=>mode==='ok'?listed(true) as ApiResult<T>
  :{ok:false,status:mode==='expired'?401:mode==='limited'?429:503,code:'x',retryAfterMs:mode==='limited'?60000:0});
 c.account('one');await c.load();assert.equal(c.consented(venueId),true);
 mode='down';await c.agree(venueId);assert.equal(c.error,'translationConsentUncertain');assert.equal(c.consented(venueId),true);
 mode='expired';await c.load();assert.equal(c.error,'pairSession');assert.equal(c.consented(venueId),false);assert.equal(c.loaded,false);
 mode='limited';await c.load();assert.equal(c.error,'limited');c.account('two');mode='ok';await c.load();assert.equal(c.loaded,false);assert.ok(c.waiting>0);
});
```

- [ ] **Step 2: Run it and watch it fail** — `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/translation-consent-controller.test.ts`; expected: FAIL, cannot find the controller module.

- [ ] **Step 3: Implement the controller, the screen fragment and the copy**

`apps/portal/src/translation-consent-controller.ts`:

```ts
import {accountRequest,type ApiResult} from './api.ts';
import type {Copy} from './locale.ts';
export const translationConsentVersion='providers-2026-10-14';
export interface TranslationConsent {venueId:string;consented:boolean;consentedAt:string|null}
export class TranslationConsentController {
 consents:TranslationConsent[]=[];loaded=false;pending=false;error:keyof Copy|undefined;retryAt=0;
 #account:string|undefined;#generation=0;readonly #changed:()=>void;readonly #request:typeof accountRequest;
 constructor(changed:()=>void,request:typeof accountRequest=accountRequest){this.#changed=changed;this.#request=request;}
 account(id:string|undefined){if(this.#account!==id){this.#account=id;this.#generation++;this.#clear();this.pending=false;this.error=undefined;}}
 #clear(){this.consents=[];this.loaded=false;}
 get waiting(){return Math.max(0,Math.ceil((this.retryAt-Date.now())/1000));}
 consented(venueId:string){return this.consents.some(c=>c.venueId===venueId&&c.consented);}
 async load(){await this.#perform(undefined);}
 async agree(venueId:string){await this.#perform({venueId,choice:'agree',consentVersion:translationConsentVersion});}
 async withdraw(venueId:string){await this.#perform({venueId,choice:'withdraw'});}
 async #perform(body:Record<string,unknown>|undefined){
  if(!this.#account||this.pending||this.waiting)return;
  const generation=this.#generation;this.pending=true;this.error=undefined;this.#changed();
  const result=await this.#request<{consents:TranslationConsent[]}>('/translation-consent',body);
  if(generation!==this.#generation)return;this.pending=false;
  if(result.ok){this.consents=result.value.consents;this.loaded=true;}
  else this.#failure(result,body!==undefined);
  this.#changed();
 }
 #failure(result:Extract<ApiResult<unknown>,{ok:false}>,write:boolean){
  this.retryAt=Math.max(this.retryAt,Date.now()+result.retryAfterMs);
  if(result.status===401||result.status===403)this.#clear();
  this.error=result.status===429?'limited':result.status===401?'pairSession':result.status===403?'forbidden':write?'translationConsentUncertain':'unavailable';
 }
}
```

`apps/portal/src/translation-consent-screen.ts` (the heading level matches `backupScreen`'s `h4` inside the installation's `article`):

```ts
import {html,nothing} from 'lit';
import type {PortalApp} from './app.ts';
export function translationConsentScreen(app:PortalApp,venueId:string){
 const t=app.translationConsent,c=app.copy,on=t.consented(venueId),disabled=t.pending||!!t.waiting||!t.loaded;
 return html`<section aria-label=${c.translationConsent}><h4>${c.translationConsent}</h4><p class="help">${c.translationConsentHelp}</p>
  ${t.error?html`<p role="alert">${c[t.error]}</p>`:nothing}
  ${on?html`<p role="status">${c.translationConsentOn}</p>`:nothing}
  <wt-button .disabled=${disabled} @click=${()=>{void (on?t.withdraw(venueId):t.agree(venueId));}}>${on?c.translationConsentWithdraw:c.translationConsentAgree}</wt-button></section>`;
}
```

`apps/portal/src/installation-screen.ts`: import `translationConsentScreen` and, directly after `${i.canRevoke?backupScreen(app,i.venueId):nothing}`, add `${i.canRevoke?translationConsentScreen(app,i.venueId):nothing}`. `canRevoke` is the owner flag `listWithSession` sets.

`apps/portal/src/app.ts`:
- import `{TranslationConsentController}` from `./translation-consent-controller.ts`; add the field `translationConsent: TranslationConsentController;` beside `alerts`;
- after `this.alerts = new AlertController(() => this.draw());` at `:61`: `this.translationConsent = new TranslationConsentController(() => this.draw());`
- in the `pagehide` handler at `:87`, beside `this.alerts.account(undefined);`: `this.translationConsent.account(undefined);`
- in `#sessionChanged`, after the two alerts lines at `:106-107`:
  `this.translationConsent.account(state.kind === 'authenticated' ? state.accountId : undefined);`
  `if (['/account','/'].includes(this.path) && state.kind === 'authenticated' && !this.translationConsent.loaded) void this.translationConsent.load();`
- in the deadline at `:133`, add `this.translationConsent.retryAt` beside `this.alerts.retryAt`.

`apps/portal/src/locale.ts`: add the six keys above to `en` (beside `alertsUncertain` at `:163`) and to `es` (beside `:426`), with the English and Spanish text given.

The browser tests that answer every account route themselves now see one more request. Beside each `/alerts` answer add a `/translation-consent` one returning `{consents:[]}`, in that test's own style:
- `apps/portal/test/session.test.ts:14`: `if (path.endsWith('/translation-consent')) { await route.fulfill({json:{consents:[]}}); return; }`
- `apps/portal/test/session.test.ts:52`: `if(route.request().url().endsWith('/translation-consent')) {await route.fulfill({json:{consents:[]}});return;}`
- `apps/portal/test/browser-failures.test.ts:92`: `if (path.endsWith('/translation-consent')) return route.fulfill({json: {consents: []}});`
- `apps/portal/test/browser-failures.test.ts:129`: `await page.route('**/api/account/translation-consent',route=>route.fulfill({json:{consents:[]}}));`

- [ ] **Step 4: Run the controller test, `test/locale.test.ts`, `test/static.test.ts`, `test/session.test.ts`, `test/browser-failures.test.ts` and `test/installation-browser.test.ts`** with `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 <files>`, after `pnpm --filter @waitron-cloud/portal build`. The browser files run real headless Chromium: check free memory first (`memory_pressure | grep free`).

- [ ] **Step 5: Commit**

```bash
git add apps/portal
git commit -s -m "Let a venue owner allow or stop menu translation from the portal, with draft English and Spanish wording that awaits the owner"
```

---

### Task 16: Keep every three-service reader at three

Do this before Task 17 adds the rows: with no `content_translation` rows yet, every change here is invisible to existing tests, and each new test inserts the row itself.

**Files:**
- Modify: `packages/registration/src/monitoring.ts:18,34,163`, `src/email-outbox.ts:198`, `src/installations.ts:44-59` (`view`), `src/index.ts:241-247` (`RegistrationStore.configuration`), `packages/operations/src/status.ts:60`, `packages/account-http/src/diagnostics.ts:20-24`, `src/venue-overview.ts:17,19`
- Create: `packages/registration/test/content-translation-readers.test.ts`, `packages/account-http/test/content-translation-readers.test.ts`, `packages/operations/test/content-translation-readers.test.ts`

**Interfaces:**
- Produces: in every listed query, an installation counts as having a service only through the three original services, and every service list shown to the portal or returned by `RegistrationStore.configuration` holds the three original services. `InstallationStore`'s `view(client,id)` gains a third parameter `servicesVersion:1|2=1` (used in Task 17; `services` is already the name of a local in `view`).

The contract ("Seeing the service") states this rule, so Waitron relies on it: a ready `content_translation` never makes a venue monitored, alerted or shown with services.

Why: these queries ask "does this installation have any service switched on?" (`s.state<>'unconfigured'`) to decide whether to monitor a venue, send it alerts, or count it in operations status. Translation is on for every installation, so without this change every connected venue would start being monitored and alerted. The portal's validators also require exactly three services (`apps/portal/src/installation-types.ts:16`, `diagnostic-types.ts:22`).

- [ ] **Step 1: Write the failing tests**

`packages/registration/test/content-translation-readers.test.ts` (setup copied from `test/monitoring.test.ts:15-26`, without switching `remote_access` on):

```ts
import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {createSession} from '@waitron-cloud/identity';
import {database} from '../../account-http/test/fixtures.ts';
import {EmailWorker,InstallationStore,RegistrationStore,SignupStore,createLeaseIssuer,transaction} from '../src/index.ts';
import {MonitorWorker} from '../src/monitoring.ts';
let db:Awaited<ReturnType<typeof database>>,owner:{accountId:string;organisationId:string;legalBusinessId:string},venue:{installationId:string;venueId:string},installationKey:string;
const original=['continuous_backup','remote_access','retained_snapshots'];
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('readers@example.test');
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 owner=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 installationKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey,localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());venue=await r.complete(binding);
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'content_translation','ready')
  ON CONFLICT (installation_id,service) DO UPDATE SET state='ready'`,[venue.installationId]);
 await db.pool.query("INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,true,'en')",[owner.accountId]);
});
const remote=(state:string)=>db.pool.query("UPDATE installation_services SET state=$2 WHERE installation_id=$1 AND service='remote_access'",[venue.installationId,state]);
const silent=async()=>{await db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '901 seconds' WHERE id=$1",[venue.installationId]);await db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');};
const alerts=async()=>(await db.pool.query("SELECT status FROM email_outbox WHERE kind='service_alert'")).rows.map(r=>r.status as string);
test('a venue with only translation ready is not scheduled for monitoring',async()=>{
 assert.equal(await new MonitorWorker(db.pool,db.outbox).schedule(),0);
});
test('a monitored venue whose original services all stop raises no alert because translation is ready',async()=>{
 const monitor=new MonitorWorker(db.pool,db.outbox);
 await remote('ready');assert.equal(await monitor.schedule(),1);
 await remote('unconfigured');await silent();await monitor.runOnce();
 assert.deepEqual(await alerts(),[]);
});
test('a queued alert is cancelled at delivery once only translation is ready',async()=>{
 const monitor=new MonitorWorker(db.pool,db.outbox),sent:unknown[]=[];
 await remote('ready');await monitor.schedule();await silent();await monitor.runOnce();
 assert.equal((await alerts()).length,1);
 await remote('unconfigured');
 const worker=new EmailWorker(db.pool,db.outbox,{async sendVerification(){},async sendPasswordReset(){},async sendPasswordChanged(){},async sendServiceAlert(message:unknown){sent.push(message);}});
 for(let n=0;n<20&&await worker.runOnce();n++);
 assert.equal(sent.length,0);assert.deepEqual(await alerts(),['cancelled']);
});
test('the configuration reply and the account listing show the three original services',async()=>{
 assert.deepEqual((await new RegistrationStore(db.pool).configuration(installationKey)).services.map(s=>s.service),original);
 const session=await transaction(db.pool,c=>createSession(c,owner.accountId));
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const listed=await new InstallationStore(db.pool,issuer,'https://cloud.example.test').listWithSession(session.token);
 assert.deepEqual(listed[0]!.services.map(s=>s.service),original);
});
```

`packages/account-http/test/content-translation-readers.test.ts` (setup shaped like `test/diagnostics.test.ts:17-32`):

```ts
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createSession} from '@waitron-cloud/identity';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';
const origin='https://cloud.example.test',bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
const original=['continuous_backup','remote_access','retained_snapshots'];
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,installation:string,session:{token:string;csrfToken:string};
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 const owner=randomUUID(),organisation=randomUUID(),business=randomUUID(),venue=randomUUID();installation=randomUUID();
 await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[owner]);
 await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Sol')",[organisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Sol SL','ES')",[business,organisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'readers-key')",[installation,venue]);
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'continuous_backup','unconfigured'),($1,'remote_access','unconfigured'),
  ($1,'retained_snapshots','unconfigured'),($1,'content_translation','ready')`,[installation]);
 await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true)',[owner,organisation]);
 session=await transaction(db.pool,c=>createSession(c,owner));
 // The installation routes answer 503 without a lease issuer (`src/installations.ts:15`).
 const leaseIssuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 app=createAccountApp({pool:db.pool,outbox:db.outbox,leaseIssuer,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
});
const headers=()=>({origin,'content-type':'application/json',cookie:'__Host-cloud_session='+session.token,'x-csrf-token':session.csrfToken});
test('diagnostics list the three original services and report monitoring off when only translation is ready',async()=>{
 const response=await app.request(origin+'/api/account/diagnostics/read',{method:'POST',headers:headers(),body:JSON.stringify({installationId:installation})},bindings);
 assert.equal(response.status,200,await response.clone().text());
 const body=(await response.json()) as {installation:{services:{service:string}[];monitoring:{enabled:boolean}}};
 assert.deepEqual(body.installation.services.map(s=>s.service),original);assert.equal(body.installation.monitoring.enabled,false);
});
test('the installation overview lists the three original services and reports monitoring off',async()=>{
 const response=await app.request(origin+'/api/account/installations',{headers:headers()},bindings);
 assert.equal(response.status,200,await response.clone().text());
 const body=(await response.json()) as {installations:{services:{service:string}[];monitoring:{enabled:boolean}}[]};
 assert.deepEqual(body.installations[0]!.services.map(s=>s.service),original);assert.equal(body.installations[0]!.monitoring.enabled,false);
});
```

`packages/operations/test/content-translation-readers.test.ts` (shaped like `test/status.test.ts:17-27,77-89`):

```ts
import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {operationsStatus} from '../src/status.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{await resetSchema(db.pool);await db.pool.query('UPDATE usage_reconciliation_sources SET last_attempted_at=clock_timestamp(),caught_up_at=clock_timestamp()');});
test('a venue with only translation ready is not a monitoring target',async()=>{
 const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID();
 await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Sol')",[organisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Sol SL','ES')",[business,organisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'readers-key')",[installation,venue]);
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'continuous_backup','unconfigured'),($1,'remote_access','unconfigured'),
  ($1,'retained_snapshots','unconfigured'),($1,'content_translation','ready')`,[installation]);
 const server=createServer((request,response)=>{response.setHeader('content-type','application/json');
  response.end(request.url==='/api/health/live'?'{"status":"live"}':'{"status":"ready"}');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:`http://127.0.0.1:${address.port}`});
  assert.deepEqual([snapshot.components.monitoring.state,snapshot.components.monitoring.code],['ready','no_targets']);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
```

- [ ] **Step 2: Run each file and watch it fail.**

```bash
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/content-translation-readers.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/content-translation-readers.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/operations exec node --test --test-timeout=30000 test/content-translation-readers.test.ts
```

Expected: every case fails — `schedule` returns 1, an alert is queued, or queued and then sent, four services are listed, monitoring is reported on, and operations counts a target.

- [ ] **Step 3: Add the filter to every listed query**

Exact edits (`s.service<>'content_translation'` beside the existing `s.state<>'unconfigured'`):

- `packages/registration/src/monitoring.ts:18`: `AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.state<>'unconfigured')` becomes `AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.state<>'unconfigured' AND s.service<>'content_translation')`.
- `monitoring.ts:34`: `"SELECT service FROM installation_services WHERE installation_id=$1 AND state<>'unconfigured'"` becomes `"SELECT service FROM installation_services WHERE installation_id=$1 AND state<>'unconfigured' AND service<>'content_translation'"`.
- `monitoring.ts:163` and `packages/registration/src/email-outbox.ts:198`: in `EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=n.id AND s.state<>'unconfigured'`, append ` AND s.service<>'content_translation'` after `'unconfigured'`.
- `packages/registration/src/installations.ts`: `view` becomes `async function view(client:PoolClient,id:string,servicesVersion:1|2=1):Promise<InstallationView>`, its services query's `WHERE s.installation_id=$1 ORDER BY s.service` becomes `WHERE s.installation_id=$1 AND ($2::integer=2 OR s.service<>'content_translation') ORDER BY s.service`, and that query's parameters `[id]` become `[id,servicesVersion]`.
- `packages/registration/src/index.ts:245`: `JOIN installation_services s ON s.installation_id = i.id` becomes `JOIN installation_services s ON s.installation_id = i.id AND s.service <> 'content_translation'`.
- `packages/operations/src/status.ts:60`: `EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.state<>'unconfigured')` becomes `EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.state<>'unconfigured' AND s.service<>'content_translation')`.
- `packages/account-http/src/diagnostics.ts:23`: `WHERE s.installation_id=$1 ORDER BY s.service` becomes `WHERE s.installation_id=$1 AND s.service<>'content_translation' ORDER BY s.service`; `:24`: `AND s.state<>'unconfigured') AS enabled` becomes `AND s.state<>'unconfigured' AND s.service<>'content_translation') AS enabled`.
- `packages/account-http/src/venue-overview.ts:17` and `:19`: in each `EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=n.id AND s.state<>'unconfigured'`, append ` AND s.service<>'content_translation'` after `'unconfigured'`.

Then check nothing was missed: `git grep -n "unconfigured'" -- 'packages/*/src/*.ts'` must show, for every query that reads `installation_services` without naming one service, the `content_translation` filter beside it. The remaining lines name one service (`service='remote_access'`, `'retained_snapshots'`) or are the state lists in `installations.ts`.

The filters at `monitoring.ts:34` and `:163` cover for each other. Measured on 2026-10-14, on a scratch copy holding this plan's code: with the filter removed at `:34` alone, or at `:163` alone, all four registration cases still passed; with both removed, "a monitored venue whose original services all stop raises no alert" failed. So that case pins the pair, not either one; keep both.

The overview's incident-query filter is also masked: `venue-overview.ts` empties the
incident list whenever monitoring is off. Removing that filter alone leaves the five
HTTP cases passing; removing it together with the monitor-enabled filter fails the
incident-list assertion. The case protects the visible reply and the pair, not that
SQL predicate on its own. Keep both filters.

- [ ] **Step 4: Run the three new files plus the existing suites the edited queries serve:** `test/monitoring.test.ts`, `test/monitoring-quiet.test.ts`, `test/email-outbox.test.ts`, `test/installations.test.ts`, `test/pairing.test.ts`, `test/registration.test.ts` (registration); `test/diagnostics.test.ts`, `test/installations.test.ts` (account-http); `test/status.test.ts` (operations).
- [ ] **Step 5: Commit**

```bash
git add packages/registration packages/account-http packages/operations
git commit -s -m "Count only remote access and backups when deciding whether a venue is monitored, alerted or shown with services, so menu translation does not switch those on"
```

---

### Task 17: Migration 041 — the fourth service, and the configuration reply's servicesVersion 2

> **Migration numbers are conditional:** follow the [append-only rule](2026-10-16-translation-collect-pages.md#current-migrations-and-push-policy).
> Recheck the directory and `migrationNames`; the 041 filenames/counts/indices below must follow
> the actual next number after Task 2, without changing any landed migration.

**Files:**
- Create: `packages/registration/migrations/041_content_translation_service.sql`, `packages/registration/test/content-translation-service.test.ts`
- Modify: `packages/registration/src/migrate.ts`, `src/index.ts:218-219` (registration inserts four rows), `packages/backups/src/replacement.ts:98` (replacement inserts four rows), `packages/registration/src/installations.ts:17,25-27,77,105` (`InstallationView`, `readBody` accepts the version-2 configuration body; `execute` passes it to `view`), and the tests this breaks (Step 4)

**Interfaces:**
- Produces: every installation has a `content_translation` row with `state='ready'`; a `configuration` request whose signed body is exactly `{"servicesVersion":2}` gets four services, among them `{service:'content_translation',state:'ready',configuration:{},health:'unknown',failure:null,observedAt:null}`, and `{}` keeps getting three. Any other configuration body stays `invalid_proof`, as today. Services are matched by name; `view` lists them ordered by name.

- [ ] **Step 1: Write the failing tests**

`packages/registration/test/content-translation-service.test.ts`:

```ts
import {resetSchema} from './fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign,type KeyObject} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,beforeEach,test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {InstallationStore,RegistrationStore,SignupStore,createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '../src/index.ts';
const origin='https://cloud.example.test',original=['continuous_backup','remote_access','retained_snapshots'];
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
let db:Awaited<ReturnType<typeof database>>,venue:{installationId:string;venueId:string},key:KeyObject;
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('fourth@example.test');
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password:'A sufficiently long password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const pair=generateKeyPairSync('ed25519');key=pair.privateKey;
 const r=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url'),
  localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await r.start(binding);await r.approveCloud(binding,owner.accountId);await r.approveLocal(binding,randomUUID());venue=await r.complete(binding);
});
function proof(action:MachineAction,body:unknown,operationId=randomUUID(),lease?:SignedEnvelope):SignedEnvelope{
 const payload=encodeMachine({origin,action,installationId:venue.installationId,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});
 return {payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url')};
}
const services=async()=>(await db.pool.query('SELECT service,state FROM installation_services WHERE installation_id=$1 ORDER BY service',[venue.installationId])).rows;
test('a new installation has the three original services unconfigured and translation ready',async()=>{
 assert.deepEqual(await services(),[{service:'content_translation',state:'ready'},{service:'continuous_backup',state:'unconfigured'},
  {service:'remote_access',state:'unconfigured'},{service:'retained_snapshots',state:'unconfigured'}]);
});
test("041's backfill gives an installation that lacks translation one ready row, once",async()=>{
 await db.pool.query("DELETE FROM installation_services WHERE installation_id=$1 AND service='content_translation'",[venue.installationId]);
 const sql=await readFile(new URL('../migrations/041_content_translation_service.sql',import.meta.url),'utf8');
 await db.pool.query(sql);await db.pool.query(sql);
 assert.deepEqual((await services()).filter(s=>s.service==='content_translation'),[{service:'content_translation',state:'ready'}]);
});
test('configuration answers three services to {} and four to servicesVersion 2, replays a retry, and refuses any other body',async()=>{
 const store=new InstallationStore(db.pool,issuer,origin),lease=(await store.execute('renew',proof('renew',{}))).lease!;
 assert.deepEqual((await store.execute('configuration',proof('configuration',{},randomUUID(),lease))).services.map(s=>s.service),original);
 const op=randomUUID(),four=await store.execute('configuration',proof('configuration',{servicesVersion:2},op,lease));
 assert.deepEqual(four.services.map(s=>s.service).sort(),[...original,'content_translation'].sort());
 assert.deepEqual(four.services.find(s=>s.service==='content_translation'),{service:'content_translation',state:'ready',configuration:{},health:'unknown',failure:null,observedAt:null});
 assert.deepEqual(await store.execute('configuration',proof('configuration',{servicesVersion:2},op,lease)),four);
 for(const body of [{servicesVersion:3},{servicesVersion:'2'},{servicesVersion:2,extra:true},{version:2}])
  await assert.rejects(store.execute('configuration',proof('configuration',body,randomUUID(),lease)),/invalid_proof/,JSON.stringify(body));
 assert.deepEqual((await store.execute('renew',proof('renew',{}))).services.map(s=>s.service),original);
 const report={revision:0,observedAt:Date.now(),services:[{service:'remote_access',health:'healthy',failure:null}]};
 assert.deepEqual((await store.execute('report',proof('report',report,randomUUID(),lease))).services.map(s=>s.service),original);
});
```

Run: `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-timeout=120000 test/content-translation-service.test.ts` and watch it fail (three rows, and `{"servicesVersion":2}` refused as `invalid_proof`).

- [ ] **Step 2: Write the migration and the inserts**

`packages/registration/migrations/041_content_translation_service.sql`:

```sql
INSERT INTO installation_services(installation_id,service,state)
 SELECT id,'content_translation','ready' FROM installations
 ON CONFLICT (installation_id,service) DO NOTHING;
```

Append `'041_content_translation_service.sql'` to `migrationNames`.

`packages/registration/src/index.ts:218-219`: the insert becomes

```ts
          await client.query(`INSERT INTO installation_services (installation_id, service, state)
            VALUES ($1, 'remote_access', 'unconfigured'), ($1, 'continuous_backup', 'unconfigured'), ($1, 'retained_snapshots', 'unconfigured'), ($1, 'content_translation', 'ready')`, [installation.id]);
```

`packages/backups/src/replacement.ts:98`: the insert becomes

```ts
   await client.query("INSERT INTO installation_services(installation_id,service,state) VALUES($1,'remote_access','unconfigured'),($1,'continuous_backup','unconfigured'),($1,'retained_snapshots','unconfigured'),($1,'content_translation','ready')",[installationId]);
```

- [ ] **Step 3: Accept the version-2 configuration body**

`packages/registration/src/installations.ts`: give `readBody` (`:25`) the return type `Report|{servicesVersion:2}|undefined`, and replace its line `if(action!=='report'){if(text!=='{}')fail('invalid_proof');return;}` (`:27`) with:

```ts
  if(action==='configuration'&&text==='{"servicesVersion":2}')return {servicesVersion:2};
  if(action!=='report'){if(text!=='{}')fail('invalid_proof');return;}
```

`InstallationView`'s service entries (`:17`) can now name the fourth service: change that line to `services:({service:Service|'content_translation';state:State;configuration:Record<string,unknown>;health:Health;failure:Failure|null;observedAt:string|null})[];` (no code under `packages/*/src` reads `.services` outside this file, checked with `git grep -n "\.services\b" -- 'packages/*/src/*.ts'` on 2026-10-14). `DesiredService`, which `configure` accepts, keeps the three names.

In `execute`, the `report` it reads at `:77` is now `const body=readBody(action,c.body,now),report=body&&'revision' in body?body:undefined;`, and the view at `:105` becomes `const result=await view(client,row.id,body&&'servicesVersion' in body?2:1);`. The stored operation result (`installation_operations`) is that view, so a retry replays it unchanged.

- [ ] **Step 4: Fix the tests this migration breaks**

- `packages/registration/test/registration.test.ts:79` (40 before Task 17) becomes `assert.equal(migrationNames.length,41);`, and keep the existing `migrationNames[39]` check for `040_translation_result_json.sql`, and add `assert.equal(migrationNames[40],'041_content_translation_service.sql');`.
- `packages/translation/test/result-storage-upgrade.test.ts` pins 41 migrations, preserves the 040 name/digest checks and adds the 041 name. Its manifest guard accepts 41 and refuses both 40 and 42; all retained-job, interruption, outcome and text assertions stay unchanged.
- `packages/registration/test/installations.test.ts:95`: `'6'` becomes `'8'` (two installations, four rows each).
- `packages/backups/test/replacement.test.ts:63`: the line `const states=(await db.pool.query('SELECT * FROM installation_services WHERE installation_id=$1',[result.registration.installationId])).rows;assert.equal(states.length,3);assert(states.every(s=>s.state!=='ready'));` becomes:

```ts
 const states=(await db.pool.query('SELECT * FROM installation_services WHERE installation_id=$1',[result.registration.installationId])).rows;
 const originalStates=states.filter(s=>s.service!=='content_translation');assert.equal(originalStates.length,3);assert(originalStates.every(s=>s.state!=='ready'));
 assert.deepEqual(states.filter(s=>s.service==='content_translation').map(s=>s.state),['ready']);
```

- `packages/fiscal-allocation/test/schema.test.ts` `oldState` (`:25-38`): the upgrade now adds a `content_translation` row to every existing installation, so read `installation_services` without those rows: change the row query to

```ts
        `SELECT to_jsonb(t) AS value FROM "${tablename}" t${tablename === 'installation_services' ? " WHERE t.service <> 'content_translation'" : ''} ORDER BY to_jsonb(t)::text`,
```

  and, in `'populated release37 upgrades concurrently without changing any old row or digest'`, after the `deepEqual` of the two states, add `assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM installations i WHERE NOT EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.service='content_translation' AND s.state='ready')")).rows[0].n, 0);`.
- `packages/registration/test/monitoring-quiet.test.ts:132` copies the current schema's `installation_services` rows into a release-36 schema, whose check refuses `content_translation`. Change the copy line to `for(const table of tables)await client.query('INSERT INTO '+legacy.schema+'.'+table+' SELECT * FROM '+table+(table==='installation_services'?" WHERE service<>'content_translation'":''));` — the test's `migrate(legacy.pool)` then backfills the row through 041.

- [ ] **Step 5: Run** the new file, then `test/installations.test.ts`, `test/registration.test.ts`, `test/pairing.test.ts`, `test/monitoring-quiet.test.ts`, `test/content-translation-readers.test.ts` (registration), `packages/backups/test/replacement.test.ts`, `packages/fiscal-allocation/test/schema.test.ts`, and `packages/account-http/test/translation.test.ts` (its `readyForTranslation` call is now a no-op upsert and stays).
- [ ] **Step 6: Commit**

```bash
git add packages/registration packages/backups packages/fiscal-allocation/test
git commit -s -m "Switch menu translation on for every connected installation and show it as a fourth service only to a box that asks with servicesVersion 2"
```

---

### Task 18: The retention sweep, in the worker and the account server, and no names in any log

> **Authoritative replacement:** [paging amendment, Task 18 row and behavioral checks](2026-10-16-translation-collect-pages.md#implement-inline-with-failing-behavioral-tests-first).
> Walk and durably store all pages before release in the log test. Add release/expiry-between-pages
> and repeat-collect retention checks; retain the existing deletion schedule and privacy assertions.

**Files:**
- Create: `packages/translation/src/retention.ts`, `test/retention.test.ts`, `test/no-names-in-logs.test.ts`, `packages/account-http/test/translation-sweep.test.ts`
- Modify: `packages/translation/src/worker-cli.ts` (schedule the sweep), `src/index.ts`, `packages/account-http/src/server-cli.ts` (sweep when `CLOUD_TRANSLATION=1`)

**Interfaces:**
- Produces: `export async function sweepTranslationJobs(pool:Pool,limit=100):Promise<{expired:number}>`.

The sweep, in one transaction per call, at most `limit` jobs (a whole number from 1 to 1,000), `FOR UPDATE SKIP LOCKED`:
- a `done`, `partly_done` or `failed` job whose `finished_at` is 24 hours old or more: delete its body row, set `state='expired'`;
- a `queued` or `running` job whose `created_at` is 24 hours old or more: delete its body row, set `state='expired'`, clear its lease. The spec states this case ("A job that never finishes (no worker ran for a day) is swept 24 hours after it was submitted"); it is Review Focus 5.

It runs in two places, so that menus are deleted even when no worker runs at all (the worker's Compose service sits behind an optional profile, Task 19):
- the worker command runs it through `runWorkerLoop`'s `schedule` option every 60 seconds, and once before `--once`;
- the account server, when `CLOUD_TRANSLATION=1`, runs it once before it starts listening and then every 60 seconds, with the fixed line `Account server translation cleanup failed` on stderr when a pass fails. Both may run at once: `SKIP LOCKED` keeps them off each other's rows, and expiring a job twice changes nothing.

- [ ] **Step 1: Write the failing sweep tests**

`packages/translation/test/retention.test.ts`:

```ts
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {collectJob,createJob,createOpenAiClient,jobFingerprint,lockVenue,parseJob,readJob,sweepTranslationJobs,TranslationError,TranslationWorker,writtenItems} from '../src/index.ts';
import {connectedVenue,database,giveConsent} from './fixtures.ts';
import {echoFirstPass,startFakeOpenAi} from './fake-openai.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
type Venue=Awaited<ReturnType<typeof connectedVenue>>;
async function aged(v:Venue,state:string,age:string){
 const id=randomUUID(),finished=['done','partly_done','failed','collected'].includes(state);
 const reason=state==='partly_done'?'provider_failed':state==='failed'?'provider_unavailable':null;
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,reason,total,done,provider,model,prompt_version,lease_id,lease_until,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,10,$6,$7,1,0,'openai','gpt-6-luna','translate-all-v1',CASE WHEN $6='running' THEN gen_random_uuid() END,CASE WHEN $6='running' THEN clock_timestamp()+interval '1 minute' END,
   clock_timestamp()-$8::interval,CASE WHEN $9 THEN clock_timestamp()-$8::interval END)`,[id,v.installationId,v.venueId,randomUUID(),'a'.repeat(64),state,reason,age,finished]);
 if(state!=='collected')await db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'{}')",[id]);
 return id;
}
const look=async(id:string)=>(await db.pool.query('SELECT j.state,j.lease_id,(SELECT count(*)::integer FROM translation_job_bodies b WHERE b.job_id=j.id) AS bodies FROM translation_jobs j WHERE j.id=$1',[id])).rows[0];
async function drain(){while((await sweepTranslationJobs(db.pool)).expired>0);}
test('a finished job keeps its body for 24 hours, then loses it, expires, and can no longer be collected',async()=>{
 const v=await connectedVenue(db,issuer,origin),kept=await aged(v,'done','23 hours 59 minutes'),gone=await aged(v,'done','24 hours');
 const partly=await aged(v,'partly_done','25 hours'),failed=await aged(v,'failed','25 hours');
 await drain();
 assert.deepEqual(await look(kept),{state:'done',lease_id:null,bodies:1});
 for(const id of [gone,partly,failed])assert.deepEqual(await look(id),{state:'expired',lease_id:null,bodies:0});
 await assert.rejects(transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,gone))),(e:unknown)=>e instanceof TranslationError&&e.code==='expired');
});
test('a job that never finished expires 24 hours after it was submitted, with its lease cleared',async()=>{
 const a=await connectedVenue(db,issuer,origin),b=await connectedVenue(db,issuer,origin),c=await connectedVenue(db,issuer,origin);
 const queued=await aged(a,'queued','24 hours'),running=await aged(b,'running','25 hours'),young=await aged(c,'queued','23 hours');
 await drain();
 for(const id of [queued,running])assert.deepEqual(await look(id),{state:'expired',lease_id:null,bodies:0});
 assert.deepEqual(await look(young),{state:'queued',lease_id:null,bodies:1});
});
test('a collected job is left alone, and the limit bounds one pass',async()=>{
 const v=await connectedVenue(db,issuer,origin),collected=await aged(v,'collected','30 hours');
 await drain();assert.equal((await look(collected)).state,'collected');
 for(let n=0;n<3;n++)await aged(v,'done','25 hours');
 assert.deepEqual(await sweepTranslationJobs(db.pool,2),{expired:2});
 assert.deepEqual(await sweepTranslationJobs(db.pool,2),{expired:1});
 await assert.rejects(sweepTranslationJobs(db.pool,0),/translation_sweep_limit/);
});
test('a worker that loses its job to the sweep stops without writing',async()=>{
 // The worker leases the oldest open job, so the young queued job from the test above is closed first.
 await db.pool.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE state IN ('queued','running')");
 const v=await connectedVenue(db,issuer,origin);await giveConsent(db,v);
 const text=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},
  items:[{ref:'product:1',kind:'product',family:'product:1',category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']}],houseStyle:[]});
 const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);
  return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(text),body:text,total:writtenItems(parseJob(text)).length});});
 const fake=await startFakeOpenAi(async r=>{
  await db.pool.query("UPDATE translation_jobs SET created_at=created_at-interval '25 hours' WHERE id=$1",[job.id]);
  await sweepTranslationJobs(db.pool);
  return echoFirstPass(r);
 });
 try{
  assert.equal(await new TranslationWorker(db.pool,createOpenAiClient({apiKey:'k',baseUrl:fake.baseUrl}),{wait:async()=>{}}).runOnce(new AbortController().signal),true);
  assert.deepEqual(await look(job.id),{state:'expired',lease_id:null,bodies:0});
  assert.equal(fake.requests.length,1);
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM usage_events WHERE source_reference=$1',[job.id])).rows[0].n,0);
 }finally{await fake.close();}
});
```

`packages/account-http/test/translation-sweep.test.ts` proves the account server deletes menus with no worker process running; it starts the server command the way `test/server.test.ts:133-147` does:

```ts
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
const issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),issuer=createLeaseIssuer(issuerKey);
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
function server(overrides:NodeJS.ProcessEnv){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
 const child=spawn(process.execPath,[new URL('../src/server-cli.ts',import.meta.url).pathname],{env:{...process.env,
  DATABASE_URL:url.href,CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_HTTP_RATE_KEY:db.rateKey,CLOUD_PORTAL_ORIGIN:'http://localhost',
  CLOUD_HTTP_PORT:'0',CLOUD_HTTP_HOST:'127.0.0.1',NODE_ENV:'test',CLOUD_HTTP_TRUSTED_PROXY_IPS:'',CLOUD_INSTALLATION_ISSUER_KEY:issuerKey,...overrides},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exited=once(child,'exit');const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);void exited.finally(()=>clearTimeout(deadline));
 return {async listening(){const end=Date.now()+10000;while(!stdout.includes('\n')){assert.equal(child.exitCode,null,stderr);if(Date.now()>end)throw new Error('no listening line');await delay(20);}},
  async stop(){child.kill('SIGTERM');await exited;return {stdout,stderr};}};
}
async function finished(v:{installationId:string;venueId:string},age:string){
 const id=randomUUID();
 await db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,done,provider,model,prompt_version,created_at,finished_at)
  VALUES($1,$2,$3,$4,$5,10,'done',1,1,'openai','gpt-6-luna','translate-all-v1',clock_timestamp()-$6::interval,clock_timestamp()-$6::interval)`,[id,v.installationId,v.venueId,randomUUID(),'a'.repeat(64),age]);
 await db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'{}')",[id]);
 return id;
}
const look=async(id:string)=>(await db.pool.query('SELECT j.state,(SELECT count(*)::integer FROM translation_job_bodies b WHERE b.job_id=j.id) AS bodies FROM translation_jobs j WHERE j.id=$1',[id])).rows[0];
test('with translation on, the account server deletes an expired menu before it listens, with no worker running',async()=>{
 const v=await connectedVenue(db,issuer,'http://localhost'),stale=await finished(v,'25 hours'),recent=await finished(v,'1 hour');
 const off=server({CLOUD_TRANSLATION:'0'});await off.listening();await off.stop();
 assert.deepEqual(await look(stale),{state:'done',bodies:1});
 const on=server({CLOUD_TRANSLATION:'1'});
 try{
  await on.listening();
  assert.deepEqual(await look(stale),{state:'expired',bodies:0});
  assert.deepEqual(await look(recent),{state:'done',bodies:1});
 }finally{const out=await on.stop();assert.equal(out.stderr,'');}
});
```

Run both files and watch them fail:

```bash
node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=60000 test/retention.test.ts
node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=60000 test/translation-sweep.test.ts
```

- [ ] **Step 2: Implement the sweep**

`packages/translation/src/retention.ts`:

```ts
import type {Pool} from 'pg';
import {transaction} from '@waitron-cloud/registration';
export async function sweepTranslationJobs(pool:Pool,limit=100):Promise<{expired:number}>{
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('translation_sweep_limit');
 return transaction(pool,async client=>{
  const ids=(await client.query<{id:string}>(`SELECT id FROM translation_jobs
   WHERE (state IN ('done','partly_done','failed') AND finished_at<=clock_timestamp()-interval '24 hours')
    OR (state IN ('queued','running') AND created_at<=clock_timestamp()-interval '24 hours')
   ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit])).rows.map(r=>r.id);
  if(!ids.length)return {expired:0};
  await client.query('DELETE FROM translation_job_bodies WHERE job_id=ANY($1::uuid[])',[ids]);
  await client.query("UPDATE translation_jobs SET state='expired',lease_id=NULL,lease_until=NULL WHERE id=ANY($1::uuid[])",[ids]);
  return {expired:ids.length};
 });
}
```

Add to `src/index.ts`: `export {sweepTranslationJobs} from './retention.ts';`

`packages/translation/src/worker-cli.ts`: import `{sweepTranslationJobs}` from `./retention.ts`; change the `--once` branch to `if(args[0]==='--once'){await sweepTranslationJobs(pool);await worker.runOnce(stop.signal);}`, and add `schedule:sweepUntilReady,` to the `runWorkerLoop({…})` options.
The callback retries a failed sweep without taking new jobs: print the fixed line
`Translation worker cleanup failed; retrying`, wait 60 seconds with the shutdown signal,
then retry until success or shutdown. Do not fall through to work after a failed sweep or
retry cleanup at the loop's one-second polling rate. A failed `--once` cleanup exits 1.
The enabled account command also requires successful startup cleanup before listening;
its scheduled cleanup failures retain the fixed retry behavior below.

`packages/account-http/src/server-cli.ts`: import `{sweepTranslationJobs}` from `@waitron-cloud/translation`; add `let sweep: ReturnType<typeof setInterval> | undefined;` beside `cleanup` at `:11`, and `clearInterval(sweep);` beside each `clearInterval(cleanup)` (`:18` and `:63`). Directly before the `running = await startAccountServer(…)` line (`:43`), add `if (translation) await sweepTranslationJobs(pool);`, and after the rate-limit `cleanup` interval (`:53`):

```ts
    let sweeping = false;
    if (translation) {
      sweep = setInterval(async () => {
        if (sweeping || stopRequested) return;
        sweeping = true;
        try {await sweepTranslationJobs(pool!);} catch {console.error('Account server translation cleanup failed');}
        finally {sweeping = false;}
      }, 60000); sweep.unref();
    }
```

- [ ] **Step 3: Run both files and watch them pass.** Same commands as Step 1; expected: 4 and 1 passing. Rerun `packages/translation/test/worker-cli.test.ts` and `packages/account-http/test/server.test.ts`.

- [ ] **Step 4: Write the log test**

`packages/translation/test/no-names-in-logs.test.ts` starts the fake OpenAI server, the account server command with `CLOUD_TRANSLATION=1`, and the worker command; submits a job whose staff names, existing names and house-style names are unique sentinels; lets the fake fail one batch with a 500 whose body echoes the request, and answer the other with names that are also sentinels; polls status until the job finishes, collects and releases. Then neither process's output may hold a sentinel, the key, or the word `Bearer`. It stops only the two child processes it started.

```ts
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {connectedVenue,database,giveConsent,readyForTranslation} from './fixtures.ts';
import {emptyReview,isReview,responsesBody,startFakeOpenAi,type FakeRequest} from './fake-openai.ts';
const origin='http://localhost',apiKey='sk-private-test-key';
const issuerKey=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),issuer=createLeaseIssuer(issuerKey);
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
function child(script:URL,env:NodeJS.ProcessEnv){
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
 const proc=spawn(process.execPath,[script.pathname],{env:{...process.env,DATABASE_URL:url.href,...env},stdio:['ignore','pipe','pipe']});
 const output={stdout:'',stderr:''};proc.stdout.on('data',chunk=>{output.stdout+=chunk;});proc.stderr.on('data',chunk=>{output.stderr+=chunk;});
 const exited=once(proc,'exit');
 return {output,async stop(){if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGTERM');await exited;return output;}};
}
function post(port:number,action:string,body:unknown){
 return new Promise<{status:number;body:string}>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,path:`/api/installations/${action}`,method:'POST',headers:{host:'localhost','content-type':'application/json'}},res=>{
   let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve({status:res.statusCode!,body:text}));});
  req.on('error',reject);req.end(JSON.stringify(body));
 });
}
const rows=(r:FakeRequest)=>JSON.parse(r.body.input.slice(r.body.input.indexOf('Products:\n')+'Products:\n'.length)) as {id:string}[];
test('neither the account server nor the worker writes a name, the key or an authorisation header to its output',async()=>{
 const fake=await startFakeOpenAi(r=>{
  if(isReview(r))return emptyReview();
  if(r.body.input.includes('SENTINEL-STAFF-FAIL'))return {status:500,headers:{'retry-after':'0'},raw:r.body.input};
  const products=rows(r).map(p=>({id:p.id,ca:`SENTINEL-NAME-${p.id}-ca`,es:`SENTINEL-NAME-${p.id}-es`,placeholder:false,corrections:[]}));
  return {json:responsesBody(JSON.stringify({products}))};
 });
 const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);await giveConsent(db,v);
 const server=child(new URL('../../account-http/src/server-cli.ts',import.meta.url),{CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),
  CLOUD_HTTP_RATE_KEY:db.rateKey,CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_PORT:'0',CLOUD_HTTP_HOST:'127.0.0.1',NODE_ENV:'test',CLOUD_HTTP_TRUSTED_PROXY_IPS:'',
  CLOUD_INSTALLATION_ISSUER_KEY:issuerKey,CLOUD_TRANSLATION:'1'});
 const worker=child(new URL('../src/worker-cli.ts',import.meta.url),{CLOUD_OPENAI_API_KEY:apiKey,CLOUD_OPENAI_BASE_URL:fake.baseUrl});
 let failure:unknown;
 try{
  for(let n=0;n<500&&!server.output.stdout.includes('\n');n++)await delay(20);
  const port=JSON.parse(server.output.stdout.trim().split('\n')[0]!).port as number;
  const item=(ref:string,category:string,staffName:string)=>({ref,kind:'product',family:ref,category,staffName,existing:{en:`SENTINEL-EXISTING-${ref}`},missing:['ca','es']});
  const items=[...Array.from({length:60},(_,i)=>item(`ok:${i}`,'A',`SENTINEL-STAFF-OK-${i}`)),...Array.from({length:60},(_,i)=>item(`bad:${i}`,'B',`SENTINEL-STAFF-FAIL-${i}`))];
  const job=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es','en']},items,
   houseStyle:[{kind:'product',staffName:'SENTINEL-HOUSE',names:{ca:'SENTINEL-HOUSE-CA'}}]});
  const submitted=await post(port,'translation-submit',v.submit(job));assert.equal(submitted.status,200,submitted.body);
  const {jobId}=JSON.parse(submitted.body) as {jobId:string},reference=(action:string)=>v.proof(action,{version:1,jobId},randomUUID(),v.lease);
  let state='queued';
  for(let n=0;n<25&&(state==='queued'||state==='running');n++){await delay(1000);state=JSON.parse((await post(port,'translation-status',reference('translation-status'))).body).state;}
  assert.equal(state,'partly_done');
  assert.equal((await post(port,'translation-collect',reference('translation-collect'))).status,200);
  assert.equal((await post(port,'translation-release',reference('translation-release'))).status,200);
 }catch(error){failure=error;}
 const outputs=[await worker.stop(),await server.stop()];await fake.close();
 if(failure)throw failure;
 const text=outputs.map(o=>o.stdout+o.stderr).join('\n');
 for(const secret of ['SENTINEL',apiKey,'Bearer'])assert.equal(text.includes(secret),false,secret);
});
```

- [ ] **Step 5: Run it, then prove it can fail.** `node scripts/test-postgres.mjs exec pnpm --dir packages/translation exec node --test --test-timeout=60000 test/no-names-in-logs.test.ts` should pass on the first run, because nothing logs. To show it can fail, temporarily add `console.error(call.input)` as the first line of `respond` in `src/openai-client.ts`, run it and watch it fail on `SENTINEL`, then remove the line and run it green again. Say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/translation packages/account-http
git commit -s -m "Delete a job's menu and results 24 hours after it finished, or after it was submitted if it never finished, from the worker and from the account server whenever translation is on, and prove neither writes a name to its output (checked by adding a deliberate log line and watching the test fail)"
```

---

### Task 19: Compose service, local stack role, configuration example, CI selection and docs

> **Status wording:** Step 5's historical contract-status replacement is superseded by the
> [paging amendment's joint gates](2026-10-16-translation-collect-pages.md#joint-qualification-and-release-gates).
> Update implementation status only from actual current-head evidence. A Cloud package check
> does not establish Waitron paging, joint qualification, owner quality approval or go-live.

**Files:**
- Modify: `compose.yaml` (service `translation-worker`; `CLOUD_TRANSLATION` on `account` at `:95`), `deploy/local-stack/runtime.mjs:26-41` (`commands.translation`, the `translation` role, `CLOUD_TRANSLATION` on the `account` role), `deploy/local-stack/runtime.test.mjs`, `deploy/local-stack/compose-contract.test.mjs:6,10,21-22,28`, `.env.example`, `packages/translation/README.md`, `packages/account-http/README.md` (section "Installation access and status"), `docs/usage-metering.md`, `docs/launch-evidence.md` (the provider table near `:84`), `docs/waitron-integration-contract.md` (status line under "Translate all, version 1"), `docs/product-and-platform.md` (service table), `README.md`

**Interfaces:**
- Produces: `docker compose --profile translation up translation-worker` runs the worker in the local stack; the account service receives `CLOUD_TRANSLATION`.

- [ ] **Step 1: Write the failing compose and runtime tests**

`deploy/local-stack/compose-contract.test.mjs`:
- `:6`: the configuration read enables the new profile too: `execFileSync('docker',['compose','--profile','backups','--profile','remote-reconciliation','--profile','translation','config','--format','json'],{encoding:'utf8'})`. Without it, `docker compose config` leaves the profiled service out and the assertions below cannot see it.
- `:10`: add `'translation-worker'` to `required`.
- after `:22`, add:

```js
 const worker=services['translation-worker'];
 assert.deepEqual(worker.profiles,['translation']);
 assert.equal(worker.depends_on.migrate.condition,'service_completed_successfully');
 assert.deepEqual(worker.command,['node','deploy/local-stack/runtime.mjs','translation']);
 assert.ok('CLOUD_OPENAI_API_KEY' in worker.environment);assert.ok('CLOUD_TRANSLATION' in services.account.environment);
 // The resolved values depend on the caller's environment and .env file, so the source text pins where they come from.
 const source=readFileSync(new URL('../../compose.yaml',import.meta.url),'utf8');
 assert.match(source,/CLOUD_OPENAI_API_KEY: \$\{CLOUD_OPENAI_API_KEY:-\}/);assert.match(source,/CLOUD_TRANSLATION: \$\{CLOUD_TRANSLATION:-0\}/);
```

- `:28`: add `'translation-worker'` to the list of services that must mount `/run/local-stack`.

`deploy/local-stack/runtime.test.mjs`, beside `'only account receives an explicitly enabled staff certificate exchange'`:

```js
test('the translation role receives the database and only the provider settings the caller set',async()=>{
 const {config}=await configured();
 assert.deepEqual(Object.keys(runtimeEnvironment('translation',config)),['DATABASE_URL']);
 const env=runtimeEnvironment('translation',config,{CLOUD_OPENAI_API_KEY:'sk-local',CLOUD_OPENAI_BASE_URL:'http://127.0.0.1:4010/v1',UNRELATED_SECRET:'private',CLOUD_EMAIL_KEYS:'foreign'});
 assert.deepEqual(Object.keys(env).sort(),['CLOUD_OPENAI_API_KEY','CLOUD_OPENAI_BASE_URL','DATABASE_URL']);
 for(const role of ['migrate','account','email','monitor','usage','probe','backup','gateway','manifest','reconcile'])
  assert.equal(runtimeEnvironment(role,config,{CLOUD_OPENAI_API_KEY:'sk-local'}).CLOUD_OPENAI_API_KEY,undefined,role);
});
test('only account receives an explicitly supplied translation switch',async()=>{
 const {config}=await configured();
 assert.equal(runtimeEnvironment('account',config).CLOUD_TRANSLATION,undefined);
 assert.equal(runtimeEnvironment('account',config,{CLOUD_TRANSLATION:'1'}).CLOUD_TRANSLATION,'1');
 assert.equal(runtimeEnvironment('translation',config,{CLOUD_TRANSLATION:'1'}).CLOUD_TRANSLATION,undefined);
});
```

Also add `translation:{DATABASE_URL:database}` to the `expected` map of `'runtime roles receive only their explicit configuration'` (`:12-24`), using that test's own `database` value.

- [ ] **Step 2: Run** `node --test deploy/local-stack/compose-contract.test.mjs deploy/local-stack/runtime.test.mjs` and watch them fail (no such service or role). The compose test needs Docker's command-line tool on the machine, as it does today.

- [ ] **Step 3: Implement.** In `compose.yaml`, after `remote-reconciler`:

```yaml
  translation-worker:
    <<: *cloud
    command: ["node", "deploy/local-stack/runtime.mjs", "translation"]
    profiles: [translation]
    environment:
      CLOUD_OPENAI_API_KEY: ${CLOUD_OPENAI_API_KEY:-}
      CLOUD_OPENAI_BASE_URL: ${CLOUD_OPENAI_BASE_URL:-}
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped
    stop_grace_period: 15s
```

and under the `account` service's `environment`, after `CLOUD_STAFF_CERTIFICATES` (`:95`): `CLOUD_TRANSLATION: ${CLOUD_TRANSLATION:-0}`.

In `deploy/local-stack/runtime.mjs`: add `translation:['packages/translation/src/worker-cli.ts']` to `commands` (`:26-31`); add `...(environment.CLOUD_TRANSLATION!==undefined?{CLOUD_TRANSLATION:environment.CLOUD_TRANSLATION}:{})` to the `account` role beside its `CLOUD_STAFF_CERTIFICATES` entry (`:37`); and add the role

```js
  translation:{DATABASE_URL,...Object.fromEntries(['CLOUD_OPENAI_API_KEY','CLOUD_OPENAI_BASE_URL'].filter(name=>environment[name]!==undefined).map(name=>[name,environment[name]]))},
```

The profile keeps the worker out of the default stack, which has no provider key; `scripts/verify-local-stack-receipt.test.mjs`'s healthy-service list therefore does not change. The account server still deletes menus 24 hours after a job finished, or was submitted, with no worker running (Task 18).

`.env.example` gains, after the installation issuer block:

```sh
# Menu translation (Translate all). The account API serves the machine routes, and deletes
# finished or abandoned menus after 24 hours, only with CLOUD_TRANSLATION=1; the worker
# needs DATABASE_URL and an OpenAI API key.
# CLOUD_TRANSLATION=0
# CLOUD_OPENAI_API_KEY=<from your deployment's secret store; never commit it>
# Only for a local fake server: https, or http on 127.0.0.1 or localhost.
# CLOUD_OPENAI_BASE_URL=
```

- [ ] **Step 4: Check CI selects the package.** `scripts/ci-scope.mjs` discovers workspace members through `pnpm ls -r`, and Tasks 1 and 11 updated its pins; confirm with `node --test scripts/ci-scope.test.mjs scripts/ci-plan.test.mjs scripts/ci-workflow.test.mjs`. On the pull request, read the `changes` job's `package_matrix` output and confirm it lists `@waitron-cloud/translation`, and that its package job ran `node scripts/test-postgres.mjs --filter @waitron-cloud/translation test` on the current head. `quality/` is outside `test/*.test.ts`, so CI never runs it.

- [ ] **Step 5: Write the docs.** `packages/translation/README.md`: what the package does; how to run the worker locally (`pnpm translation:worker`) and in the local stack (`docker compose --profile translation up translation-worker`); the configuration variables; the fixed log lines (`Translation worker failed; check database, migrations and provider configuration`, `Translation worker pass failed; retrying`, `Translation worker cleanup failed; retrying`, `Translation worker database connection failed`); the cap and its overshoot (at most the batches already sent when the cap is reached); retention, and that the account server sweeps too when `CLOUD_TRANSLATION=1`. Task 21 adds the quality harness section. `packages/account-http/README.md`: the four routes, the consent route, submit's limits and its own admission (4 in flight, 1 per address), and the sweep, linking to the contract rather than restating it. `docs/usage-metering.md`: the four translation measures and that they are recorded when a job finishes, not reconciled. `docs/launch-evidence.md`: a row for menu translation naming OpenAI, Anthropic and Google as candidate processors, `store: false`, the quoted 30-day abuse-monitoring retention, and the open questions the spec lists (EU processing, Zero Data Retention, key custody). The contract's "Designed 2026-10-14; not implemented." becomes "Cloud side implemented on <date>; Waitron side pending." Keep every claim to what a test in this plan runs.
- [ ] **Step 6: Run** the compose and runtime tests again, `node --test scripts/ci-scope.test.mjs`, and `git diff --check`.
- [ ] **Step 7: Commit**

```bash
git add compose.yaml deploy .env.example packages/translation/README.md packages/account-http/README.md docs README.md
git commit -s -m "Run the translation worker as an optional Compose service, document its configuration and routes, and record the language-model providers among the open data-protection decisions"
```

---

### Task 20: Quality harness — the graded sets and the scorer

**Files:**
- Create under `packages/translation/quality/`:
  - `original/` — verbatim copies, as the record of the 2026-10-14 trial, not run: `trial.py`, `test_trial.py`, `batch_trial.py`, `test_batch_trial.py`, `build_grading.py`
  - `data/tuning-products.json` (copy of `products.json`), `data/blind-products.json` (copy of `products-final.json`)
  - `data/tuning-grades/*.json` (copy of `owner-grades/grades/`, 110 files), `data/blind-grades/*.json` (copy of `owner-grades-final/grades/`, 31 files)
  - `data/tuning-shown.json` (copy of `grading-keys.json`), `data/blind-shown.json` (copy of `grading-keys-final.json`)
  - `data/trial-results/tuning/luna-low-v4+luna-medium-{1,2,3}.json` (copies of `results/…`) and `data/trial-results/blind/luna-low-v4+luna-medium-{1,2,3}.json` (copies of `results-final/…`): the fourth prompt with the Luna review, the setup this service ships
  - `grading.template.html` (verbatim copy)
  - `scorer.ts`, `scorer.test.ts`
  - `.gitignore` containing `results/` and `grading*` (files the harness writes)
- Modify: `packages/translation/package.json` (scripts `"quality:test": "node --test quality/*.test.ts"`, `"quality:score": "node quality/scorer.ts"`)

Source: `/Users/clintongormley/workspace/experiments/llm-translate/`. Read every file before copying. The grade files are `{"lang","pid","text","verdict"}` with `verdict` `fix` (shown as "needs work") or `wrong`; each file is named `key(pid,lang,text)`, the first 16 hex characters of SHA-1 over `pid\x1flang\x1ftext` (`build_grading.py`, `key`; all 141 files checked on 2026-10-14). An unmarked name the owner was shown counts as accepted, so the scorer needs the shown sets: `grading-keys.json` (347 shown names, 26 of them corrections) and `grading-keys-final.json` (153, 8 of them corrections), each `{key:{pid,lang,text,runs}}`; without them the scorer cannot tell "accepted" from "never shown".

Why the shown sets matter: a new prompt writes names the owner never saw. The trial's `grade_run` counts an unseen name as accepted. The port reports those names separately as **ungraded**, never as good.

**Interfaces:**
- Produces (`quality/scorer.ts`):
  - `export type SetName='tuning'|'blind'; export const languages=['ca','es','en'] as const;`
  - `export interface Product {id:string;internal:string;category:string|null;existing?:Record<string,string>;kind?:TranslationKind;family?:string}` — `kind` and `family` are absent in the two trial sets (every name there is a product heading its own family); Task 24's set of other kinds sets them.
  - `export interface GradedSet {products:Product[];grades:Map<string,'fix'|'wrong'>;shown:Set<string>}`
  - `export interface Score {names:number;fix:number;wrong:number;ungraded:number;ungradedNames:{pid:string;lang:string;text:string}[]}`
  - `export function gradeKey(pid:string,lang:string,text:string):string`
  - `export function loadSet(name:SetName):GradedSet`
  - `export function gradeRun(names:Record<string,Record<string,unknown>>,set:GradedSet):Score` — counts written names that differ from the given ones, as `grade_run` does, and counts an unmarked name the owner was never shown as ungraded.
  - `export function addScores(a:Score,b:Score):Score; export function scoreLine(label:string,s:Score):string` — a Markdown table row: label, names, needs work %, wrong %, marked % (needs work plus wrong, the share the spec's table reports), ungraded.
  - The command `node quality/scorer.ts --set tuning|blind <results files…>` prints the table, one row per file and a total, then one `ungraded: <pid> <lang> <text>` line per ungraded name. A results file is any JSON object with `names` keyed by product id, which both the trial's records and Task 21's are.

- [x] **Step 1: Copy the files** listed above with `cp`, then `diff -r` each copied directory against its source, and `cmp` each single file, to show they are byte-identical. Copy grades with `cp owner-grades/grades/*.json packages/translation/quality/data/tuning-grades/` (and the same for the blind set) so the directory holds only the grade files.
- [x] **Step 2: Write the failing scorer tests**

`quality/scorer.test.ts` ports `test_trial.py`'s `Grading` class and pins the port against the original script's own counts:

```ts
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {test} from 'node:test';
import {addScores,gradeKey,gradeRun,loadSet,scoreLine,type GradedSet,type Score} from './scorer.ts';
const shownFile=(name:'tuning'|'blind')=>JSON.parse(readFileSync(new URL(`./data/${name}-shown.json`,import.meta.url),'utf8')) as Record<string,{pid:string;lang:string;text:string}>;
test('the copied grades all decode to their own file names',()=>{
 for(const name of ['tuning','blind'] as const){
  const dir=new URL(`./data/${name}-grades/`,import.meta.url);
  for(const file of readdirSync(dir)){const g=JSON.parse(readFileSync(new URL(file,dir),'utf8'));assert.equal(gradeKey(g.pid,g.lang,g.text)+'.json',file);}
 }
});
test('the sets have the sizes the trial graded',()=>{
 const tuning=loadSet('tuning'),blind=loadSet('blind');
 assert.deepEqual([tuning.products.length,tuning.grades.size,tuning.shown.size],[32,110,347]);
 assert.deepEqual([blind.products.length,blind.grades.size,blind.shown.size],[30,31,153]);
});
test("grade_run's own case: marks count by verdict and a kept given name is skipped",()=>{
 const set:GradedSet={products:[{id:'p01',internal:'X',category:'X'},{id:'p27',internal:'Y',category:'X',existing:{en:'Given'}}],
  grades:new Map([[gradeKey('p01','en','C'),'wrong'],[gradeKey('p27','es','E'),'fix']]),
  shown:new Set(['A','B','C','D','E'].map((t,i)=>gradeKey(i<3?'p01':'p27',['ca','es','en','ca','es'][i]!,t)))};
 const got=gradeRun({p01:{ca:'A',es:'B',en:'C'},p27:{ca:'D',es:'E',en:'Given'}},set);
 assert.deepEqual([got.names,got.fix,got.wrong,got.ungraded],[5,1,1,0]);
});
test('a name never shown is ungraded, not accepted',()=>{
 const set=loadSet('blind'),p=set.products[0]!;
 const got=gradeRun({[p.id]:{ca:'A name nobody has seen',es:'',en:''}},set);
 assert.deepEqual([got.names,got.fix,got.wrong,got.ungraded],[1,0,0,1]);
 assert.deepEqual(got.ungradedNames,[{pid:p.id,lang:'ca',text:'A name nobody has seen'}]);
});
test('a shown and unmarked name is accepted, and a marked one counts by its verdict',()=>{
 const set=loadSet('tuning'),given=(pid:string,lang:string)=>set.products.find(p=>p.id===pid)?.existing?.[lang];
 const entries=Object.entries(shownFile('tuning')).filter(([,v])=>v.lang!=='fix'&&v.text!==given(v.pid,v.lang));
 const [markedKey,marked]=entries.find(([k])=>set.grades.has(k))!;
 const [,accepted]=entries.find(([k,v])=>!set.grades.has(k)&&(v.pid!==marked.pid||v.lang!==marked.lang))!;
 const names:Record<string,Record<string,string>>={};
 for(const v of [marked,accepted])(names[v.pid]??={})[v.lang]=v.text;
 const got=gradeRun(names,set),verdict=set.grades.get(markedKey)!;
 assert.deepEqual([got.names,got.ungraded,got[verdict],got.fix+got.wrong],[2,0,1,1]);
});
test("rescoring the trial's fourth prompt with the Luna review gives grade_run's counts",()=>{
 // Counts from the original: grade_run over the same three files for each set, run with python3 -I on 2026-10-14.
 for(const [name,expected] of [['tuning',{names:252,fix:6,wrong:10}],['blind',{names:243,fix:5,wrong:6}]] as const){
  const set=loadSet(name),dir=new URL(`./data/trial-results/${name}/`,import.meta.url);
  let total:Score={names:0,fix:0,wrong:0,ungraded:0,ungradedNames:[]};
  for(const file of readdirSync(dir).sort())total=addScores(total,gradeRun(JSON.parse(readFileSync(new URL(file,dir),'utf8')).names,set));
  assert.deepEqual([total.names,total.fix,total.wrong,total.ungraded],[expected.names,expected.fix,expected.wrong,0]);
 }
});
test('a score line shows the shares the spec reports',()=>{
 assert.equal(scoreLine('total',{names:252,fix:6,wrong:10,ungraded:0,ungradedNames:[]}),'| total | 252 | 2% | 4% | 6% | 0 |');
 assert.equal(scoreLine('total',{names:243,fix:5,wrong:6,ungraded:0,ungradedNames:[]}),'| total | 243 | 2% | 2% | 5% | 0 |');
});
```

The expected counts and percentages come from running the original script on 2026-10-14: `TRIAL_SET= python3 -I trial.py score` printed `| luna-low-v4+luna-medium | 3 | 84 | 2% | 4% | 6% | …` for the tuning set and `TRIAL_SET=final python3 -I trial.py score` printed `| luna-low-v4+luna-medium | 3 | 81 | 2% | 2% | 5% | …` for the blind set; `grade_run` over the three files gave 84+84+84 names with 3+0+3 needing work and 4+2+4 wrong (tuning), and 83+80+80 names with 3+1+1 and 3+0+3 (blind). The spec's table reports the marked share: 6% (4% wrong) and 5% (2% wrong).

- [x] **Step 3: Run** `pnpm --dir packages/translation quality:test` and watch it fail (cannot find `./scorer.ts`).
- [x] **Step 4: Implement `scorer.ts`**

```ts
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {TranslationKind} from '../src/index.ts';
export type SetName='tuning'|'blind';
export const languages=['ca','es','en'] as const;
export interface Product {id:string;internal:string;category:string|null;existing?:Record<string,string>;kind?:TranslationKind;family?:string}
export interface GradedSet {products:Product[];grades:Map<string,'fix'|'wrong'>;shown:Set<string>}
export interface Score {names:number;fix:number;wrong:number;ungraded:number;ungradedNames:{pid:string;lang:string;text:string}[]}
const data=new URL('./data/',import.meta.url);
export function gradeKey(pid:string,lang:string,text:string){return createHash('sha1').update(`${pid}\u001f${lang}\u001f${text}`,'utf8').digest('hex').slice(0,16);}
export function loadSet(name:SetName):GradedSet{
 const products=JSON.parse(readFileSync(new URL(`${name}-products.json`,data),'utf8')) as Product[];
 const dir=new URL(`${name}-grades/`,data),grades=new Map<string,'fix'|'wrong'>();
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.json')).sort()){
  const g=JSON.parse(readFileSync(new URL(file,dir),'utf8')) as {pid:string;lang:string;text:string;verdict:'fix'|'wrong'};
  grades.set(gradeKey(g.pid,g.lang,g.text),g.verdict);
 }
 return {products,grades,shown:new Set(Object.keys(JSON.parse(readFileSync(new URL(`${name}-shown.json`,data),'utf8'))))};
}
export function gradeRun(names:Record<string,Record<string,unknown>>,set:GradedSet):Score{
 const out:Score={names:0,fix:0,wrong:0,ungraded:0,ungradedNames:[]};
 for(const p of set.products){
  const got=names[p.id]??{},given=p.existing??{};
  for(const lang of languages){
   const value=got[lang],text=typeof value==='string'?value.trim():'';
   if(!text||text===given[lang])continue;
   out.names++;
   const key=gradeKey(p.id,lang,text),verdict=set.grades.get(key);
   if(verdict)out[verdict]++;
   else if(!set.shown.has(key)){out.ungraded++;out.ungradedNames.push({pid:p.id,lang,text});}
  }
 }
 return out;
}
export function addScores(a:Score,b:Score):Score{
 return {names:a.names+b.names,fix:a.fix+b.fix,wrong:a.wrong+b.wrong,ungraded:a.ungraded+b.ungraded,ungradedNames:[...a.ungradedNames,...b.ungradedNames]};
}
const percent=(part:number,whole:number)=>whole?`${Math.round(part/whole*100)}%`:'-';
export function scoreLine(label:string,s:Score){return `| ${label} | ${s.names} | ${percent(s.fix,s.names)} | ${percent(s.wrong,s.names)} | ${percent(s.fix+s.wrong,s.names)} | ${s.ungraded} |`;}
function main(args:string[]){
 const at=args.indexOf('--set'),name=args[at+1];
 if(at<0||(name!=='tuning'&&name!=='blind'))throw new Error('usage: node quality/scorer.ts --set tuning|blind <results files…>');
 const files=args.filter((_,i)=>i!==at&&i!==at+1),set=loadSet(name);
 let total:Score={names:0,fix:0,wrong:0,ungraded:0,ungradedNames:[]};
 console.log('| run | names | needs work | wrong | marked | ungraded |');console.log('|---|---|---|---|---|---|');
 for(const file of files){const s=gradeRun(JSON.parse(readFileSync(file,'utf8')).names,set);total=addScores(total,s);console.log(scoreLine(basename(file),s));}
 console.log(scoreLine('total',total));
 for(const n of total.ungradedNames)console.log(`ungraded: ${n.pid} ${n.lang} ${n.text}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2));
```

`Math.round` rounds a half up where Python's `:.0%` rounds a half to even; no share in these sets falls on a half.

- [x] **Step 5: Run the tests and watch them pass.** `pnpm --dir packages/translation quality:test`; expected: 7 passing. Then, from `packages/translation`, run the command on the copied trial files and keep its output for the commit message: `pnpm quality:score --set tuning quality/data/trial-results/tuning/*.json` (total row `| total | 252 | 2% | 4% | 6% | 0 |`) and the same with `blind` (`| total | 243 | 2% | 2% | 5% | 0 |`).
- [x] **Step 6: Typecheck** with `pnpm --dir packages/translation typecheck`.
- [x] **Step 7: Commit**

```bash
git add packages/translation/quality packages/translation/package.json
git commit -s -m "Move the translation trial's graded sets and the owner's grades into the repository, with a scorer that reports names the owner has not seen as ungraded; rescoring the trial's fourth prompt with the Luna review gives the original script's counts"
```

---

### Task 21: Quality harness — the trial runner and the grading page

**Files:**
- Create: `packages/translation/quality/trial.ts`, `quality/trial.test.ts`, `quality/build-grading.ts`, `quality/build-grading.test.ts`
- Modify: `packages/translation/package.json` (scripts `"quality:trial": "node quality/trial.ts"`, `"quality:grading": "node quality/build-grading.ts"`), `packages/translation/README.md` (a "Quality harness" section)

**Interfaces:**
- Consumes: `loadSet`, `languages`, `gradeKey`, `gradeRun`, `type GradedSet`, `type SetName` (Task 20); `parseJob`, `planBatches`, `translateBatch`, `createOpenAiClient`, `openAiBaseUrl`, `type BatchHooks`, `type ItemResult`, `type ParsedJob` (Tasks 3–7).
- Produces:
  - `quality/trial.ts`: `export function trialJob(set:GradedSet):ParsedJob` (`country:'ES'`, `ca` default, `ca/es/en`, each product an item of its `kind` (`product` when absent) in its `family` (its own when absent) with its category, `existing` as given and `missing` the other languages; a product with nothing missing is left out); `export function namesFrom(results:readonly ItemResult[]):Record<string,Record<string,unknown>>`; `export async function runTrial(options:{set:SetName;runs:number;outDir:URL;env:NodeJS.ProcessEnv}):Promise<URL[]>`. The command `node quality/trial.ts --set tuning|blind --runs N [--out <dir>]` (N from 1 to 10; `--out` defaults to `quality/results/`) needs `CLOUD_OPENAI_API_KEY` and reads `CLOUD_OPENAI_BASE_URL`, runs the job through the production code, and writes one `<set>-<timestamp>-<n>.json` per run: `{set,promptVersion,model,repeat,names,failed,usage:{inputTokens,outputTokens},costUsd}`.
  - `quality/build-grading.ts`: `export function gradingPage(set:GradedSet,runs:{file:string;names:Record<string,Record<string,unknown>>}[],template:string,round:string):{html:string;keys:Record<string,{pid:string;lang:string;text:string;runs:string[]}>}` — the page shows only names the owner has neither marked nor been shown, each flagged "New", keyed by `gradeKey`, sorted by text within a cell (the trial's page shuffled them with a fixed seed; with only unseen names on the page, sorting gives nothing away about which run wrote a name). The command `node quality/build-grading.ts --set <set> [--round <name>] <results files…>` writes `quality/grading-<set>.html` and `quality/grading-<set>-keys.json` (the shown keys to merge into `data/<set>-shown.json` once the owner has graded the page).

- [ ] **Step 1: Write the failing tests**

`quality/trial.test.ts` runs the whole trial path against the fake OpenAI server, so it needs no key:

```ts
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {namesFrom,runTrial,trialJob} from './trial.ts';
import {gradeRun,loadSet} from './scorer.ts';
import {echoFirstPass,emptyReview,isReview,startFakeOpenAi} from '../test/fake-openai.ts';
test('the trial job holds every product with its given names and the languages it lacks',()=>{
 const set=loadSet('tuning'),job=trialJob(set);
 assert.deepEqual([job.country,job.languages],['ES',{default:'ca',enabled:['ca','es','en']}]);
 assert.equal(job.items.length,32);
 for(const item of job.items){
  const product=set.products.find(p=>p.id===item.ref)!;
  assert.deepEqual([item.kind,item.family,item.category,item.staffName,item.existing],['product',product.id,product.category,product.internal,product.existing??{}]);
  assert.deepEqual(item.missing,['ca','es','en'].filter(l=>!(l in (product.existing??{}))));
 }
});
test('a run through the production code writes names the scorer reads, all of them new to the owner',async()=>{
 const fake=await startFakeOpenAi(r=>isReview(r)?emptyReview():echoFirstPass(r)),out=mkdtempSync(join(tmpdir(),'translation-trial-'));
 try{
  const [file]=await runTrial({set:'blind',runs:1,outDir:pathToFileURL(out+'/'),env:{CLOUD_OPENAI_API_KEY:'k',CLOUD_OPENAI_BASE_URL:fake.baseUrl}});
  const record=JSON.parse(readFileSync(file!,'utf8'));
  assert.deepEqual([record.set,record.promptVersion,record.model,record.repeat,record.failed],['blind','translate-all-v1','gpt-6-luna',1,[]]);
  assert.ok(record.usage.inputTokens>0&&record.costUsd>0);
  const score=gradeRun(record.names,loadSet('blind'));
  assert.ok(score.names>0);assert.equal(score.ungraded,score.names);
 }finally{await fake.close();rmSync(out,{recursive:true,force:true});}
});
test('namesFrom keys results by product id',()=>{
 assert.deepEqual(namesFrom([{ref:'p01',names:{ca:'Cafè'},placeholder:false,corrections:[]}]),{p01:{ca:'Cafè',placeholder:false,corrections:[]}});
});
test('the trial command refuses to run without a key',async()=>{
 await assert.rejects(runTrial({set:'blind',runs:1,outDir:new URL('file:///nowhere/'),env:{}}),/CLOUD_OPENAI_API_KEY/);
});
```

`quality/build-grading.test.ts`:

```ts
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {gradingPage} from './build-grading.ts';
import {gradeKey,type GradedSet} from './scorer.ts';
test('the page lists only names the owner has not seen, keyed by gradeKey, with </ escaped and $ patterns kept',()=>{
 const set:GradedSet={products:[{id:'p01',internal:'X',category:'C',existing:{en:'Given'}}],
  grades:new Map([[gradeKey('p01','ca','Marked'),'fix']]),shown:new Set([gradeKey('p01','es','Seen')])};
 const template='<script>const PRODUCTS = /*DATA*/[];const DONE = "done-/*ROUND*/";</script>',fresh='New </script> $& name';
 const {html,keys}=gradingPage(set,[{file:'a.json',names:{p01:{ca:'Marked',es:'Seen',en:'Given'}}},{file:'b.json',names:{p01:{ca:fresh,es:'Seen'}}}],template,'r2');
 const page=JSON.parse(/const PRODUCTS = (.*?);const DONE/s.exec(html)![1]!);
 assert.deepEqual(page[0].names.ca,[{k:gradeKey('p01','ca',fresh),t:fresh,new:true}]);
 assert.deepEqual([page[0].names.es,page[0].names.en,page[0].names.fix],[[],[],[]]);
 assert.deepEqual([page[0].id,page[0].internal,page[0].category,page[0].given],['p01','X','C',{en:'Given'}]);
 assert.equal(html.includes('</script> $&'),false);assert.ok(html.includes('const DONE = "done-r2"'));
 assert.deepEqual(keys,{[gradeKey('p01','ca',fresh)]:{pid:'p01',lang:'ca',text:fresh,runs:['b.json']}});
});
test('the copied template still has the two markers the page builder fills',()=>{
 const template=readFileSync(new URL('./grading.template.html',import.meta.url),'utf8');
 assert.ok(template.includes('/*DATA*/[]'));assert.ok(template.includes('/*ROUND*/'));
});
```

Run `pnpm --dir packages/translation quality:test` and watch both new files fail (missing modules).

- [ ] **Step 2: Implement `quality/trial.ts`**

```ts
import {mkdirSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createOpenAiClient,openAiBaseUrl,parseJob,planBatches,translateBatch,translationModel,translationPromptVersion,type BatchHooks,type ItemResult,type ParsedJob} from '../src/index.ts';
import {languages,loadSet,type GradedSet,type SetName} from './scorer.ts';
// The prices migration 039 seeds for gpt-6-luna, in US dollars per million tokens.
const price={input:0.10,output:0.50};
export function trialJob(set:GradedSet):ParsedJob{
 const items=set.products.map(p=>({ref:p.id,kind:p.kind??'product',family:p.family??p.id,category:p.category,staffName:p.internal,existing:p.existing??{},
  missing:languages.filter(l=>!(l in (p.existing??{})))})).filter(item=>item.missing.length>0);
 return parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:[...languages]},items,houseStyle:[]}));
}
export function namesFrom(results:readonly ItemResult[]){
 return Object.fromEntries(results.map(r=>[r.ref,{...r.names,placeholder:r.placeholder,corrections:r.corrections}])) as Record<string,Record<string,unknown>>;
}
export async function runTrial(options:{set:SetName;runs:number;outDir:URL;env:NodeJS.ProcessEnv}):Promise<URL[]>{
 const apiKey=options.env.CLOUD_OPENAI_API_KEY;
 if(!apiKey)throw new Error('CLOUD_OPENAI_API_KEY is required');
 if(!Number.isInteger(options.runs)||options.runs<1||options.runs>10)throw new Error('--runs takes 1 to 10');
 const client=createOpenAiClient({apiKey,baseUrl:openAiBaseUrl(options.env)}),job=trialJob(loadSet(options.set)),batches=planBatches(job.items);
 mkdirSync(options.outDir,{recursive:true});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),written:URL[]=[];
 for(let repeat=1;repeat<=options.runs;repeat++){
  const usage={inputTokens:0,outputTokens:0},results:ItemResult[]=[],failed:string[]=[];
  const hooks:BatchHooks={mayCall:async()=>true,spent:async u=>{usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;},attempted:async()=>{},
   wait:async(ms,signal)=>{try{await delay(ms,undefined,{signal});}catch{/* aborted */}}};
  for(const batch of batches){
   const outcome=await translateBatch(job,batch,client,hooks,new AbortController().signal);
   if(outcome.kind==='done')results.push(...outcome.results);else failed.push(...batch.filter(i=>i.missing.length>0).map(i=>i.ref));
  }
  const costUsd=(usage.inputTokens*price.input+usage.outputTokens*price.output)/1e6;
  const file=new URL(`${options.set}-${stamp}-${repeat}.json`,options.outDir);
  writeFileSync(file,JSON.stringify({set:options.set,promptVersion:translationPromptVersion,model:translationModel,repeat,names:namesFrom(results),failed,usage,costUsd},null,1)+'\n');
  written.push(file);
 }
 return written;
}
async function main(args:string[]){
 const value=(flag:string)=>{const at=args.indexOf(flag);return at<0?undefined:args[at+1];};
 const set=value('--set'),runs=Number(value('--runs')),out=value('--out');
 if(set!=='tuning'&&set!=='blind')throw new Error('usage: node quality/trial.ts --set tuning|blind --runs N [--out <dir>]');
 const outDir=out?pathToFileURL(out.endsWith('/')?out:out+'/'):new URL('./results/',import.meta.url);
 for(const file of await runTrial({set,runs,outDir,env:process.env}))console.log(fileURLToPath(file));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main(process.argv.slice(2));
```

The trial runs batches one after another; each trial set is 30 or 32 products, one batch. It prints only the files it wrote, never a name.

- [ ] **Step 3: Implement `quality/build-grading.ts`**

A port of `build_grading.py` that shows only unseen names. The data is placed with a replacement function, because a string replacement would read `$&` and its kin in a name as a pattern.

```ts
import {readFileSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gradeKey,languages,loadSet,type GradedSet} from './scorer.ts';
type Owner={pid:string;lang:string;text:string;runs:string[]};
export function gradingPage(set:GradedSet,runs:{file:string;names:Record<string,Record<string,unknown>>}[],template:string,round:string){
 const owners=new Map<string,Owner>();
 for(const run of runs)for(const p of set.products){
  const got=run.names[p.id]??{},given=p.existing??{};
  if(got.placeholder===true)continue;
  for(const lang of languages){
   const value=got[lang],text=typeof value==='string'?value.trim():'';
   if(!text||text===given[lang])continue;
   const key=gradeKey(p.id,lang,text);
   if(set.grades.has(key)||set.shown.has(key))continue;
   const owner=owners.get(key)??{pid:p.id,lang,text,runs:[]};owner.runs.push(run.file);owners.set(key,owner);
  }
 }
 const cell=(pid:string,lang:string)=>[...owners].filter(([,o])=>o.pid===pid&&o.lang===lang)
  .sort(([,a],[,b])=>a.text<b.text?-1:a.text>b.text?1:0).map(([k,o])=>({k,t:o.text,new:true}));
 const page=set.products.map(p=>({id:p.id,internal:p.internal,category:p.category,given:p.existing??{},
  names:{...Object.fromEntries(languages.map(lang=>[lang,cell(p.id,lang)])),fix:[]}}));
 const data=JSON.stringify(page).replaceAll('</','<\\/');
 return {html:template.replace('/*DATA*/[]',()=>data).replace('/*ROUND*/',()=>round),keys:Object.fromEntries(owners)};
}
function main(args:string[]){
 const take=(flag:string)=>{const at=args.indexOf(flag);if(at<0)return undefined;const v=args[at+1];args.splice(at,2);return v;};
 const set=take('--set'),round=take('--round')??'r1';
 if(set!=='tuning'&&set!=='blind'||!args.length)throw new Error('usage: node quality/build-grading.ts --set tuning|blind [--round <name>] <results files…>');
 const runs=args.map(file=>({file:basename(file),names:JSON.parse(readFileSync(file,'utf8')).names}));
 const {html,keys}=gradingPage(loadSet(set),runs,readFileSync(new URL('./grading.template.html',import.meta.url),'utf8'),round);
 writeFileSync(new URL(`./grading-${set}.html`,import.meta.url),html);
 writeFileSync(new URL(`./grading-${set}-keys.json`,import.meta.url),JSON.stringify(keys,null,1)+'\n');
 console.log(`${Object.keys(keys).length} new names -> quality/grading-${set}.html`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2));
```

- [ ] **Step 4: Run the tests and watch them pass.** `pnpm --dir packages/translation quality:test`; expected: 13 passing (7 from Task 20, 4 trial, 2 page).
- [ ] **Step 5: Document the harness.** Add a "Quality harness" section to `packages/translation/README.md`: what each file under `quality/` is; that a run costs cents and needs the real key, so it runs by hand and never in CI; the commands, run from `packages/translation` (the scripts read paths relative to it, and the shell expands the globs there):
  - `CLOUD_OPENAI_API_KEY=… pnpm quality:trial --set tuning --runs 3`
  - `pnpm quality:score --set tuning quality/results/tuning-*.json`
  - `pnpm quality:grading --set tuning --round r2 quality/results/tuning-*.json`
  - and that any change to a prompt, the model or the batching is scored against both sets before it ships, with the result in the change's description (spec, "Quality check").
- [ ] **Step 6: Typecheck** with `pnpm --dir packages/translation typecheck`.
- [ ] **Step 7: Commit**

```bash
git add packages/translation/quality packages/translation/package.json packages/translation/README.md
git commit -s -m "Add the hand-run translation trial, which sends a graded set through the production batching, prompts and client, and a grading page that shows the owner only names they have not seen"
```

---

### Task 22 (OWNER-INVOLVED, needs the real key): Score the templated prompt against both graded sets

**Owner-only after 2026-11-02.** The commands below are preserved, not authorized for autonomous execution.

Run only after Tasks 1–21 are merged or on their branch. Needs `CLOUD_OPENAI_API_KEY` (the trial's key is in `~/.llm-trial/env`; export it only in the shell) and the owner's time to grade. Run every command below from `packages/translation`.

The bar, from the spec: "Before release, the harness must show that the templated prompt scores no worse than the fourth prompt on both graded sets." The fourth prompt with the Luna review had 6% of its names marked (4% wrong) on the tuning set and 5% (2% wrong) on the blind set (spec's table; the scorer's "marked" column).

- [ ] **Step 1:** `pnpm quality:trial --set tuning --runs 3` and `pnpm quality:trial --set blind --runs 3`. Cost: cents (spec).
- [ ] **Step 2:** `pnpm quality:score --set tuning quality/results/tuning-*.json`, and the same for `blind`. If any names are ungraded, `pnpm quality:grading --set <set> --round r2 quality/results/<set>-*.json`, publish `quality/grading-<set>.html` for the owner with the grading database (the page saves marks through `window.claude.use("db")`, as the trial's page did), and ask the owner to grade the new names.
- [ ] **Step 3:** Export the owner's marks into `quality/data/<set>-grades/` as one file per mark named by `gradeKey`, in the copied files' shape (`{"lang","pid","text","verdict"}`); merge `quality/grading-<set>-keys.json` into `quality/data/<set>-shown.json`; rescore. Ungraded must be 0, and `pnpm quality:test` must still pass (its size test pins the grade and shown counts: update those two numbers to the new totals in the same commit).
- [ ] **Step 4:** Compare the marked and wrong shares with the bar. If either set scores worse, stop and bring the numbers to the owner; do not tune the prompt without the owner.
- [ ] **Step 5:** Commit the new grades and shown keys (`git commit -s -m "Grade the templated prompt's new names; it scores X% and Y% against the fourth prompt's 6% and 5%"`), and put the table in the PR description.

### Task 23 (OWNER-INVOLVED, needs the real key): Measure the house-style examples

**Owner-only after 2026-11-02.** The commands below are preserved, not authorized for autonomous execution.

The spec: "The fair test is to give the blind set's run the names the owner accepted from the tuning set, and to count the Catalan vocabulary errors. Neither has been measured."

**Files:** Modify `packages/translation/quality/scorer.ts` (`shownEntries`), `quality/trial.ts` (`acceptedHouseStyle`, the `--house-style` option), `quality/trial.test.ts`.

- [ ] **Step 1: Write the failing test.** Append to `quality/trial.test.ts` (add `acceptedHouseStyle` to the `./trial.ts` import and `gradeKey`, `shownEntries` to the `./scorer.ts` one):

```ts
test('the tuning house style is the same on every call, holds no marked name, stays within its limit, and reaches the job',()=>{
 const set=loadSet('tuning'),shown=shownEntries('tuning'),style=acceptedHouseStyle(set,shown);
 assert.deepEqual(acceptedHouseStyle(set,shown),style);
 assert.ok(style.length>0&&style.length<=300);
 for(const entry of style){
  const product=set.products.find(p=>p.internal===entry.staffName)!;
  for(const [lang,text] of Object.entries(entry.names))assert.equal(set.grades.has(gradeKey(product.id,lang,text)),false,`${product.id} ${lang}`);
 }
 assert.equal(acceptedHouseStyle(set,shown,2).length,2);
 assert.equal(trialJob(loadSet('blind'),style).houseStyle.length,style.length);
});
```

Run `pnpm --dir packages/translation quality:test` and watch it fail (missing exports).

- [ ] **Step 2: Implement.** In `quality/scorer.ts`:

```ts
export type ShownName={pid:string;lang:string;text:string;runs:string[]};
export function shownEntries(name:SetName):Record<string,ShownName>{return JSON.parse(readFileSync(new URL(`${name}-shown.json`,data),'utf8'));}
```

In `quality/trial.ts`, import `shownEntries` and `type ShownName`, give `trialJob` a second parameter `houseStyle:HouseStyleName[]=[]` (import `type HouseStyleName` from `../src/index.ts`) that it passes as the job's `houseStyle`, and add:

```ts
// For each product and language, the accepted name (shown, not marked, not the venue's own) that the most runs wrote; ties go to the text that sorts first.
export function acceptedHouseStyle(set:GradedSet,shown:Record<string,ShownName>,limit=300):HouseStyleName[]{
 const best=new Map<string,{text:string;runs:number}>();
 for(const [key,v] of Object.entries(shown)){
  const product=set.products.find(p=>p.id===v.pid);
  if(v.lang==='fix'||set.grades.has(key)||!product||product.existing?.[v.lang]===v.text)continue;
  const slot=`${v.pid}\u001f${v.lang}`,current=best.get(slot);
  if(!current||v.runs.length>current.runs||(v.runs.length===current.runs&&v.text<current.text))best.set(slot,{text:v.text,runs:v.runs.length});
 }
 const chosen=new Map<string,Record<string,string>>();
 for(const [slot,{text}] of best){const [pid,lang]=slot.split('\u001f') as [string,string];chosen.set(pid,{...chosen.get(pid),[lang]:text});}
 return set.products.filter(p=>chosen.has(p.id)).slice(0,limit).map(p=>({kind:'product',staffName:p.internal,names:{...p.existing,...chosen.get(p.id)}}));
}
```

and in `runTrial` accept `houseStyle?:'tuning-accepted'` in its options, building the job as `trialJob(loadSet(options.set),options.houseStyle?acceptedHouseStyle(loadSet('tuning'),shownEntries('tuning')):[])` and recording `houseStyle:options.houseStyle??null` in each file; `main` reads `--house-style`, which accepts only `tuning-accepted`. Rerun `pnpm --dir packages/translation quality:test`.
- [ ] **Step 3:** From `packages/translation`, run the blind set three times with and three times without the house style (`pnpm quality:trial --set blind --runs 3 --house-style tuning-accepted`, and without the flag); score both; have the owner grade any ungraded names as in Task 22.
- [ ] **Step 4:** List every Catalan name marked "needs work" or "wrong" in both arms and ask the owner which are vocabulary errors (a Spanish word in Catalan spelling, the error rule 4 targets); the marks carry no reason, so this count needs the owner.
- [ ] **Step 5:** Record both arms' scores and the vocabulary-error counts in the PR description and commit the code, the grades and the shown keys.

### Task 24 (OWNER-INVOLVED, needs the real key): A short trial on variants, options labels and menu sections

**Owner-only after 2026-11-02.** The commands below are preserved, not authorized for autonomous execution.

The spec: "A short trial on the other kinds of name (variants, options labels, menu sections), using Santet's, graded by the owner."

**Files:** Create `packages/translation/quality/santet-kinds.ts`, `quality/santet-kinds.test.ts`, `quality/data/kinds-products.json`, `quality/data/kinds-shown.json` (`{}` to start), `quality/data/kinds-grades/` (empty to start). Modify `quality/scorer.ts` and `quality/build-grading.ts` (accept the set name `kinds`), `quality/trial.ts` (accept `--set kinds`).

Santet's Square catalogue snapshot is `~/workspace/worktrees/waitron-local-santet-data/local/square/snapshot/catalog.json`: a JSON list of catalogue objects. On 2026-10-14 it held 358 `ITEM`, 52 `CATEGORY` and 14 `MODIFIER_LIST` objects, none deleted; 73 items had more than one variation, 159 variations between them, and the lists held 69 modifiers (counted with `python3 -I` over the file). An item's name is `item_data.name`, its variations `item_data.variations[].item_variation_data.name`, its categories `item_data.categories[].id`; a list's name is `modifier_list_data.name`, its modifiers `modifier_list_data.modifiers[].modifier_data.name`.

- [ ] **Step 1: Write the failing test** — `quality/santet-kinds.test.ts`:

```ts
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {kindsSet} from './santet-kinds.ts';
import {trialJob} from './trial.ts';
const catalog=[
 {type:'CATEGORY',id:'C1',category_data:{name:'TAP BEERS'}},
 {type:'ITEM',id:'I1',item_data:{name:'CANYA',categories:[{id:'C1'}],variations:[{id:'V1',item_variation_data:{name:'PETITA'}},{id:'V2',item_variation_data:{name:'GRAN'}}]}},
 {type:'ITEM',id:'I2',item_data:{name:'CAFE',categories:[{id:'C1'}],variations:[{id:'V3',item_variation_data:{name:'Regular'}}]}},
 {type:'ITEM',id:'I3',is_deleted:true,item_data:{name:'GONE',variations:[{id:'V4',item_variation_data:{name:'A'}},{id:'V5',item_variation_data:{name:'B'}}]}},
 {type:'MODIFIER_LIST',id:'L1',modifier_list_data:{name:'EXTRAS',modifiers:[{id:'M1',modifier_data:{name:'CON HUEVO'}}]}},
];
test('multi-variation items become a product and its variants, and modifier lists an options list and its labels',()=>{
 const products=kindsSet(catalog);
 assert.deepEqual(products.map(p=>[p.id,p.kind,p.family,p.internal,p.category]),[
  ['item:I1','product','item:I1','CANYA','TAP BEERS'],['variation:V1','variant','item:I1','PETITA','TAP BEERS'],['variation:V2','variant','item:I1','GRAN','TAP BEERS'],
  ['list:L1','option_list','list:L1','EXTRAS',null],['modifier:M1','option_label','list:L1','CON HUEVO',null]]);
 const job=trialJob({products,grades:new Map(),shown:new Set()});
 assert.deepEqual(job.items.map(i=>[i.ref,i.kind,i.missing.length]),products.map(p=>[p.id,p.kind,3]));
});
```

Run `pnpm --dir packages/translation quality:test` and watch it fail.

- [ ] **Step 2: Implement `quality/santet-kinds.ts`**

```ts
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import type {Product} from './scorer.ts';
interface SquareObject {type:string;id:string;is_deleted?:boolean;
 category_data?:{name:string};
 item_data?:{name:string;categories?:{id:string}[];variations?:{id:string;item_variation_data:{name:string}}[]};
 modifier_list_data?:{name:string;modifiers?:{id:string;modifier_data:{name:string}}[]}}
export function kindsSet(catalog:readonly SquareObject[]):Product[]{
 const live=catalog.filter(o=>!o.is_deleted),out:Product[]=[];
 const categories=new Map(live.filter(o=>o.type==='CATEGORY').map(o=>[o.id,o.category_data?.name??null]));
 for(const item of live.filter(o=>o.type==='ITEM'&&o.item_data)){
  const data=item.item_data!,variations=data.variations??[];
  if(variations.length<2)continue;
  const family=`item:${item.id}`,category=categories.get(data.categories?.[0]?.id??'')??null;
  out.push({id:family,kind:'product',family,internal:data.name,category});
  for(const v of variations)out.push({id:`variation:${v.id}`,kind:'variant',family,internal:v.item_variation_data.name,category});
 }
 for(const list of live.filter(o=>o.type==='MODIFIER_LIST'&&o.modifier_list_data)){
  const data=list.modifier_list_data!,family=`list:${list.id}`;
  out.push({id:family,kind:'option_list',family,internal:data.name,category:null});
  for(const m of data.modifiers??[])out.push({id:`modifier:${m.id}`,kind:'option_label',family,internal:m.modifier_data.name,category:null});
 }
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const source=process.argv[2];if(!source)throw new Error('usage: node quality/santet-kinds.ts <catalog.json>');
 const products=kindsSet(JSON.parse(readFileSync(source,'utf8')));
 writeFileSync(new URL('./data/kinds-products.json',import.meta.url),JSON.stringify(products,null,1)+'\n');
 console.log(`${products.length} names -> quality/data/kinds-products.json`);
}
```

Widen `SetName` in `scorer.ts` to `'tuning'|'blind'|'kinds'`, and let `scorer.ts`, `trial.ts` and `build-grading.ts` accept `--set kinds` beside the other two. Rerun `pnpm --dir packages/translation quality:test`. Then, from `packages/translation`, `node quality/santet-kinds.ts ~/workspace/worktrees/waitron-local-santet-data/local/square/snapshot/catalog.json`; at 73 items, 159 variations, 14 lists and 69 modifiers it should report 315 names. 315 is under the 1,000-item limit.

Menu sections: Square has none. Look for them in the Waitron venue built from that snapshot (Waitron's catalogue names its table `menu_sections` in `packages/catalogue/src/migrations.test.ts`; check the schema before querying it). If the venue has sections, add them to `kinds-products.json` as kind `menu` heads and kind `section` members with `category:null`; if it has none, say so in the PR description.
- [ ] **Step 3:** Run three times (`pnpm quality:trial --set kinds --runs 3`); build the grading page (every name is new); the owner grades it.
- [ ] **Step 4:** Commit the set and the grades as the third graded set, score it, and report the needs-work and wrong shares per kind to the owner. Do not change the prompt in this task.

---

## Self-review notes

- **Spec coverage.** Machine actions (Tasks 1, 10, 11), fingerprint and vectors (1), entitlement and fourth service (2, 16, 17), jobs, one open job and the cap at submit (2, 3), submit's request limits (12), context items (4, 5, 8, 11), worker steps 1–8 (4 batching; 5–7 passes, retries and aborts; 8 cap stop, finish, reasons and usage; consent at lease in 13), review merge (5), prompt (5, 22, 23), OpenAI client (6), the worker command (9), providers and consent (13, 14, 15, 19 docs), retention in the worker and the account server (18), quality check (20–24), the spec's testing list (Tasks 1, 3, 4, 7, 8, 11, 12, 16, 17, 18).
- **Approved decisions and implementation details:** owner-approved submit admission (4 in flight, 1 per client address, outside the 8 places every other request shares) and US$5 per-venue calendar-month (UTC) safety cap; the account server also runs the retention sweep whenever `CLOUD_TRANSLATION=1`; a job leased more than three times ends `provider_failed` or `provider_unavailable`, because the contract's reason list has no reason for a worker that keeps dying, and a clean shutdown's hand-back does not count as a lease; an abort saves nothing for the batch it interrupted; `CLOUD_TRANSLATION` and `CLOUD_OPENAI_BASE_URL`; two jobs per worker process; the grading page sorts new names instead of shuffling them. Preserve four calls per batch pass and the 60-second cap on `Retry-After`; a never-finished job expires 24 hours after it was submitted; up to four usage events per job; submit's 2 MiB and 60-second request limits; the field bounds, nine kinds, category rules and context items; collect/release state refusals, submit conflict, reasons and named services. The paging amendment replaces single-collect assumptions preserving the existing input limits.
- **Context items close the old gap** where a variant arrived without its product's name: the box now sends a complete family head with `missing: []` (contract, "Submit"), so `partOf` always finds it in the batch. Task 24 still measures the other kinds.
- **Task size.** Each task is meant to fit one implementer well under about 100 tool calls. The largest are Tasks 8 (the worker, 14 tests), 12 (submit's limits, with real-socket timing tests) and 18 (the sweep in two processes and the log test); each has one deliverable a reviewer can accept or reject alone, so none is split further.
