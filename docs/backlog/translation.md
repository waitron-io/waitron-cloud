# Translate all: approved design, implementation still open

The [Cloud design](../superpowers/specs/2026-10-14-translate-all-design.md) and
[24-task plan](../superpowers/plans/2026-10-14-translate-all.md) are owner-approved, with the
temporary **US$5 per venue per calendar month (UTC)** safety cap and submit admission of
**4 in flight, at most 1 per client address**, outside other account requests' shared places.
Tasks 1–21 are built, with [bounded collect](../superpowers/plans/2026-10-16-translation-collect-pages.md),
which the owner requires before go-live; the
[contract](../waitron-integration-contract.md#translate-all-version-1) owns the wire and the
[package guide](../../packages/translation/README.md) the runtime.

Keep translation off until the remaining runtime and joint qualification are complete,
apart from the separately scoped [owner's demo-menu trial](../../packages/translation/README.md#try-the-owners-demo-menu).
Its real provider result still needs the server-only key and the joint Waitron run;
the ordinary-client refusal and public privacy and supplier work remain open.
Replace this exception through that public work, then remove the separate trial worker and command.

Remaining work:

- **Cloud qualification.**
  - Lock order across worker, release and installation revocation (a mixed-traffic probe
    samples only one ordering); a job aging after lease admission; a built release image and
    active-provider Compose shutdown.
  - Retained-history growth at launch volume: the 50,000-row probe used a sequential scan, and
    the per-pass limit does not bound rows scanned. Consent listing at deployment scale.
  - Startup cleanup failure makes the enabled portal unavailable: review that availability
    policy before enabling translation.
  - Before enabling submit, jointly qualify language recognition and canonical duplicates. The
    approved parser accepts unknown primary codes with subtags such as `xx-BR`, non-language
    codes `mul`/`zxx`, and case variants as distinct tags, which Waitron refuses or normalises.
    Direct signed input needs a policy decision; preserve the approved accepted-tag set until
    then.
  - An expired lease or a crash before a batch is saved can repeat provider work. Withdrawn
    consent does not cancel a job already in flight. Two defensive checks' independent role is
    unproved; keep them.
  - Real database recovery, provider activation and wider release qualification. Append
    migrations at the then-current next numbers without editing landed migrations.
- **Waitron and joint qualification.** The
  [interruption proof](../superpowers/specs/2026-10-19-translation-interruption-proof.md)
  ([plan](../superpowers/plans/2026-10-19-translation-interruption-proof.md),
  [command](../local-pairing.md#prove-translation-survives-interruptions)) passes all five
  synthetic faults. Keep bounded decoded reads and the wider release gate open, keep generation
  tags limited to the controlled single-runner restart, and give release-check callbacks
  cancellation before adding long-running ones. Waitron still needs the signed abandon action.
- **Owner quality trials.** Tasks 22–24 remain owner-only after **2026-11-02**, using their
  preserved commands: templated-prompt non-regression on both graded sets, house-style effects
  (offline preparation is built) and the other kinds of name. The external grading bridge is
  unqualified. Run no real-key trials in autonomous work. The consent wording awaits the owner.
- **Commercial and production gates.** Pricing, billing and the replacement monthly allowance
  are required before the first live venue. Provider processing/residency and retention
  decisions, consent wording, production key custody and deployment remain open. Suggestions
  still require a person to save them before diners see a change. Design approval enables none
  of these production capabilities.

## Unexplained test failures

- **Worker disconnect case.** CI showed doubled or partial termination
  ([main run 42395447647](https://github.com/waitron-io/waitron-cloud/actions/runs/42395447647/job/128479291385),
  [PR #1299](https://github.com/waitron-io/waitron-cloud/actions/runs/44302084131/job/134794387767),
  [PR #1300](https://github.com/waitron-io/waitron-cloud/actions/runs/44313296597/job/134832901823)).
  The worker's fatal-then-retry output and the fixture's two-connection stop are fixed; the
  historical orderings are unknown, and active-job ordering at direct pool queries is
  unqualified. On recurrence, keep the complete assertion output, selected backend IDs and
  termination results before changing the checks. Update the diagnostic if the case's three
  iterations or the worker's four connections change.
- **Portal consent retry button.** Two reproduced fixture schedules are fixed; the natural CI
  scheduling is unproved. Capture clock return, listener registration and activity acceptance on
  a recurrence.

## Translation-consent deployment qualification

Qualify server authority, deployed browser integration and translation release
checks before activation. The historical genuine-browser reconnect refusal
(run 40746396664, job 123021488076) remains under D201/D530 investigation;
a passing qualification does not establish its cause or repair it.
