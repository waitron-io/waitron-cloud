# Translate all: the Cloud translation service

**Status:** owner-approved design and implementation plan, including the US$5 UTC monthly
per-venue safety cap and submit admission (4 in flight, 1 per address). The owner requires bounded
collect before go-live. The [2026-10-16 paging amendment](../plans/2026-10-16-translation-collect-pages.md)
defines that prerequisite without restricting accepted language tags.
Runtime implementation and release qualification remain open.
**Companion spec (Waitron side):** `waitron/docs/superpowers/specs/2026-10-14-translate-all-design.md`.
It covers the dashboard, the box's job runner and the suggestions it stores.
**Wire contract:** [`docs/waitron-integration-contract.md`](../../waitron-integration-contract.md),
section "Translate all, version 1". Both specs point there; neither restates it.

## What it is for

A Waitron venue presses **Translate all** in its dashboard. Its box sends every missing
customer-facing name, across the nine kinds of name Waitron translates, to this service. The
service writes the names in every enabled content language with a language model, checks them in a
second, review pass, and hands them back for a person to review. Waitron shows them as suggestions,
and nothing reaches a diner until a person saves it. This spec covers everything between the box's
request and its collected results.

## Owner decisions this design follows (2026-10-14)

1. **Free for now, for any connected installation**, with a per-venue spending cap as a safety
   limit: **US$5 per venue per calendar month (UTC), owner-approved.** A monthly
   allowance, recorded so that billing can use it later, replaces this before the first live venue.
   There is no billing in this repository yet (`docs/backlog.md`); this design adds none.
2. **Cloud keeps nothing but usage counts.** The menu and the results are deleted when the box
   releases the job after durably storing every collect page, or after 24 hours. Collect itself
   never deletes them. No name ever enters a log.
3. **The prompt rules stay language-neutral.** A rule written for one language was tried and dropped
   by the owner: "that doesn't help us with arbitrary languages".
4. **Cloud runs each request as a background job** (the shape of the email relay), not the box
   batch by batch, so that retries, the provider's rate limits and the spending cap live in one place.
5. **Batches of about 90, grouped by family and category**, sent side by side.

## How the method was chosen

The trial ran on 2026-10-14. Its harness, data and the owner's blind grades are in
`packages/translation/quality/`. Task 20 preserves the original scripts, both graded sets,
the owner's grades and six recorded Luna-review runs there (see "Quality check"). Every percentage below is the share of a
setup's names the owner marked "needs work" or "wrong".

| Setup | Tuning set (32 products) | Blind set (30 products never tuned on) |
|---|---|---|
| Luna low (`gpt-6-luna`), first prompt | 16% (7% wrong) | 12% (4% wrong) |
| Luna low, fourth prompt | 7% (4% wrong) | 6% (4% wrong) |
| Fourth prompt, then Luna medium review | 6% (4% wrong) | **5% (2% wrong)** |
| Fourth prompt, then Terra low (`gpt-5.6-terra`) review | 5% (4% wrong) | 5% (2% wrong) |

Other setups were measured and set aside on the tuning set. Haiku 5.5 scored 33–35% and Sonnet 5.5
23–24%, both through the `claude` command-line tool. Terra low with the first prompt scored 16%, and
did not improve with later prompts (17–18%).

The models' own "check this" flags carried no signal: a flagged product was no more often marked
than an unflagged one, so this design has no self-flags.

Cost, at OpenAI's standard prices read from `developers.openai.com/api/docs/pricing` on 2026-10-14
(`gpt-6-luna`: $0.10 in, $0.50 out per million tokens; `gpt-5.6-terra`: $2 in, $12 out):

- the fourth prompt: about $0.0035 per 100 products;
- the Luna review: about $0.0038 per 100 more;
- a Terra review would add $0.077.

The Luna review matched Terra's quality on the blind set at a twentieth of Terra's extra cost, so
the service uses Luna for both passes.

Batching was measured on Santet's whole catalogue (358 products, two runs per setup):

| Setup | Time | Products lost | Same name across both runs |
|---|---|---|---|
| Batches of 30 | 17–21 s | 0 | 77% |
| Batches of 90 | 26–28 s | 0 | 81% |
| The whole menu in one request | 86–90 s | 0 | 83% |

Batches of 90 keep most of the stability of the whole menu at a third of the wait.

## Shape

```
box ──submit──► account-http ──► translation_jobs (+ translation_job_bodies)
box ◄─status──      │                     ▲
box ◄─collect─      │                     │ leases
box ──release─►     ▼                     │
              translation-worker ──batches──► OpenAI Responses API
                       └──usage events─► usage metering
```

A new workspace package, `packages/translation`, holds the domain: job store, batching, prompt
assembly, the OpenAI client, the review merge, the cap and retention. `account-http` gains the four
machine actions and nothing else. A new worker command, `translation-worker`, runs the jobs on the
existing `runWorkerLoop` (`packages/registration/src/worker-loop.ts`), as a separate Compose service
like the email outbox worker.

## The machine actions

Four actions join `MachineAction` (`packages/registration/src/installation-proof.ts`):
`translation-submit`, `translation-status`, `translation-collect` and `translation-release`. Their
request and response shapes, and the error codes the box sees, are in the contract.

A job body is far larger than the signed request allows: the signed body is refused over 4,096
characters (`readMachineClaims`, `installation-proof.ts`). `translation-submit` therefore signs a
SHA-256 fingerprint of the job body and its length, and sends the body beside the envelope. Cloud
checks the fingerprint before it parses anything; a mismatch is refused like any other invalid
proof. The job body is capped at 1 MiB and 1,000 items; a bigger menu arrives as consecutive jobs
(the cap counts items, each with all its missing languages). The contract publishes test vectors,
so that Waitron's signer and Cloud's verifier test against the same cases.

**Submit has its own request limits.** Every account route today reads its body through one reader
that refuses more than 16 KiB or a body not received within 5 seconds
(`packages/account-http/src/request.ts:6,15,22`), and the server's own request time limit is 5
seconds (`packages/account-http/src/server.ts:37`). A 1 MiB job, escaped as a JSON string inside
the envelope, can be twice that, so submit accepts a request of up to 2 MiB plus 16 KiB, received
within 60 seconds. Status, collect and release keep 16 KiB and 5 seconds. The exact numbers and
refusals are in the contract.

**Submit admission is owner-approved:** four requests in flight, at most one per client address,
outside the eight places shared by other account requests. Existing rate limits still apply.

**Collect is paged before go-live.** Each complete compact JSON reply is at most 16,777,216 UTF-8
bytes after content decoding, including its UUID and `nextCursor`. A signed optional integer
cursor selects an offset in the original submitted items filtered to those with missing languages.
Terminal results stay in submit order, independent of worker or batch completion. Each page is
the largest nonempty consecutive segment that fits, with complete unchanged items. Retried cursors
return the same semantic page while retained. The contract owns the exact validation and fields.

The box stores each page through durable suggestion reconciliation and deduplicates refs on crash
retries. It reads at most 16 MiB per page without concatenating response strings or accumulating
unbounded buffers, and releases only after every page is durably stored. Release or expiry between
pages means an incomplete job, never a full result. Waitron lane B A689-21 must implement the loop;
a smaller reader alone cannot prevent a one-collect caller from releasing unseen pages. Joint
Cloud/Waitron pagination and recovery proof is a go-live gate, alongside the existing quality and
pricing gates. The amendment proves that a single result fits using the existing input bounds;
no new language-tag restriction is needed.

**Context items.** When the box sends a member of a family (a variant, an options label, a menu
section) but not its head, because the head's own names are complete or an earlier job of the
same run sent it, it sends the head with no languages to write. The model sees it as context; Cloud never returns names or a failure for it, and
it does not count towards the job's total or the cap estimate.

Polling every five seconds is 12 requests a minute, inside the existing limit of 30 a minute per
installation (`packages/account-http/README.md`).

## Entitlement

`installation_services.service` is fixed to three values by a CHECK constraint
(`packages/registration/migrations/001_registration.sql`). A migration adds `content_translation`,
and every connected installation gets it with state `ready`, which means available (decision 1).
Waitron refuses an unexpected service count today, so only a `configuration` reply to a request
signed with `servicesVersion: 2` carries the fourth service; `renew` and `report` replies are
unchanged. The contract has the exact shapes.

Several Cloud readers assume three services, or treat any service that is switched on as a reason
to monitor a venue: the monitoring schedule, alert delivery, operations status, diagnostics, the
venue overview and the portal's service lists. Translation is `ready` for every installation, so
each of those readers counts only the three original services; otherwise every connected venue
would start being monitored and alerted.

## Jobs

**`translation_jobs`** holds no names:

- installation and venue;
- state: `queued`, `running`, `done`, `partly_done`, `failed`, `collected`, `expired`;
- for a `partly_done` or `failed` job, its reason (the contract's list);
- name counts: total, done, failed;
- cost so far, in micro-US-dollars;
- the model and prompt version that served it;
- created, started, finished, collected.

It stays as the usage record.

**`translation_job_bodies`** holds the job's body and its results, keyed by job. A row is deleted on
`translation-release`, or by a sweep 24 hours after the job finished, which also moves an
uncollected job to `expired`. A job that never finishes (no worker ran for a day) is swept 24 hours
after it was submitted.

**One open job per venue.** A second submit while one is queued or running is refused with
`translation_job_running`, and the box shows the open one's progress.

**The cap is checked at submit.** Cloud estimates the job's cost from its number of items with
languages to write, at a stored rate per item, initially twice the trial's measured rate. If the estimate exceeds what is
left of the venue's cap this calendar month, submit is refused with `translation_limit_reached`,
carrying how many items would fit. The worker also stops a running job at the cap (below).

## The worker

1. **Lease a queued job.** The cap was already checked against the estimate at submit. If the
   venue's consent was withdrawn since, the job ends `failed` with reason `consent_required` and
   no provider is called.
2. **Batch.** Keep each family together: a product with its variants, an options list with its
   labels, a menu with its sections, including a head sent only as context. Then fill batches of
   about 90 items, category by category; an item carries all of its missing languages. A product
   has one category (Waitron's `products.category_id`), and a variant goes with its product's. A
   family bigger than 90 items stays whole.
3. **First pass:** each batch goes to `gpt-6-luna` at low reasoning effort, through the Responses
   API with `store: false`. Up to four batches run side by side for one job; the trial sent 12 side
   by side without a refusal on 2026-10-14.
4. **Check the reply.** It must be valid JSON naming every product in the batch once, with every
   requested language filled unless the product is a placeholder. A context item needs no entry, and
   anything written for it is dropped. A reply that fails the check is retried.
5. **Review pass:** each checked batch goes to `gpt-6-luna` at medium effort with the review prompt.
   Its changes are merged under the rules in "Review merge". A failed review keeps the first-pass
   names, because the review only ever improves a batch.
6. **Retry.** Each pass of a batch makes up to four calls: the first, then three retries after
   2 s, 8 s and 30 s, or after the provider's `Retry-After` (capped at 60 s) when it sends one. A
   batch whose first pass still fails marks its items failed, and the job finishes `partly_done`
   with reason `provider_failed`; if every batch fails it is `failed` with reason
   `provider_unavailable`.
7. **Stop at the cap.** Actual cost is added after every call, from the reply's token usage at
   stored prices. Reaching the cap stops the job: `partly_done` with reason `limit_reached`, or
   `failed` with that reason if nothing was done yet. Batches already sent finish, so a job can
   pass the cap by at most those calls.
8. **Record usage** when the job finishes. A usage event holds one quantity
   (`packages/registration/migrations/025_usage_metering.sql:12`, and its one-quantity rule at
   `:29`; `src/usage-metering.ts:75`), so a finished job records up to four events: items done,
   input tokens, output tokens and cost, each only when above zero, all naming the job and none
   carrying a name. This adds four usage event types and a source kind to
   `packages/registration/src/usage-metering.ts`.

### Review merge

A reviewer's change is applied only when it names a product in the batch, uses a requested
language, has non-empty text, and is not for a language the venue entered itself. Everything else
is dropped and counted.

The trial's merge, with its test, is `apply_changes` in the harness. On the tuning set the Luna
reviewer fixed 4 names the owner had marked and spoiled 1 the owner had accepted (*Bol de batido*
became *Bol de smoothie*). It also introduced one new error, *Té de rooibos*, which the owner marked
wrong. The Terra reviewer fixed 4 and spoiled none.

## The prompt

The production first-pass prompt is the trial's fourth prompt, with the venue's values filled in
and its venue-specific wording made general:

- "a café-bar's menu in Spain" becomes the venue's country, from the job.
- The language list and the JSON keys come from the job's content languages and default.
- Rule 4's sentence about Catalan and Spanish vocabulary becomes: "Each language's names use that
  language's own vocabulary, not another language's words written in its spelling."
- The examples (patates braves, truita de patates, brunch, poke bowl, SPECIAL 7) stay, as
  illustrations of each rule.
- The venue's house-style examples are added: up to 300 saved names sent by the box, under "Names
  this venue has saved: follow their wording where they apply".

Those edits change tested text. **Before release, the harness must show that the templated prompt
scores no worse than the fourth prompt on both graded sets.** It must also show what the house-style
examples do. The fair test is to give the blind set's run the names the owner accepted from the
tuning set, and to count the Catalan vocabulary errors. Neither has been measured.

Both prompts, as tested, are in the appendix. The prompt text lives only in this repository.

## OpenAI

- **Key:** `CLOUD_OPENAI_API_KEY`, from the environment like every other secret here
  (`.env.example`). Production key custody is already an open launch requirement
  (`docs/launch-evidence.md`).
- **Requests:** a 120 s timeout, redirects refused, and nothing from the request or the reply logged.
  The client is tested against a local fake server through the real HTTP client.
- **The model is pinned by name** and recorded per job. If OpenAI publishes dated snapshots of
  `gpt-6-luna`, pin one. The trial used the bare name.
- **What OpenAI does with the data**, from `developers.openai.com/api/docs/guides/your-data`, read on
  2026-10-14:
  - "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models
    (unless you explicitly opt in to share data with us)."
  - "By default, abuse monitoring logs are generated for all API feature usage and retained for up
    to 30 days, unless longer retention is required by law, or is reasonably necessary to protect
    our services or any third party from harm."
  - "Except as noted below, the Responses API has a 30 day Application State retention period by
    default, or when the store parameter is set to true."

  So every request sets `store: false`. The abuse-monitoring logs remain unless OpenAI approves the
  account for its Zero Data Retention or Modified Abuse Monitoring controls.
- **Whether OpenAI can process this data inside the EU** is not established here.

## Providers and consent

The data-protection documents and the consent name **three possible language-model providers:
OpenAI, Anthropic and Google** (owner, 2026-10-14). The service uses OpenAI today. Naming all three
means a comparison test, or a later change of provider, needs no new consent. Each job records the
provider and model that served it.

- **The data sent** is internal names, customer-facing names and categories. Menus do not normally
  hold personal data, but staff can type anything into an internal name.
- **The three providers join** the open data-protection decisions in `docs/launch-evidence.md`.
- **Each provider's own terms** on training, retention and where data is processed are quoted from
  its own published pages, with the date read, before that provider serves a job. Only OpenAI's are
  quoted so far (above).
- **Consent comes before the first job.** The account owner agrees, on the portal's account page
  (`/account`, in the venue's entry), that the venue's menu text may be sent to the named
  providers. The email relay's account consent is the pattern
  (`docs/transactional-email-relay-contract.md`). Until consent is recorded, `translation-submit`
  is refused with `translation_consent_required`, and the box links to that page.

## Quality check

Task 20 preserves the trial in `packages/translation/quality/`:

- the trial script;
- both graded product sets;
- the owner's grades, keyed by product, language and name text;
- the offline scorer, which reports names the owner has never seen as ungraded.

The trial runner and grading page remain Task 21. Archived scripts and the template are
records, not the new runnable harness.

Any change to a prompt, the model or the batching is scored against both sets before it ships, and
the result goes in the change's description. A run costs cents and needs the real key, so it runs
by hand, not in CI.

Before release, two further measurements:

Tasks 22–24 remain owner-only, after 2026-11-02. Preserve their commands; neither documentation
drafting nor offline implementation authorizes running them or accessing the real key.

- **A short trial on the other kinds of name** (variants, options labels, menu sections), using
  Santet's, graded by the owner.
- **The templated prompt and the house-style examples**, as in "The prompt".

## Testing

- **Signature:** a changed body, a changed length, a replayed operation and an expired lease are each
  refused; a retried operation returns its first result. The contract's test vectors pass.
- **Request limits:** a 1 MiB job inside a 2 MiB request is accepted at submit, a larger one is
  refused as too large, and the other three actions keep 16 KiB and 5 seconds.
- **Collect pages:** measure the complete compact JSON in decoded UTF-8 bytes, including the
  UUID and actual `nextCursor`; cover escaping, exact bounds, maximal pages, stable submit order,
  mixed failures/context, arbitrary valid offsets, owner-first cursor validation and repeat reads.
  Jointly prove bounded Waitron reads, crash retries/ref deduplication, durable completion before
  release, and incomplete results after release or expiry between pages.
- **Job body:** a context item is accepted only when it heads the family of an item with languages
  to write, and never appears in the results or the failed list.
- **Batching:** families are never split; a family over 90 stays whole; categories stay together;
  1,000 items produce the expected batches.
- **The worker, against a fake OpenAI server:**
  - timeouts, malformed JSON, a missing product and a 429 with `Retry-After` each retry, then end
    `partly_done` with reason `provider_failed`;
  - all batches failing ends `failed` with reason `provider_unavailable`;
  - a failed review keeps first-pass names.
- **Cap:** refused at submit with the count that fits; stopped mid-job with reason
  `limit_reached`; the month boundary.
- **Fourth service:** every reader that decides monitoring, alerts or the services shown ignores a
  ready `content_translation`.
- **Retention:** release deletes the body row; the sweep deletes after 24 hours and marks the job
  `expired`. A test reads the worker's and the API's log output for a job and finds no name from it.
- **Usage:** up to four events per finished job, one quantity each, with no names.

## Open items

- Pricing, the monthly allowance and billing (decision 1).
- Where each provider processes the data, and whether to apply for OpenAI's retention controls.
- The consent wording itself, in English and Spanish.
- Production key custody for `CLOUD_OPENAI_API_KEY`.

## Appendix: the prompts as tested on 2026-10-14

### First pass (fourth prompt)

```text
You write customer-facing names for a café-bar's menu in Spain.
The venue's default customer language is Catalan (ca). The other customer languages are Spanish (es) and English (en).

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
4. Write each language as a native speaker would. Catalan names use Catalan vocabulary, not Spanish words in Catalan
   spelling; Spanish names use Spanish vocabulary, not Catalan words.
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
   three names empty.

Reply with JSON only, no prose, in exactly this shape:
{"products": [{"id": "p01", "ca": "...", "es": "...", "en": "...", "placeholder": false,
  "corrections": [{"field": "internal", "wrong": "...", "right": "..."}]}]}
"corrections" is an empty list when there is nothing to fix.
Every product appears once.
```

The user message was `Products:` followed by a JSON list of `{id, internal, category, existing}`.

### Review pass

```text
You review customer-facing names that someone else wrote for a café-bar's menu.
The venue's customer languages are: ca (Catalan, the default), es (Spanish), en (English).

For every name in every language, ask: is this exactly how a native speaker writing this venue's menu in that
language would print it? Check that it uses that language's own vocabulary and grammar, the standard local name of
the dish or drink where one exists, no word-for-word copy of another language's phrasing, and that nothing the
customer needs (what comes with it, the serving size, takeaway) has been lost compared with the internal name and
the other languages.

Names marked "given" were entered by the venue and are never changed. Leave a name alone when it is already right.

Reply with JSON only, no prose, listing only the names you would change:
{"changes": [{"id": "p01", "language": "ca", "name": "...", "reason": "..."}]}
"changes" is an empty list when every name is right. Write reasons in English.
```

The user message was `Names:` followed by a JSON list of `{id, internal, category, names, given}`,
where `given` lists the languages the venue entered; placeholders were not sent.
