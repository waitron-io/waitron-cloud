# Run Waitron Cloud in production, and let it run itself a little more each time

**2026-10-22 · Item 1 of the [launch platform work](../../backlog.md#launch-platform-work-in-priority-order) ·
Design from the owner's design session. Approved by the owner on 2026-10-22 for building and
rehearsing locally; AWS accounts and spending need a separate go-ahead (section 12).**

This document says how Waitron Cloud is deployed and operated in production. Where a
sentence records an owner decision it says so, with the owner's words where they were
given. Everything marked **(our call)** is a recommendation the owner delegated ("I know
very little about cloud so I'm happy for you to recommend everything") and can overturn.

**Handover revision, 2026-10-23:** the owner rejected the earlier A1018 external
stop-proof model. Sections 3, 6, 9 and 12 now follow the [revised shared direction](../../waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018).
The owner’s 15:37 correction assigns all AEAT communication to M2 after either
takeover; returning M1 transfers fiscal originals and outcomes without AEAT contact.
The owner approved the revised design, both Harbour Kitchen examples and retained
defaults on 2026-10-24 at 04:07, recorded in [Waitron
`060966c2b3e9203acf0849042814997307cae463`](https://github.com/clintongormley/waitron/blob/060966c2b3e9203acf0849042814997307cae463/docs/superpowers/specs/2026-10-23-a1018-simple-handover-design.md).
That approval supersedes the pending-question wording at the historical Cloud
contract pin. Exact formats, compatible A947 amendments, separate A1018 build
authority and runtime qualification remain open.

## 1. Why

No public Cloud service exists yet ([backlog](../../backlog.md): "No public cloud service is
deployed"). Remote access and backups are the agreed first paid services, and Waitron's
customer-facing features (online booking, table QR ordering, online ordering, delivery)
all wait on remote access. So Cloud has to run somewhere real, soon after Waitron's
go-live.

The owner wants Cloud to run itself (2026-10-22):

> The idea is that cloud would be as automated as possible. When we have to add a new
> customer, they should do the sign-up themselves. It should require zero work from us.
> Monitoring should lead to automated problem handling. We should spot problems ahead of
> time and take actions to avoid them growing. We should rebalance deployments before we
> get hot spots. We want as few employees as possible, and I don't want to have to pull
> myself away from my holiday to solve urgent issues.
>
> That said, I know this is a dream and we won't get there fast, if ever. But we need to
> learn from each problem we solve to make things better every time.

And it must be reliable from the first venue: "if our service is flaky then we'll never
convince the millions to join us, so we need to make the service super reliable from the
start."

## 2. Goals, non-goals, anti-goals

**Goals**

- Cloud runs in production in Spain, serving remote access and backups to on-prem venues
  **and** hosted venues (each venue's own Waitron server in Cloud) from day one (owner,
  2026-10-22, choosing "both from day one" over launching with on-prem venues first).
- Every server, network and DNS record is described in files in this repository, so a new
  country, cell or region is created by running those files, never by hand.
- Every automatic action Cloud can take is listed, with whether it asks the owner first or
  acts and reports. Moving an action from the first to the second is a deliberate,
  recorded step (section 6).
- Every incident leaves the system better: its write-up names the check, self-repair or
  written procedure that would have caught or fixed it, and that goes on the backlog
  (section 7).
- A failure touches as few venues as possible: one machine, then one cell, then one
  country, never all countries at once.

**Non-goals for this design**

- Billing, prices and plans (launch item 3), legal terms (item 4), the single-owner
  account lifecycle replacing roles and invitations (item 5), support (item 6).
  Section 4 records the owner's account boundary; it does not implement these services.
- The thresholds and on-call rules of monitoring: the
  [C39 thresholds design](2026-10-22-cloud-monitoring-thresholds-design.md) covers what to
  watch. This design covers what Cloud *does* with what it sees, and corrects C39 where it
  says Cloud never acts (section 3).
- Countries after Spain. The design must make each new country a repeat of Spain's
  files, not a project; it does not build Italy, the UK, New Zealand or South Africa.
- A running standby for a hosted venue. Recovery stays cold, as the owner chose on
  2026-10-21 ([hosting proposal](2026-10-21-cloud-hosted-venue-design.md)).

**Anti-goals: it fails even if it works when…**

- it needs the owner every week, or interrupts a holiday for something Cloud could have
  handled or waited on;
- a problem in one country, cell or machine takes down venues elsewhere;
- a fix is applied by hand and leaves nothing behind, so the same problem costs the same
  next time;
- automation starts a replacement without controlled handover or the explicit
  emergency declaration, bypasses source restrictions or assigns AEAT communication
  to M1 after takeover (section 9);
- launch is so ambitious it never ships.

## 3. What this design corrects in the existing proposals

The owner said on 2026-10-22 that the following statements were written by earlier
sessions and are not his decisions ("That was you who came up with that statement. My
intention has always been to automate as much of this as possible."). This design
replaces them:

| Proposal | Its words (or, marked, a summary) | Replaced by |
| --- | --- | --- |
| [C39](2026-10-22-cloud-monitoring-thresholds-design.md) | "No automatic failover, repair, permission, key, security or activation change follows an alert" | Each action's own status in the action list (section 6). Security, key and permission changes stay ask-first until the owner moves one. |
| C39 | "You are the sole operator on call", with (summary) a 10-minute acknowledgement | True at launch. The design's aim is that pages shrink as actions move to act-and-report (section 6). |
| [C41](2026-10-22-cloud-release-upgrade-design.md) | (summary) the owner approves each stage; "If you are unavailable, pause expansion" | Release waves widen by themselves while health holds, starting slow and loosening with a clean record (section 8). |
| C41 | "initially, one disruptive venue operation globally" | At most one disruptive operation per cell at launch (our call); per country and cell, never global. |
| C41 | waves of "min(20, max(1, ceil(10% of the frozen eligible population)), remaining venues)", each meeting "24 continuous healthy hours" | Starting values, not limits: they loosen automatically (section 8). |
| [Hosting proposal](2026-10-21-cloud-hosted-venue-design.md) | (summary) one shared Cloud for all venues, with country packs choosing storage regions only | Each country runs as its own Cloud under one global layer (section 4). |

The owner's 2026-10-23 handover model replaces the hosting proposal's universal
external stop-proof rule (section 9). The cold recovery choice and D101's data rules
remain. Automation status supplies neither the controlled final copy nor the
authorised person's emergency declaration.

## 4. The shape: countries, a global layer, cells, machines

**Owner, 2026-10-22:** "One global cloud with country subdomains, so the service is
devolved to local hosting providers and one problem on the cloud doesn't take down all
countries at the same time." "Deployments should be relatively small clusters so that when
something goes wrong it affects just a subset of customers and it is quick to solve by
moving just that small group."

- **A country** runs as its own Cloud: its own cells, its own copy of the country's
  services (remote-access gateways, backup storage and verification, monitoring, hosted
  venues), customer accounts and sign-in, its own DNS records and its own second region
  for failover. Spain is the first. Nothing a country needs for customer flows depends
  on the global layer, including fresh sign-in, account recovery and box recovery.
- **A customer account belongs to one country (owner, 2026-10-24 11:07).** Marta
  signs in at `es.waitron.io`; Spain owns her credentials, sessions, account security,
  recovery, organisation and venues. A Frankfurt outage is invisible to her customer
  flows. The same human operating in two countries has two separate accounts. Each
  customer organisation has **one Cloud account owner per country**, with no invitations,
  manager accounts or concurrent second owner. This replaces the earlier delegated
  starting line, "organisations and their members", and global customer sign-in tokens.
  It does not change staff roles inside Waitron or grant fiscal/activation permission.
- **The global layer** keeps the owner's worldwide operator console and the
  `waitron.io` apex routing people to their country, optionally billing. It holds no
  venue data under this design. It runs in its own AWS account in Frankfurt
  (`eu-central-1`), failing over to another EU region, so neither a Spain outage nor a
  Paris one takes it down. **It is separated from Spain before launch** (owner,
  2026-10-22). Customer access through a country's name cannot require the apex to
  answer or global to issue/refresh authority. Operator-console loss may delay
  ask-first operations; ordinary customer work and recovery remain country-local.
- **A cell** is a small group of machines in one country and region, with its own
  remote-access gateway, operated and recovered together (the hosting proposal's
  definition). A cell is the unit that fails, upgrades and moves. The current code caps a
  cell at 64 venues (`packages/remote-access/src/config.ts`); **(our call)** keep 64 as the
  starting cap and revisit it from measurements.
- **A machine** runs many venues' workloads side by side (section 5).

**Billing recommendation, not approved implementation.** Put customer billing and
its self-service path in the country so global loss cannot block them. The later
billing design decides provider, records and processing scope; optional global
billing must still meet the no-customer-dependency rule. Worldwide aggregated
reporting needs a later privacy/data-scope agreement before any export or storage.
It cannot become a dependency of a country customer path.

**Owner transfer is future work.** A country-scoped verified transfer/recovery
must replace the single owner without an invitation, concurrent second owner or
automatic support takeover. Lost-owner recovery needs its own evidence and abuse
controls; this document supplies no transfer endpoint or support permission.

**P3 dependencies and Lane G follow-up.** One migration chain currently holds
accounts and venue services together; P1's database is transitional. G owns the
P3/P4 plans and launch priority 5, and must revise, review and re-ask P3 plan
approval against the owner's decisions. The affected boundaries are:

- P3's data classification, schema ownership and copies: keep customer identity,
  credentials/factors, sessions, organisation/sole owner, legal-business profiles,
  plan/service state, security audit and account mail/recovery in the country;
  remove global customer profiles, membership copies and invitation assumptions.
- P3's signed global customer permits, offline trust, revocation and actor adapters:
  replace the global customer issuer dependency with country-owned authentication,
  permission and final rechecks. Keep global operator authority separately scoped;
  customer ownership never confers operator or Waitron activation authority.
  G must reconcile its proposed `ControlScope`/`ControlClaims`, `ControlTrust`,
  session exchange, revocation barrier and `HumanAuthority`/`CountryControl`
  interfaces; this document accepts no new encoding or permission contract.
- P3's API/portal routing, cookies, factor/signup/reset mail and customer recovery:
  make every journey country-local, including starting a new box recovery during
  global loss. Reconcile plan/entitlement and account allowance handling with the
  country boundary; billing remains a later design.
- P3's cutover, keys, migration, backup/restore and failure acceptance: separate
  customer and operator custody, preserve IDs and security/fiscal assertions, and
  prove fresh customer sign-in and both account/box recovery with global absent.
- P4's P3 authentication/approval and notification dependencies: distinguish the
  worldwide operator from the sole country customer owner, keeping action records
  and checks in the country. Global loss supplies no emergency declaration.
- Launch priority 5's roles/invitations scope: replace multiple Cloud users with
  the single-owner lifecycle and future verified transfer/recovery above. G also
  owns the coordinated canonical A1018 status notice; preserve historical pins
  while recording the 24 October design approval and remaining format/build gates.

**Names (owner, 2026-10-22).** One domain, `waitron.io`, with one subdomain per country.
Every venue keeps one stable public name under its country's subdomain
(`<venue>.es.waitron.io` is our guess at the format) that never changes when the venue
moves between machines, cells or regions. "Most venues will end up using their own custom
domains": a venue points its own domain at its Waitron name, and Cloud obtains and renews
that domain's certificate itself. `waitron.app` is not registered and is not used.
**(our call)** A custom domain applies to the venue's customer-facing name only. Staff
remote access keeps the Waitron name, whose certificate key stays on the venue's box
(`staffHostname` and `publicHostname` in `packages/remote-access/src/config.ts`).

**Data and failover regions follow each country's law (owner, 2026-10-22: "this depends on
the laws of each country but yes both are possibilities").** The country pack already names
a country's home region and permitted backup regions (hosting proposal); it also names
the regions a country may fail over to, inside the country where the law requires it, a
neighbouring country where the law allows it, and any provider the law requires. For
Spain the approved D101 rules hold: data, logs and keys in `eu-south-2`, an encrypted
backup copy in Paris (`eu-west-3`). **If AWS's Spain region fails completely, Spain's
Cloud runs from Paris until Spain returns** (owner, 2026-10-22). D101's rule becomes "in
Spain, except during a regional failover"; the keys and the management database need
copies usable in Paris; the question goes to the lawyer with D101's six. Amending the
D101 design document is a step of the plan, not of this document.

## 5. Placing venues and moving them before machines get hot

**Separating venues on one machine (our call).** The hosting proposal says Kubernetes
namespaces alone are not isolation and need security approval. Each hosted venue's server
runs in its own sandbox (gVisor, which works on ordinary machines) in addition to its own
namespace, its own disk and its own network rules. The owner's security approval of that
choice was given on 2026-10-23; runtime isolation still needs qualification. A change
to a stronger sandbox would need its own sizing and cost evidence.

**Owner, 2026-10-22:** hosted venues run "one isolated Waitron server per venue … but we can
have several of these running on individual servers to make hosting cost effective. We
need to have a plan for how to balance busy venues with quieter venues."

- Cloud decides which machine each venue's workload runs on. It places by **when** venues
  are busy as well as how busy: a breakfast café and a dinner restaurant share a machine
  better than two dinner restaurants. **(our call)** Each venue's past week of load, hour
  by hour, is its profile; a new venue starts with its country's typical profile.
- Every machine keeps spare room, and every cell keeps room for its largest machine to fail.
- Cloud moves a venue **before** a machine or cell gets hot, not after. A move is routine
  and frequent, not a rescue.
- **A hosted venue's move is a short stop of its server** (section 9), so planned moves
  happen in that venue's quiet hours, read from its own profile; only a failure moves a
  venue during trading.
- Remote-access and backup work for on-prem venues moves without stopping anything at the
  venue: the box keeps trading on its own server throughout.

## 6. Automation: start hands-on, hand over one action at a time

**Owner, 2026-10-22:** "Certainly initially I'd want to be involved with problem resolution.
As we start recognising common issues and introducing automations to solve them, I'd
become less hands on."

- Cloud keeps **an action list**: every action it can take (restart a workload, move a
  venue, drain a machine, replace a machine, add a machine, create a cell, fail a country
  over, widen or pause a release wave, rotate a certificate, …). Each action has a status:
  - **ask first**: Cloud prepares the action, tells the owner what it would do and why,
    and waits;
  - **act and report**: Cloud does it and tells the owner afterwards.
- Every action starts as ask first, except restarting a failed workload in place and
  replacing a failed machine, as initiation exceptions **(our call)**. These grant no
  hosted writer or fiscal authority: a replacement still meets section 9's selected
  handover scenario. Kubernetes/AWS restart alone supplies no final-copy equality
  or emergency human declaration.
- **Routine work is not on the list (our call).** What the system already does as a matter
  of course (renewing a certificate, adding a machine when a cell needs capacity, retrying
  a failed backup, updating a gateway's routes) keeps happening by itself. The list covers
  repairs and changes that carry risk.
- **On launch day (our call)** the action list exists in code with every repair action ask
  first, Cloud asks through the console and a notification, and releases widen one wave at a
  time on the owner's say. The self-widening waves of section 8 and the trend checks follow,
  in that order, as the first automations; they are the plan's second milestone, not a
  condition of launch.
- Moving an action to act and report is a recorded change in this repository, made by the
  owner, with the incidents it was tried on as its evidence. Moving it back is the same.
- An action that is still ask first and cannot reach the owner waits safely: it never
  makes things worse by acting, and it holds the situation stable (for example, a release
  stops widening) until someone answers.
- **Prediction comes before reaction.** Cloud watches trends (disk filling, memory
  growing, a machine's load creeping up, a certificate nearing expiry) and acts, or asks,
  while there is still time, not when the limit is hit.

The action list lives in one place, in code, and the owner's console shows it.

## 7. Every problem leaves the system better

**Owner, 2026-10-22:** "we need to learn from each problem we solve to make things better
every time."

An incident is not done when the venue is working again. It is done when its short
write-up exists and names at least one of: a new or sharper check that would have seen it
sooner, a new action (or an existing one moved to act and report) that would have fixed it,
or a written procedure for the part that cannot yet be automated. Each of those becomes a
backlog entry. The incident procedure in [incident-response.md](../../incident-response.md)
gains this step.

## 8. Releases: slow at first, faster with experience

**Owner, 2026-10-22:** "We need initially slow rollouts of new versions, but that can scale
more quickly as we gain experience."

- A release goes out in waves: first one cell's test venues, then a few real venues, then
  wider.
- Wave size and the wait between waves are **settings that change themselves**: they widen
  after releases go cleanly and narrow again after one that does not. C41's 20-venue,
  24-hour wave is the starting setting.
- A wave continues by itself while health holds, and stops by itself when it does not.
  Resuming a stopped release starts as ask first (section 6).
- One country's release never waits on another's, and a release reaches each country's
  cells one at a time.
- C41's rule stands that an upgrade migrates forward and is not rolled back after the venue
  trades on the new version; that comes from Waitron's fiscal rules.

<a id="9-the-rule-automation-must-never-break-one-writer-per-venue"></a>

## 9. Replace a venue server through the selected handover scenario

The owner's 2026-10-23 direction replaces universal external stop proof with the
[A1018 controlled/emergency protocol](../../waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018).
It works local to local without Cloud or internet and in both local/Cloud directions
and Cloud to Cloud. Each M2 keeps its own node identity and activates a fresh fiscal
identity, chain and series through Waitron's existing module gates; it does not
continue M1's writer chain.

For a controlled move, M1 durably steps down, bounds admitted work and transfers
complete frozen final state. M2 durably verifies it before M1 relinquishes filing
to that selected M2. M2 checks the signed assignment and records activation before
work and routing. Failure or a lost reply resumes the same operation and target;
unknown copy/filing history waits, without a speculative replacement.

For an emergency, a freshly authenticated authorised person explicitly declares
M1 shut down, no parallel recovery, and acceptance of the selected copy's unknown
missing tail. A hosted source needs the person's provider-console stop declaration
bound to the exact resource and restart prevention. Cloud cannot generate it from
an alert, timeout or an act-and-report permission. Persist M1’s restricted role
and M2’s sole AEAT responsibility before activation. After either takeover M2 files
unfiled copied and later-returned old originals in their generating identities and
new sales in its own identity. Returning M1 contacts no AEAT service; it transfers
missing fiscal originals, all received outcomes including those for copied records,
and unanswered request facts. No emergency predecessor ownership hold prohibits M2
filing. Keep temporary per-chain pauses during return-batch application and domain
filing-case holds. Other business changes remain archived with a visible gap.

An isolated running M1 can still trade until it learns of the newer signed role.
The explicit warning discloses bills, payments, cash and stock divergence. Distinct
chains avoid sharing one writer chain; they cannot merge that business history.
The two-scenario protocol does not promise clone resistance or provider process-death
proof. The action list controls initiation only; no automatic failover invents the
human declaration or bypasses copy, filing, authentication or activation gates.

A separately selected cold restore keeps its existing recovery source, key,
operation and sole-recovery gates and accepted tail loss, with a fresh chain and
no added hard-stop proof. Failed handover never silently becomes restore or emergency.
The revised protocol and retained defaults have owner design approval at the
24 October Waitron pin above. Exact formats, compatible A947 amendments, separate
A1018 build authority and runtime acceptance remain required.

## 10. How it is built (our call, all of it)

- **AWS to start, without depending on it.** Spain runs in AWS (`eu-south-2`, already
  chosen). Each country, and the global layer, gets its own AWS account under the existing
  AWS Organization, so a mistake or failure in one account cannot reach another country.
  Everything AWS-specific stays in one layer, so a country whose law needs a local provider
  can use one.
- **Kubernetes, AWS's managed version (EKS).** It places workloads on machines, restarts
  them and moves them, which is the model of section 5, and it runs on most providers. One
  cluster per cell **(our call)**, so a cluster's own upgrade or fault is contained to one
  cell.
- **OpenTofu** describes every account, network, cluster, machine group and DNS record in
  this repository.
- **Releases come from the repository.** A release is a change in the repository; a tool in
  each cluster applies it (Argo CD or Flux, the builder's choice), and a release controller
  drives the waves of section 8.
- **Cloud's own controller** decides placement, moves, wave progress and failover, and runs
  the action list of section 6. This is where Cloud's accumulated automation lives.
- **Machines:** start with 4 GiB general-purpose machines (t3.medium), three per cell, one
  in each of the region's three data centres. A cell's remote-access gateways, backup
  verification and its share of the deployment and monitoring tools run on those machines;
  there are no separate gateway machines. The builder sizes machines from measurement: the
  starting size is an estimate, not a limit **(our call)**.
- **What "reliable from the start" means for the build (our call), until launch item 4
  sets Cloud's promises:** losing one data centre, or one machine, takes none of remote
  access, backups or sign-in down. That rules out single-data-centre parts on those paths,
  such as one outbound internet gateway; the builder chooses how.
- **The outside monitor (our call)** runs at a second provider inside the EU, so it still
  works when AWS in Spain does not. It holds only the names it checks and whether they
  answered; it is added to D101's supplier register before it runs.

## 11. Day one, and what it costs

At launch: Spain only, **one cell** **(our call)** of three machines across three data
centres; the global layer separate; Paris failover kept **cold** (backups copied there
continuously, servers rebuilt from the repository's files when needed). A second cell is
created when the first passes half its cap; moving venues between cells is rehearsed on the
LAN test Cloud before that.

Estimate, AWS list prices in US dollars before tax, from Cloud's own
[price records](../../cost-model/prices.json) (AWS price files, read 2026-10-14):

| Part | Per month |
| --- | --- |
| Spain: three machines (t3.medium) | $100 |
| Spain: managed Kubernetes | $73 |
| Spain: management database in two data centres | $31 |
| Spain: outbound internet gateway | $35 |
| Spain: load balancer for remote access and public addresses | $37 |
| Spain: logs, metrics, alarms, keys, secrets, DNS, backups, disks | $47 |
| Global layer | about $130 |
| Paris, kept cold | about $5–10 |
| **Total** | **about $460** |

Each venue beyond the first machines' capacity adds about $6 a month. A warm Paris
standby would add about $140. The total is an estimate, not a ceiling: an outbound
gateway in each data centre adds about $70, and machines will grow once measured. The
builder resizes within about twice this total and tells the owner beyond that **(our
call)**. The owner accepted this starting size on 2026-10-22 ("That
sounds fine").

Measured inputs and gaps: one Waitron server (`ghcr.io/clintongormley/waitron:main`,
pulled 2026-10-22) settled at about 191 MiB, idle, in setup mode with no venue set up, run
under emulation on an Apple-silicon Mac; a trading venue was not measured, so the estimate
plans 512 MiB per venue, about six per machine. The t3.medium price is not in the price
records; it is taken as twice t3.small's, unverified. Internet traffic for remote access,
committed-use discounts and email are not included.

## 11a. What an on-prem venue costs Cloud

**Owner, 2026-10-22:** "we also need to calculate the cost of on prem hosting with cloud
backups, remote access, and ad hoc services like translations and rota optimization." Most
early Cloud customers are on-prem boxes buying these services, so their cost per venue is
as important as hosted venues'. The fixed platform in section 11 carries them; what each one
adds, per month, at the same list prices:

| Service | What drives the cost | Per venue per month |
| --- | --- | --- |
| Backups | The box's continuous copy to S3 is mostly small listing and upload requests: about 144,000 a month if the box is idle 9 hours a day (the cost model's assumption), 382,000 if it is on all day ($0.76–2.02). Storage of a few GB costs cents. Each venue's key is Cloud's own, protected by one master key ([managed-key operations](../../managed-key-operations.md)), and the stream supplies it with each upload, so a venue adds no key-service charge; the master key costs $1 a month per country | about $1–2 |
| Remote access | A share of the cell's machines for its gateways (two small gateways would be about $0.52 a venue at 64 venues a cell); traffic out to browsers at $0.09 a GB. An owner's remote session measured 2.8 MB, so 30 sessions cost about a cent; customer-facing pages are unmeasured, about $0.09–0.90 at 1–10 GB | about $0.60–1.50 |
| Translations | The [translation design](2026-10-14-translate-all-design.md)'s measured price: about $0.007 per 100 products per language, so a 358-product menu costs about $0.03 a language. Capped by design at $5 per venue a month | usually under $0.20 |
| Rota solver | Not measured. If one weekly solve takes a minute on 2 processors and 4 GB, run only when asked, it costs about $0.002 | a few cents |

So an on-prem venue adds roughly **$2–4 a month**, plus its share of the fixed platform
(about $460 a month for the whole of Spain at launch). Inputs: the backup request counts are
Cloud's own measurement of a replayed day of 207 sales
([usage projection](../../cost-model/usage-projection.json)); the owner session is the
measured [browser journey](../../cost-model/remote-owner-browser.json); everything else is
an assumption named in the table. About 99% of the backup requests happen while the box is
idle: in 20 idle minutes Litestream listed the bucket 171 times and uploaded 5 times, against
65 requests for 207 sales. Waitron sets only Litestream's daily snapshot, week of history and
`l0-retention` (`packages/stream/src/litestream.ts` in Waitron); everything else is
Litestream 0.5.17's default. Whether a slower idle check is safe, and what it saves, is
unmeasured. The billing design (launch item 3) turns these into prices.

## 12. What approving this design allows, and what is left open

**Approval allows building and rehearsing locally** (owner, 2026-10-22): the
infrastructure files, the split of the global layer, Cloud's controller and the action
list, all rehearsed on the LAN test Cloud. Opening AWS accounts, spending money and
production schema changes wait for a separate go-ahead from the owner once the rehearsal
works.

**Depends on Waitron.** P6 needs section 9's approved A1018 design translated into
jointly accepted formats, compatible A947 amendments, separate build authority
and qualified consumers. P7 rebuilds the country platform without inventing
venue activation authority: each recovered venue explicitly uses controlled handover,
emergency declaration or separately selected cold restore. Rebuilding infrastructure
or approving an automation never supplies missing venue evidence or fiscal permission.

**For the owner**

- No duplicate D88 or A1018 design question remains ready now. A1018's examples
  and retained defaults are approved on 2026-10-24; gVisor and Spain-from-Paris
  were approved on 2026-10-23. Existing local build/rehearsal authority stands.
- Later billing design, any global reporting privacy/data scope and country-specific
  legal/provider qualification remain separate. Customer account data belongs to
  its country, including future non-EU countries; Frankfurt is not its default.

**For the builder**

- The exact action list and each action's evidence of safety; the trend checks and their
  lead times.
- Cell cap from measurement; the placement score's details; the quiet-hour model.
- Argo CD or Flux; how the release controller and Cloud's controller divide work.
- The revised handover's final-copy/local-state inventory, actor binding, per-chain
  filing ownership and same-M2 retry format, jointly with Waitron before build.
- Measuring a trading venue's memory and the remote-access traffic, then re-pricing.
- Reconcile P3/P4 and launch priority 5 as listed in section 4. P6/D115 carries
  D88's runtime/build delivery after P1/P4 and joint protocol acceptance; A951,
  D101, P3 and P7 retain their separate access, data, account and recovery gates.
  Reliability promises and pricing follow measurements at launch, not a new
  blanket design-approval gate.
