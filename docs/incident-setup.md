# Set up your incident page and phone alerts

You need to publish updates and receive urgent calls even when Waitron's AWS
account is unavailable. Start with Cloudflare Pages Free for the public page,
then choose two independent text-and-call providers. You do the sign-ups; this
checklist creates no account, subscription or live service.

The [approved monitoring design](superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md)
sets the intended automation. Account setup alone does not connect it. Use the
[incident runbook](incident-response.md) for handling an actual incident.

## Prepare the status page

1. Create or use your own [Cloudflare account](https://dash.cloudflare.com/sign-up).
   Use an email and recovery route you can reach without Cloud or SES. Enable
   [two-factor authentication](https://developers.cloudflare.com/fundamentals/user-profiles/2fa/)
   and save recovery codes in your approved password store outside AWS.
2. Stay on **Pages Free**. Static asset requests are [free and unlimited](https://developers.cloudflare.com/pages/functions/pricing/#static-asset-requests).
   You need no domain purchase, Functions or paid Workers plan for this page.
3. Generate and review the local bundle with the command below, or ask the builder
   to hand you the folder. Its root contains `index.html`, with Spanish at
   `es/index.html`. This local generator always keeps the setup warning when
   there is no incident. Verified-health wording belongs to the future publisher.
   The page must
   work without Cloud APIs, AWS assets, login, analytics or external fonts. Review
   it for venue names, personal data and secrets before publication.
4. In **Workers & Pages**, follow **Create application → Get started → Drag and
   drop your files**. Choose a project name, upload the folder or ZIP and select
   **Deploy site**. Save the actual `https://<project>.pages.dev` address. These
   steps follow Cloudflare's [Direct Upload guide](https://developers.cloudflare.com/pages/get-started/direct-upload/).
5. Open that address on your phone over mobile data, signed out of Cloud. Keep it
   public and directly usable. An optional friendly status domain must not replace
   it or redirect it through AWS. Share both addresses with venues before launch.
6. Keep an editable copy outside Cloud. For a manual correction, select **Create a
   new deployment**, choose production and upload the reviewed replacement. Check
   both languages and the UTC update time from your phone.

Direct Upload supports both dashboard uploads and Wrangler, Cloudflare's command
line upload tool, in the same project. It cannot switch to Git integration later.
The builder can therefore add the approved automatic publisher while preserving
your manual fallback. That publisher and its restricted credentials still need
implementation and verification.

## Generate a bundle locally

Before you have a monitor, show the setup warning rather than an all-clear.
Save this as `status-input.json`:

```json
{"state":"no_incident","updatedAt":"2026-11-07T10:05:00Z"}
```

From your checkout, run:

```sh
node packages/operations/src/status-page-cli.ts status-input.json /tmp/waitron-status-preview
```

Use a new output directory each time; the command refuses an existing one. Open
`/tmp/waitron-status-preview/index.html` in your browser and follow **Español** to
check the other language. Both pages work from the folder without a server or
internet access. This generates files only; it does not publish them.

For an incident post, provide `state`, `service`, `impact` and `updatedAt`,
with optional `history` as described below.
Choose `investigating`, `fix_being_applied`, `monitoring` or `resolved` for the state;
`cloud`, `remote_access`, `backups`, `email` or `hosted_servers` for the service;
and `some`, `all` or `unknown` for impact. `cloud` means Cloud overall. Supply only
facts you have confirmed. `resolved` describes that incident, not universal health.
For no incident, provide the two current-post fields in the example; history is optional. It keeps the
setup/unverified warning and makes no next-update promise.

Use a real UTC timestamp in exactly `YYYY-MM-DDTHH:mm:ssZ` form. Open incident
posts show the next update thirty minutes later, including the date when midnight
passes. For `resolved`, supply the actual confirmed resolution time as `updatedAt`.
The post uses past impact and promises no next update. A future publisher must
keep open posts' update promises; the generator schedules nothing. Extra fields and arbitrary text are rejected, so venue names, private
notes and guessed recovery times cannot enter this fixed-text page.

To keep past incidents visible, add a `history` array to either input shape:

```json
{
  "state": "no_incident",
  "updatedAt": "2026-11-09T10:00:00Z",
  "history": [
    {
      "service": "backups",
      "impact": "some",
      "startedAt": "2026-11-07T23:50:00Z",
      "resolvedAt": "2026-11-08T00:20:00Z"
    }
  ]
}
```

Each entry has exactly those four fields, using the same fixed service and impact
choices. `startedAt` is the earliest confirmed start of impact, never its detection
time or an estimate; `resolvedAt` is actual confirmed recovery. Both use the exact
UTC format above, and start cannot follow recovery. The current post's `updatedAt`
describes that post, so it does not limit history dates. Past incidents show the
resolution date newest first; equal dates keep input order. Every supplied entry
remains visible. Keep the complete list locally and include it each time you
regenerate the bundle: the generator stores no history between runs. Omitting
the array removes history from the new output. Trim the input yourself when you
want a shorter history.

Missing history or `[]` keeps the original page unchanged, including its styles.
History uses fixed public text and makes no next-update promise. Invalid history
has the same redacted error as invalid current-post input. Correct your local
input and generate a new bundle; a previously generated bundle stays untouched.

If generation fails, you receive a fixed error without input details. The command
attempts to remove its own incomplete output. If a filesystem problem prevents
cleanup, inspect that new folder before trying another destination.

## Choose your phone routes

Use **Twilio first, with Vonage as the independent backup**, subject to your
supplier review and spending approval. Both offer text and voice APIs, the
interfaces the builder connects to Cloud. Their voice interfaces support keypad
input: [Twilio Gather](https://www.twilio.com/docs/voice/twiml/gather) and
[Vonage input](https://developer.vonage.com/en/voice/voice-api/ncco-reference#input).
An account is not a ready-made Waitron alert service.

Prices below were read from the providers' pricing pages on **4 November 2026**.
They are different published examples, **not a like-for-like destination quote**.
Your phone's destination country, caller country, number rental, message segments,
carrier fees and taxes determine the actual cost. Confirm those before payment.

| Provider | Published text price | Published call price | What to check before buying |
| --- | --- | --- | --- |
| Twilio | Italy: **US$0.0927 per outbound SMS segment**. [SMS prices](https://www.twilio.com/en-us/sms/pricing/it) | Italy mobile from the EEA: **US$0.0445/minute**; the separate general Italy-mobile row is **US$0.3473/minute**. [Voice prices](https://www.twilio.com/en-us/voice/pricing/it) | Confirm the actual destination and caller route. The SMS page lists Italian mobile-number rental at **US$45/month**; do not assume that number also provides the required voice caller identity. |
| Vonage | Advertised US virtual-number starting rate: **€0.00735 / US$0.00860 per message**. [API prices](https://www.vonage.com/communications-apis/pricing/) | Advertised telephone-network starting rate: **€0.01314 / US$0.01538 per minute**. Same [pricing page](https://www.vonage.com/communications-apis/pricing/). | These starting rates do not quote an Italian or Spanish mobile. Select your actual country on the [SMS](https://www.vonage.com/communications-apis/sms/pricing/) and [voice](https://www.vonage.com/communications-apis/voice/pricing/) pages and confirm rental and account rates before funding. |

1. Record your phone's country and the permitted monthly spend privately. Choose
   the two providers and complete the supplier/metadata review before live use.
2. When you approve opening and funding them, create separate accounts with
   independent recovery access. Confirm sender registration, voice caller identity
   and delivery to your actual phone. Keep keys in the approved secret store.
3. Give the builder the account references through that store. The integration
   must send a text then call, switch provider when delivery fails, and record
   **press 1** against the incident. Acknowledging a call stops repeats; approving
   a repair still requires your passkey.
4. Save the paging numbers as contacts. Allow them through your phone's Do Not
   Disturb settings and verify this with real test calls and texts before relying
   on it. A delivered message or answered call without press 1 is not acknowledgement.

## Check the complete route before launch

With the builder, rehearse an AWS outage, the first phone provider failing, the
investigator unavailable and your phone in Do Not Disturb. Verify automatic
bilingual status updates plus manual publishing over mobile data. Paging must
start when investigation finishes or 15 minutes after confirmation, whichever
comes first; the repeat is 10 minutes after the first page attempt and the
unattended marker is at 20 minutes. Keep times and results in the private launch
record. Account recovery, verified-health wording, the publisher, live paging
and these drills remain open until actually completed. The local history bundle
does not qualify public delivery or those launch checks.

## Exercise the phone adapters locally

The local operations package has Twilio and Vonage adapters behind one interface.
You can check their requests without an account, number or real delivery:

```sh
node --test packages/operations/test/paging.test.ts packages/operations/test/paging-twilio.test.ts packages/operations/test/paging-vonage.test.ts
```

These tests remap the fixed provider hosts to temporary loopback HTTP servers.
They check English and Spanish messages, text followed by a call even when the
text refuses, multipart delivery and press-1 interpretation. They do not check
audible voice quality, a live provider or whether your phone wakes you.

For the later integration, use `createTwilio` or `createVonage`, then `sendPage`.
Supply a transport that honors the provided abort signal, including while reading
response bodies. The adapters never choose global fetch or read credentials from
the environment. Configuration supplies the recipient, sender,
HTTPS portal origin and a request timeout of at most ten seconds. Vonage voice
also needs an injected function that returns a fresh JWT for each call.

Supply only the incident and notification IDs, fixed service, affected venue
count, UTC start time, language and whether a fix is proposed. Messages contain
the incident link and fixed wording. They accept no venue names, raw errors or
arbitrary action descriptions. The action-name detail still needs P4's vocabulary.

`readTrustedEvent` normalizes already trusted provider fields; it authenticates
no incoming request. A future receiver must verify the provider signature and
bind the incident, notification, provider and callback kind from the path first.
It can then pass those facts to `pageDecision`. Only digit `1` from a matching
placed call acknowledges; delivery or an answered call does not. Either placed
provider call can acknowledge after fallback. `deliveryConfirmed` requires every
SMS part's matching delivery event.

An answered or completed call confirms delivery without identifying who answered;
it does not prove that a person heard the message. Acknowledgement requires a
known accepted call ID. If the creation reply is lost, the outcome stays unknown
and its input cannot acknowledge; you can receive a backup call even after
pressing 1. A future clock using this result would still see the incident as
unacknowledged.
Give each repeat a fresh notification ID and supply at most one attempt per
provider for that notification. The future clock owns that admission rule.

The decision function requests Vonage once after Twilio refusal or failed or
unconfirmed delivery; your caller makes that attempt explicitly. It never waits
for callbacks, retries or runs the 15/10/20-minute incident clock. That clock,
its durable records, the receiver and an actual go-ahead page remain separate
work. Nothing here starts unattended paging or changes the launch checks above.
