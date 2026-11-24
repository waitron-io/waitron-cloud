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

> **Built.** Tasks 1–21 are on main; Tasks 22–24 below are still open. Their step-by-step text
> was removed on 24 November 2026; read it with
> `git show 3c69f4903:docs/superpowers/plans/2026-10-14-translate-all.md`.

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

Offline steps 1–2 are implemented under the [15 November preparation plan](2026-11-15-translation-house-style-preparation.md), cleared by the watcher at 23:33. The implementation excludes every venue-supplied language and refuses house style on the tuning set. Use the [separate comparison directories](../../../packages/translation/README.md#quality-harness) for rehearsal and the later measurement; steps 3 onward still require the owner's quality trial and the existing provider gates. The code below records the original proposal.

**Measurements remain owner-only after 2026-11-02.** The real-provider commands below are preserved, not authorized for autonomous execution.

The spec: "The fair test is to give the blind set's run the names the owner accepted from the tuning set, and to count the Catalan vocabulary errors. Neither has been measured."

**Files:** Modify `packages/translation/quality/scorer.ts` (`shownEntries`), `quality/trial.ts` (`acceptedHouseStyle`, the `--house-style` option), `quality/trial.test.ts`.

- [x] **Step 1: Write the failing test.** Append to `quality/trial.test.ts` (add `acceptedHouseStyle` to the `./trial.ts` import and `gradeKey`, `shownEntries` to the `./scorer.ts` one):

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

- [x] **Step 2: Implement.** In `quality/scorer.ts`:

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
- [ ] **Step 3:** From `packages/translation`, run `pnpm quality:trial --set blind --runs 3 --out quality/results/blind-plain` and `pnpm quality:trial --set blind --runs 3 --house-style tuning-accepted --out quality/results/blind-style`. Score each folder separately with `pnpm quality:score --set blind quality/results/blind-plain/*.json` and `pnpm quality:score --set blind quality/results/blind-style/*.json`; have the owner grade any ungraded names as in Task 22. Keep existing mixed-folder files out of this comparison.
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
