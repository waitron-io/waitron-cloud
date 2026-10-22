# Handle a Cloud incident

When Cloud fails, you need to reach venues and investigate even if its database,
account portal and email stop together. You are the only initial person on call,
and urgent alerts must reach your phone. Keep this runbook, the contact sheet and
the public-status publishing instructions available outside Waitron's AWS account.

This is D104's operating runbook and status-host recommendation, checked against
Cloud `5d59bf3` on 22 October 2026. No phone service, outside observer or public page
is configured by this document. The [D103 monitoring design](superpowers/specs/2026-10-22-cloud-monitoring-thresholds-design.md)
still needs approval; its thresholds and acknowledgment clocks remain proposals.
Production setup and the drills below are launch gates, not completed evidence.

## Prepare your independent route

Keep a private contact sheet with your phone, the paging provider's dashboard and
recovery route, the status-page login and URLs, provider support routes, and the
approved way to contact each venue privately. Put secrets and recovery codes in
your approved password store, never in this repository or the public page. Test
access from your phone over mobile data while signed out of Cloud.

The phone route must keep working when Cloud's account, database, region and SES
email are unavailable. Select and qualify the paging provider and a separate
delivery-failure route before launch. A push notification, SMS or call is only
delivery evidence; acknowledgment must come from you and identify the incident.
Do not treat another message through the failed provider as an independent route.
No provider or paid subscription is selected here, and no second responder exists.

D103 proposes one repeat after ten minutes without acknowledgment, an unattended
marker after twenty minutes, and a pause on expanding the monitored group. Keep
its episode, deadlines and acknowledgment state outside the affected deployment.
If you cannot provide coverage, record the gap and pause expansion; do not claim
continuous human response or silently name someone else as the fallback. Accept
the coverage and failure procedure at the launch rehearsal. It is not an
availability or response-time promise to venues.

## Open and own the incident

1. Acknowledge the particular alert. Record an incident reference, UTC detection
   and awareness times, the observed problem, your name and the next review time
   in the private incident record. Preserve the original alert and later updates.
2. Check fresh evidence from outside the affected service. Distinguish a failed
   observer from a failed venue route. Missing evidence means unknown, not healthy
   or recovered. D103 defines the proposed confirmation and closure rules.
3. Use P1 for urgent phone action and P2 for an operator work item, as proposed in
   D103. Record affected functions and the scope you can actually establish. A
   shared gateway failure may group phone alerts, but keep each affected venue's
   private evidence and any independent observation or email failure.
4. Stop making the incident worse. Hold discretionary changes to the affected
   component while investigating. An alert does not authorise failover, data
   restoration, fiscal edits, secret access or a release-policy change. C41's
   separate release design will govern automated release pauses.
5. Publish a short status update once you confirm customer impact. If observation
   itself is down, say that you cannot confirm current service health. State what
   is affected, what you know, what you are doing and when you will update again.
   Do not wait to discover the root cause before communicating.

For an acknowledged open P1, D103 proposes a private review every thirty minutes.
At each review, publish material changes or a short unchanged-status update and
set the next UTC update time. Make the first public update promptly after triage;
record any delay. These are proposed working practices, not published service
guarantees. Never invent a restoration estimate to fill the next-update field.

## Investigate without widening access

Start with [operations status](operations-status.md) and the deployment's existing
authorised health and provider views. `pnpm operations:status --ready` returns
0 for ready, 2 for a completed degraded/unready inspection and 1 when inspection
fails. An exit of 0 alone does not prove that a venue can trade or restore a backup.
Keep output private; a database outage may prevent this command from producing
any status, so it cannot be the only observer.

For route failure, compare fresh public/staff probes with control-plane contact.
For backup lateness, compare the approved due slot with capture and qualification
evidence, preserving older protected copies. D79's unfinished verification work
supplies no current production qualification. For email failure, inspect queue
and provider outcomes; use the independent phone route and public page rather
than relying on SES to announce its own outage. D102's live proof remains open.

Ask for a [reviewed customer diagnostic](operations-status.md#download-a-customer-diagnostic)
before raw logs. Follow [D101's support-access rules](superpowers/specs/2026-10-22-cloud-data-protection-design.md#5-give-machines-scoped-keys-and-people-accountable-sessions):
normal access needs venue approval and expiry; the proposed emergency route needs
an unreachable venue that cannot trade, recorded contact attempts, narrow
recovery-only scope, expiry, audit and prompt reporting afterward. Being on call
does not supply that authority. These controls still need approval and runtime
qualification. Use existing authorised procedures only until they are available.

If you suspect personal-data exposure, preserve restricted evidence and begin the
[D101 incident handoff](superpowers/specs/2026-10-22-cloud-data-protection-design.md#7-hand-rights-and-incidents-to-the-right-owner)
immediately. Record awareness, affected venues and data categories, containment,
private notice attempts and follow-up. Follow its linked legal guidance rather
than waiting for a full diagnosis or a routine status update. A public page never
replaces the private notice to an affected venue. Failed private delivery needs
another approved contact attempt with its result recorded.

## Publish only service information

Show the affected service, investigating/identified/monitoring/resolved state,
UTC update time, known impact and next update. Write concise English and Spanish
versions with the same meaning. For example, the following is a rehearsal message,
not an actual outage or deployment receipt:

> **Investigating · 10:05 UTC.** Remote access is failing for some venues. We are
> investigating. Next update by 10:35 UTC. Recovery time is not yet known.
>
> **Investigando · 10:05 UTC.** El acceso remoto falla en algunos locales. Estamos
> investigando. Próxima actualización antes de las 10:35 UTC. Aún no sabemos cuándo
> se restablecerá.

Keep venue names and IDs, personal data, email addresses, private hostnames, logs,
backup paths, credentials and exploit details out of public updates. Publish
service-level scope only when supported by evidence. Say explicitly when scope is
unknown. Keep detailed timelines and contact attempts in the private record under
D101's access and retention rules; this runbook sets no new deletion period.

## Host the page on Cloudflare Pages

Recommend a small, manually updated static page on **Cloudflare Pages Free**,
using **Direct Upload**, outside Waitron's AWS account. Cloudflare documents local
uploads to its own global network and a generated `pages.dev` address in its
[Direct Upload guide](https://developers.cloudflare.com/pages/get-started/direct-upload/).
Its [limits page](https://developers.cloudflare.com/pages/platform/limits/)
documents a Free plan; verify current terms and account limits before setup.
This recommendation creates no account or spending commitment. Ask before any
paid plan, new charge or paid paging service.

Choose Direct Upload when creating the project: Cloudflare documents that this
project type cannot later switch to Git integration. The dashboard accepts a
folder or ZIP, so keep a minimal ready-to-edit static bundle on your computer and
available securely from your phone. Use your own Cloudflare login with a second
factor and recovery access independent of AWS, Cloud login and SES. Do not put the
only editable bundle or instructions inside Cloud or an AWS-only password store.

Keep the page self-contained, with no Cloud API calls, AWS origin, login, external
fonts, analytics or subscriber form. Public text is sanitised before upload;
visitor/network metadata still needs D101's supplier, location and legal review.
A public host is not a new exception allowing venue logs or personal data outside
the country-pack policy.

Keep the assigned `pages.dev` address public and directly usable. A friendly
status subdomain is optional: Cloudflare's [custom-domain instructions](https://developers.cloudflare.com/pages/configuration/custom-domains/)
require project association and the appropriate DNS record. If the friendly name
uses AWS DNS, it remains a dependency of that name. Do not redirect the fallback
to it. Give venues both addresses before launch, including in help that remains
available when Cloud is down. Record the actual URLs after owner-authorised setup;
no address is reserved or live today.

To update during an incident, edit the saved bundle, review both languages for
private data, sign into Cloudflare directly and upload to the production project.
Read the public page over mobile data and check the incident reference and UTC
time. Keep the previous bundle for correction, but never roll back to an old
healthy message while the incident remains open. If publishing fails, retain the
last confirmed public state, record the failed attempt privately and use approved
direct venue contact. Once publishing returns, show the communication gap.

This architecture removes intended Waitron-AWS serving and publishing dependencies;
that is a design inference from the cited product documentation. Actual account
recovery, DNS, caching, mobile editing and provider availability remain unproved.
It also depends on Cloudflare and your own connectivity. A managed incident service
is a later option if manual updates or paging prove inadequate; a paid option
requires your approval first.

## Restore, verify and close

Apply the smallest authorised recovery procedure. Keep the old server fenced,
preserve backup and key boundaries, and use the separate restore/activation
authority rather than interpreting a green probe as permission to promote.
Record the action, operator, approval and exact release or resource involved.

Confirm fresh representative operations for each affected service and the
incident's own recovery condition. D103 proposes two successful route/API/observer
samples at least sixty seconds apart, with no intervening failure or excessive
gap. Acknowledgment, an empty queue, stale green evidence or a successful collector
restart cannot close an unrelated backup or venue incident. Mark observation
gaps explicitly and leave unproved recovery open.

Publish monitoring while validating the repair, then resolved with the actual UTC
recovery time, affected function and any remaining limitation. Keep the dated
public incident history visible. Send private follow-up where needed and let
monitoring mail retain its existing opt-in and sent-opening rules. Schedule a
private review of cause, detection, phone delivery, acknowledgment, customer
communications, recovery evidence and follow-up owners. Record unknown causes as
unknown; later success alone is not a fix.

## Qualify before launch

On the owner-authorised production setup, record exact page URLs, account and
provider configuration without secrets, candidate release, UTC times and results.
Complete these drills with synthetic incidents, keeping rehearsal messages clearly
labelled and removing them from the live current-state view afterward:

| Drill | Required evidence |
| --- | --- |
| Cloud/AWS unavailable | Read the page and publish a new timestamped EN/ES update over mobile data while Cloud login, database, SES and AWS publishing credentials are unavailable. Read both public URLs; the fallback must still work if the friendly DNS name fails. |
| Cloud CI unavailable | Edit and upload the saved bundle without GitHub Actions or an AWS build; verify public content and caching after each update. |
| Phone delivery and acknowledgment | Stop the observer and separately fail the normal paging provider. Verify independent detection/delivery-failure handling, the authenticated episode acknowledgment, original deadlines through restart and the approved repeat/unattended behavior. Record duplicate or lost delivery honestly. |
| Sole owner unavailable | Exercise the agreed coverage-gap procedure, unattended marker and monitoring-expansion pause without inventing another responder or claiming the incident recovered. |
| Safe communication and closure | Exercise unknown scope, a missed update, failed private notice, attempted private-data inclusion and false/stale recovery. Verify bilingual public correction, authorised private contact and actual recovery evidence. |

Keep deployment blocked until paging supplier/metadata review, independent delivery
and recovery access, D103 approval, D101 access/privacy gates and these drills are
complete. D102 is also required for production venue email. Hands-on account and
page setup waits for the owner's return on 3 November; no deployment or provider
operation is authorised by this publication.
