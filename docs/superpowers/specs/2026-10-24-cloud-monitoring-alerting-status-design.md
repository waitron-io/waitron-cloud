# Know when Cloud is broken, work out why, and tell the right people

**2026-10-24 · Item 2 of the [launch platform work](../../backlog.md#launch-platform-work-in-priority-order) ·
Design from the owner's design session. Approved by the owner on 2026-10-24 for building and
rehearsing locally; accounts and spending need a separate go-ahead (section 16).**

This document says how Waitron Cloud notices a problem in production, how it works out
what is wrong, when and how it wakes the owner, what the public status page says, and how
errors and problem reports from venues reach Cloud. Where a sentence records an owner
decision it says so, with the owner's words. Everything marked **(our call)** is a
recommendation the owner can overturn.

It builds on three earlier papers and changes some of what they say (section 3):

- the [C39 thresholds design](2026-10-22-cloud-monitoring-thresholds-design.md), approved for
  planning only on 2026-10-22, which says what counts as failing and when;
- the [incident runbook](../../incident-response.md) (D104), which says what the owner does
  during an incident and proposes a status page;
- the [production deployment design](2026-10-22-cloud-production-deployment-design.md),
  approved for local building on 2026-10-22, whose action list (its section 6) says which
  repairs Cloud may make by itself.

## 1. Why

No real venue should depend on a Cloud nobody is watching
([backlog](../../backlog.md#launch-platform-work-in-priority-order), item 2). Today the
checks run only for test installations, there is no phone route, no history kept for
comparison, no check from outside the failing part, and no status page.

The owner wants as little of their own time spent on incidents as possible (2026-10-22,
quoted in the deployment design: "I don't want to have to pull myself away from my holiday
to solve urgent issues"), but wants to stay in charge of fixes at first (2026-10-24):

> Prepare a problem statement, do the investigations, hopefully come up with the fix.
> Whether to apply the fix is harder, maybe initially I'd want my go ahead before having a
> fix applied automatically.

And noted that not every error is a problem (2026-10-24): "Some level of errors might be
normal."

## 2. Goals, non-goals, anti-goals

**Goals**

- Every fault in what Cloud runs is noticed by plain programs, from outside the part that
  failed, without any AI running between incidents.
- When a fault is confirmed, an AI investigator works out what is wrong and proposes a
  fix, and the owner is woken once, with that statement in hand.
- The public status page says what is wrong without anyone touching it.
- Errors from venue boxes (where the venue agreed) and problem reports from venue staff
  reach Cloud, are grouped, and turn into bugfixes; a new error after a release stops that
  release spreading.

**Non-goals**

- Fixing a venue's own box, power or internet (section 4).
- Billing, terms and promised service levels (launch items 3 and 4). Nothing here is a
  promise to venues.
- The support desk and operator console as a whole (launch item 6). This design needs a
  work list and an incident page in the console; item 6 designs the rest.
- Changing C39's thresholds. They stand except where section 3 says otherwise.

**Anti-goals: it fails even if it works when…**

- the owner is woken for something that is not Cloud's fault, or for a blip;
- a dead watcher, a dead AI service or a spent AI budget means nobody is woken;
- the AI's guess, or a venue's name, appears on the public page;
- an investigation applies a change by itself that the owner had not allowed;
- error reports carry customer, staff or invoice data out of a venue;
- an AI runs, and spends money, while nothing is wrong.

## 3. What this design changes in the earlier papers

| Paper | What it says (quoted, or marked as a summary) | Replaced by |
| --- | --- | --- |
| C39 | (summary) a P1 phone page is sent when the signal's rule qualifies | The owner is paged when the investigation finishes, or 15 minutes after the fault is confirmed, whichever is first (section 8). Owner, 2026-10-24: "I should be paged after the investigation, not before." |
| C39 | "First committed P1 eligibility starts the acknowledgment clock" | The 10-minute acknowledgement clock starts at the first page attempt, whether or not either provider delivers it. The repeat at 10 minutes and the unattended marker at 20 minutes are unchanged, counted from then. |
| C39 and D104 | (summary) acknowledgement comes from the authenticated operator and names the incident | Pressing 1 on the call acknowledges that incident's page and stops the repeats (our call). It approves nothing: every go-ahead still needs the owner's passkey (section 8). |
| Deployment design, section 10 | the outside monitor "holds only the names it checks and whether they answered" | It also holds open incidents' paging state, the paging and status-page credentials, and the Anthropic API key (section 12, our call). It holds no logs and no venue data. |
| D104 | (summary) the status page is published from the owner's own Cloudflare login with a second factor | Automatic updates use an upload token limited to the status-page project, kept on the outside machine (our call). The owner's own login stays for by-hand updates. |
| C39 | (summary) missing installation contact pages at 20 minutes, for any installation | Pages only for a venue server Cloud hosts. An on-prem box going quiet never pages; its owner gets the existing opt-in email (section 4). |
| D104 | "Publish a short status update once you confirm customer impact", by hand, through Direct Upload | The page updates itself from fixed sentences (section 9). The owner can still add text, and the by-hand route stays as the fallback. |
| D104 | "No provider or paid subscription is selected here" | A text message with the details, then a phone call, through a voice-and-text provider, with a second provider as backup (section 8). |

The deployment design's correction of C39 ("No automatic failover, repair…") stands: an
investigator's fix that is an action on the list follows that action's status (section 7).

## 4. What Cloud is responsible for

**Owner, 2026-10-24:** "We run the cloud services and waitron servers on cloud. We're not
responsible for somebody's box on prem. That said we need to monitor errors coming from on
prem boxes, especially new errors after an upgrade, so that we can release a bugfix
version."

- **Ours:** Cloud's own services (account portal and its service, remote access, backup
  storage and verification, email, the monitoring itself) and every venue server Cloud
  hosts. A fault in these is an incident and can page.
- **Not ours:** a venue's own box, its power and its internet. A box going quiet is shown
  as offline in the console and its owner gets the existing opt-in "your box has not
  checked in" email ([local monitoring](../../local-monitoring.md)); nobody is paged.
- **The software on every box is ours.** A bug spreading across boxes after a release is
  ours to fix, even when the boxes are not (section 10).
- **Telling the two apart (our call).** Remote access to an on-prem box runs through Cloud,
  so a single box going quiet is treated as that venue's, and many boxes in one cell going
  quiet together is treated as Cloud's. The builder sets "many" from the trial's
  measurements; until then, more than one venue in a cell within 5 minutes opens a Cloud
  incident for the cell's remote access, and the outside checks of the gateways decide it.

## 5. What tells Cloud there is a problem

Six kinds of signal. Every one is plain code; none uses AI.

1. **Is it working?** Outside checks every minute act like a user: each venue's remote
   address, the account portal and its service, backups arriving on schedule and passing
   verification (all already in C39), and, new here, each hosted venue server answering a
   "can this venue trade?" check. The builder defines that check with Waitron; it must
   exercise the server, not just its front door.
2. **Is it getting worse?** Cloud's own machines: disk filling, memory growing, load
   creeping up, queues ageing (email, backup jobs). The deployment design's section 6 asks
   for these trend checks; their trigger points are the builder's, set so the action or
   question comes while there is still time.
3. **Are real requests failing?** The share of real requests to Cloud and to hosted venue
   servers that fail or are too slow. C39 left these out because normal had not been
   measured. **(Our call)** Set a target per service (for example "99.5% of requests
   succeed"), page when failures run at about ten times the normal rate for five minutes,
   and open a work item when they run at about twice normal for some hours. The numbers
   come from the trial (section 14), not from this document.
4. **Did a release break something?** Error reports from boxes, grouped by error and
   version (section 10).
5. **Are people telling us?** Problem reports from venue staff, sorted for urgency
   (section 11).
6. **Is the watcher alive?** The checker reports in every minute to the outside machine
   (section 12). If it stops, the outside machine raises the incident itself. C39's
   collector rows already define the timings.

**(Our call)** Two more: the cloud provider's own health notices for our regions, and a
spending alarm when the month's bill is climbing faster than expected.

A signal becomes a confirmed fault by C39's rules (for a route: fresh failures spanning 3
minutes; closed by two good checks at least a minute apart). Faults with a shared cause,
such as every venue in a cell, are grouped into one incident.

## 6. What pages and what waits

**Owner, 2026-10-24:** "I think I should be paged, at least initially. We can change that
with experience."

- **Urgent, and paged:** C39's P1 list, limited by section 4 to what is ours, plus the
  hosted "can trade" check, signal 3's fast rule, a release error that stops venues working,
  and an urgent staff report.
- **Not urgent, on the work list:** C39's P2 list, signal 3's slow rule, new release errors
  that do not stop venues working, and grouped staff reports. No call and no text.
- **(Our call)** A short daily text summarising new work-list items, sent at a daytime hour
  the owner sets, only when there is something new.

Which incidents page is a setting in the repository, changed the same way an action moves
on the action list: by the owner, with the incidents behind it as the reason.

## 7. Working out what is wrong: the investigator

**Owner, 2026-10-24:** "these should be automated jobs running in the background". The
owner first wanted login quota, then chose an API key once the terms were weighed: "It
looks like an API key is the only legal way forward. We'll go with that for now."

**How it starts.** In the same write that opens an incident, the checker adds a job to a
queue ("investigate incident 42"), using the same durable-queue pattern as Cloud's email
outbox, so a job is neither lost nor run twice. A small plain program, the **launcher**,
takes jobs from the queue. Reading the queue costs nothing. For each job it runs
Claude Code without its chat window (`claude -p "<investigation brief>"`), which does the
work and exits.

**Where each record lives (our call).** Two places open incidents, and each keeps its own:

- Cloud's checks, inside AWS, open incidents in Cloud's database, and queue the
  investigation there. The outside machine copies each open incident's identity, kind,
  affected count and deadlines as soon as it opens, and from then on owns its paging: the
  15-minute deadline, the acknowledgement clock, the repeats and the "press 1" reply
  all live on the outside machine, so a Cloud outage cannot stop them.
- The outside machine's own checks (Cloud unreachable, the watcher silent) open incidents
  on the outside machine itself, and queue their investigation there.

The launcher reads both queues. The investigator gets its evidence from a read-only
endpoint in Cloud that hands out the cleaned bundle of section 13. When Cloud cannot be
reached, it investigates with what the outside machine holds, says so in its statement,
and the page still goes at the deadline.

**Which incidents are investigated (our call).** Every urgent incident, at once. Work-list
items and grouped staff reports are investigated in one batch run each day at an hour the
owner sets, so the anti-goal "an AI runs while nothing is wrong" holds: a batch runs only
when the list has something new.

**Where and as whom.** On the outside machine (section 12, our call), using an Anthropic
API key of its own under Anthropic's commercial terms (owner, 2026-10-24), which is what
D101 qualifies Anthropic under (section 13). The key belongs to Cloud alone: it is not
shared with the campaign lanes, and nothing else uses it.

**Model (our call).** Opus 5.5 at high effort, the owner's default for everything. It runs
only when an incident opens, so its use stays small.

**What it may do.** Read only: the incident and its evidence, the outside checks' history,
recent releases and settings changes, the error groups, and the code. It changes nothing.
It cannot reach venue data, keys or secrets (section 13).

**What it produces**, written onto the incident:

- a problem statement: what is broken, since when, for whom, the likely cause and the
  evidence;
- a proposed fix, and how that fix is undone;
- or, when it cannot tell, what it ruled out and what it would look at next.

**Two kinds of fix.**

- **An action already on the action list** follows that action's status. At launch nearly
  all are ask first, so it waits for the owner's go-ahead.
- **A fix it invents** (a code change, a settings change, a new kind of action) always waits
  for the owner, and goes out as a normal release through the waves of the deployment
  design's section 8, never patched straight into production. **(Our call)** At launch,
  "go ahead" on such a fix files it as an urgent work item carrying the problem statement
  and the proposed change, built and reviewed the normal way by the owner or a development
  lane; nothing builds and releases it automatically. An automatic build path is a later
  automation, added the same way as any other. A hosted venue server is not
  rolled back after it has traded on a new version (C41, from Waitron's fiscal rules), so
  its fix is a forward bugfix release.

A fix with no undo, and anything touching fiscal records, keys or permissions, stays ask
first permanently.

**Limits (our call).** One run per incident, shared by grouped faults. A spending cap per
run, per day and per month, the investigator and triage agent together. A run that hits
its cap, or cannot start because Claude is down or the budget is spent, stops, and the
page goes out at the 15-minute deadline with what is known (section 8). The owner sets the
caps with the spending go-ahead; the trial's measured cost per run informs them.

## 8. Waking the owner

**When.** When the investigation finishes, or 15 minutes after the fault is confirmed,
whichever is first (owner, 2026-10-24: "15 minute"). The page never depends on the
investigator: at the deadline it goes with whatever is known.

**How.** Owner, 2026-10-24: "I'd use SMS or WhatsApp rather than pager duty", and "I'd send
a message with the details and then call (when urgent)".

1. **A text message** with the details, from a fixed template (our call): the service, the
   number of affected venues, since when, whether a fix is proposed and, if it is an
   action on the action list, that action's fixed name (for example "restart the
   remote-access gateway, cell 1"), and a link to the incident's go-ahead page. The
   investigator's own words are read on that page, behind the passkey, not in the text,
   because the text passes through a provider outside the EU and C39 keeps venue names,
   hostnames and raw errors out of pages.
2. **Then a phone call.** A recorded voice reads one line, for example "Waitron Cloud:
   remote access down for 14 venues. Details sent by text. Press 1 to acknowledge."
   Pressing 1 is the acknowledgement C39 requires, tied to that incident.
3. **No acknowledgement in 10 minutes:** one more text and call; at 20 minutes the
   incident is marked unattended and monitoring stops widening to new venues, as C39 says.
4. If the owner does not answer, nothing riskier happens: Cloud holds things steady (for
   example a release stops widening) until someone does (deployment design, section 6).

**The go-ahead page** needs the owner's passkey (our call), so a forwarded or stolen text
cannot approve a fix. It shows the problem statement, the fix, how it is undone, and
"go ahead" or "not now".

**Providers (our call).** Twilio for the text and the call (one account covers the call,
the spoken line, "press 1" and the text). Vonage or Sinch as the backup route D104 asks
for, used when the first provider refuses or does not report delivery, so one company's
outage cannot silence both. WhatsApp is left for later: messages a business sends first
need a Meta business account, verification and pre-approved wording. Prices and terms are
checked when the accounts are opened.

**Getting through Do Not Disturb.** On Android, the owner saves the paging number as a
starred contact and allows calls and messages from starred contacts in Do Not Disturb.
"Repeat callers" also lets a second call within 15 minutes through. This is from general
knowledge of Android and has not been checked on the owner's phone; the launch drill
(section 14) checks it.

The page carries only the service, a count of affected venues, times and the incident
link: no venue names, addresses or raw errors (C39's data rules).

## 9. The public status page

**Owner, 2026-10-24:** "It should be automated."

- **Investigating**, posted as soon as a fault on Cloud's side is confirmed (section 4 decides
  what is Cloud's). A single on-prem box never appears.
- **Fix being applied**, once the owner has said go ahead, or once an act-and-report action
  has started.
- **Monitoring**, then **resolved**, once recovery is confirmed by C39's rule.

**(Our call)** The automatic posts use fixed sentences, in English and Spanish. Each one
shows what D104 requires: the affected service, its state, the UTC time, the known impact
at service level ("some venues" or "all venues", never a name), and the next update time,
30 minutes ahead to match C39's review of an open incident. They never name a venue and
never invent a recovery time; when scope is unknown they say so. The
investigator's words never go on the public page by themselves. The owner can add their
own text from the incident page.

**(Our call)** The page stays where D104 put it, on Cloudflare Pages outside AWS, and is
published from the outside machine (section 12) by an automated upload to the same
project D104 describes. Whether Cloudflare's own upload tool can publish to a Direct Upload
project is believed but unchecked; the builder confirms it before relying on it. D104's by-hand route stays as the
fallback for when the outside machine is down. D104's rules for what may appear publicly
are unchanged.

## 10. Error reports from boxes

**Owner, 2026-10-24:** on whether on-prem boxes send their errors to Cloud: "Should be opt
in".

- **On-prem boxes send errors only when the venue owner switched it on.** Setup asks the
  question plainly with the box unticked; the owner can change it later in settings
  (our call).
- **Hosted venue servers always report** (our call): they are Cloud's own service and their
  errors are its operating data.
- **What a report holds:** the error's code and where in the code it came from, the
  software version, when, how often, and the masked log lines A980's O9 decision allows
  ("Automatic reports contain only error/version/masked logs", quoted in D101 section 7).
  No customer, staff, product or invoice content, and no typed text.
- **Who may send (our call).** Only a box registered with Cloud, signing each report with
  the installation credentials registration already issues, so a forged spike cannot stop
  a release. Cloud knows which installation sent it (it needs that for hosted versus
  on-prem, the cell, and replies); the report body itself names no venue. A box with no
  paid Cloud service may still send, because release health benefits every venue.
- **What Cloud does with them:** groups them by error and version, and compares each
  version with the one before. An error that is new, or much more common, since a release:
  - stops that release spreading to more hosted servers (the deployment design's waves stop
    "by themselves when it does not" hold health; this is one of the health signals);
  - marks that version "held" for on-prem boxes (our call). C41 keeps on-prem update
    consent and the installer in Waitron ("not a remote-update permission"), so Cloud
    cannot stop an on-prem upgrade itself: Waitron's updater reads the hold before it
    offers or applies the version, and offers the fixed version once released;
  - opens a bugfix work item, and pages only if it stops venues working (section 6).
- **The price of opt-in:** on-prem release health depends on how many venues opt in. Until
  enough do, a version is offered to on-prem boxes more slowly (our call; the builder sets
  "enough" and the pace, inside Waitron's updater).

This needs work on Waitron's side: the opt-in setting, the sender, a box that keeps its
reports while it cannot reach Cloud, and the updater reading the hold. Those become Waitron
backlog entries when this design is approved.

## 11. Problem reports from venue staff

**Owner, 2026-10-24:** "We'd need a problem description and an attached error log and some
installation details. An agent would need to assess the urgency of the problem, compare it
to other similar reports, and either collate it with others for later investigation or
investigate and page me if more urgent."

**Sending one.** From the till and the dashboard (our call). A report carries:

- the description, in the person's own words and language;
- the box's recent errors, cleaned to the same rule as section 10. The form says they will
  be attached and the person can untick them; sending the report is consent for that
  report alone, whatever the box's automatic setting (our call);
- installation details: software version, hosted or on-prem, which device sent it, the
  attached equipment (printers, card readers) and when the box was last upgraded.

A box that cannot reach Cloud keeps the report and sends it when it can; the person sees
"sent" or "will send when back online" (our call).

**Typed text waits for an admin.** The owner decided on 2026-10-22 that "typed text needs
manager review and manual send" (D101 section 7), and confirmed it for these reports on
2026-10-24: "make it an admin decision to send". So a staff member's description waits
until someone with the venue's admin permission reads it and sends it, or discards it. The
errors and installation details go at once, so triage can already see an error spreading
before the words arrive. The person who wrote it sees "waiting for a manager to send".

**Sorting it.** Each report starts one run of a **triage agent**, the same way an incident
starts the investigator (section 7), on the same account. It:

1. judges urgency: urgent means venues cannot work and the cause is on Cloud's side;
2. compares the report with other reports and with the error groups ("three other venues on
   the same version reported this today; twelve boxes show the matching error");
3. then files it with its group on the work list for a daytime investigation, or, if
   urgent, opens an incident, which starts the investigator and pages as in section 8;
4. when the cause is clearly at the venue (for example the box cannot reach the internet),
   sends the venue practical advice instead, and pages nobody (our call). The advice is
   chosen from a fixed list of reviewed English and Spanish messages (for example "Your box
   cannot reach the internet. Card payments may fail; take cash until it is back."); the
   agent picks one, it never writes its own.

**Model.** Proposed: Haiku 5.5, because a report is short and reports may arrive many
times a day. That departs from the owner's rule that everything runs on Opus 5.5, so it is
the owner's call, and is adopted only if the trial shows it sorts as well (section 14).
Until then the triage agent runs on Opus 5.5.

**Replies (our call).** The sender sees "received" straight away; the venue owner hears by
email when their report's group is fixed.

## 12. The outside machine

The deployment design (section 10) already places "the outside monitor" at "a second
provider inside the EU, so it still works when AWS in Spain does not". This design gives
that machine more to do **(our call)**:

- the outside checks of section 5, and the "is the watcher alive?" check;
- the launcher, with the Anthropic API key the investigator and triage agent use;
- sending pages, and publishing the status page.

It is a small server, rebuilt from files in the repository like everything else. It keeps
only what those jobs need: the names it checks and their answers, open incidents and their
deadlines, and the paging and publishing credentials. It is added to D101's supplier
register before it runs, as the deployment design already requires. When it is down,
Cloud's own monitoring pages through the same providers from inside AWS, so one of the
two always can (our call).

## 13. Data rules

- **Anthropic becomes a supplier.** The investigator and triage agent send what they read
  to Anthropic. They read a prepared, cleaned bundle (errors by code, masked log lines,
  check results, counts, versions, release notes and code), never venue data, personal
  data, keys or secrets. Anthropic is added to D101's supplier register first. D101
  keeps Spain's data, logs and keys in `eu-south-2`; whether the cleaned bundle counts as
  such data is settled in the privacy review below.
- **D101's AI gate stays shut until it is opened for these inputs.** D101 section 4: "AI
  stays disabled while input eligibility is unresolved", and a separate privacy-reviewed
  rule must name the eligible inputs and exact content before any AI request is enabled.
  The investigator and triage agent run on the test Cloud and in rehearsal; in production
  they run only after that rule names their bundle and the report fields they read. Until
  then incidents still page at the 15-minute deadline, without a problem statement.
- **The account's terms.** D101 qualifies Anthropic through its commercial terms, which
  "name Anthropic Ireland Limited for EEA customers and incorporate a DPA". The owner chose
  an API key under those terms on 2026-10-24, because personal subscriptions are sold
  under consumer terms (believed, from Anthropic's published terms; rechecked when the
  account is opened).
- **Error reports** follow section 10's rule, and venue owners opt in.
- **History** (check results, error groups, incidents, reports) is kept for comparison and
  for incident reviews. How long is set by launch item 4 (terms); until then the existing
  data rules apply and nothing new is deleted automatically.

## 14. Learning, trial and launch drills

- **Every incident leaves the system better**, as the deployment design's section 7 says.
  The incident's write-up is drafted by the investigator and finished by the owner.
- **The trial** is C39's: 7 days watching only, then 7 days paging. It also measures what
  normal looks like for signal 3, and sets those numbers.
- **The AI parts are tested on staged problems** before they are relied on: staged
  incidents and sample reports, with known causes, are run through the investigator and
  the triage agent (and Haiku 5.5 beside Opus 5.5 for triage), and their answers are
  compared with the causes. Until that runs, the model choices are judgement, not
  measurement.
- **D104's launch drills** stand, plus: a page while the AI service is unreachable (the
  15-minute page still goes); a spent AI budget; the first paging provider failing (the
  second delivers); "press 1" recorded as acknowledgement; the text and the call getting
  through Do Not Disturb on the owner's phone; and the status page updating by itself while
  AWS is unreachable.

## 15. How it is built (our call, all of it)

- **Incidents, the queue and the work list** live in Cloud's database, extending today's
  incident table and email outbox pattern. Open incidents and their deadlines are also kept
  on the outside machine, so an outage of Cloud's database cannot lose them (C39 asks for
  this).
- **The launcher** is a small program in this repository, deployed to the outside machine.
  It runs `claude -p` with a fixed brief per job type and a read-only tool set, stores the
  output on the incident, and enforces the caps.
- **Signal 3** needs request counts and timings from Cloud's services and hosted servers,
  kept with fixed labels as C39 requires.
- **Signal 4 and staff reports** need a receiving endpoint, the grouping, and the release
  controller reading the error groups as a health signal.
- **Paging** is two provider adapters behind one interface, so either can be swapped.
- **The status page** is a generated static bundle, uploaded by the outside machine.

## 16. What approving this design allows, and what is left open

**Approval allows** building and rehearsing locally, on the LAN test Cloud, as for the
deployment design. Opening the paging, outside-machine and Anthropic accounts, and any
spending, wait for a separate go-ahead from the owner.

**For the owner**

- The AI budget: a cap per run, per day and per month, set with the spending go-ahead.
- Haiku 5.5 for triage, as an exception to "everything on Opus 5.5", after the test.
- The spending go-ahead for the paging providers, the outside machine and the Anthropic
  API account, when the accounts are opened.
- The privacy-reviewed rule that opens D101's AI gate for the investigator's bundle and
  the report fields (section 13).

**For the builder**

- The hosted "can trade" check, with Waitron.
- Signal 3's targets and multipliers, from the trial.
- "Many boxes in a cell" (section 4) and "enough opted-in boxes" (section 10).
- The investigator's caps, brief and tool set; the triage brief.
- The second paging provider; the exact message wording in English and Spanish.
- How long the outside machine keeps what it holds, within section 13.

**Depends on Waitron:** the error-report opt-in and sender, the "report a problem" form in
the till and the dashboard, the "can trade" check, and the updater reading a held version.
