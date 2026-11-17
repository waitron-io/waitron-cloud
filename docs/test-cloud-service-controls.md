# Switch test remote access, backups, guest pages and box email

You can stop a test venue's remote access or backups, withdraw its guest menu and control box email without
changing its paid level. Run the local command inside the test account container,
where it can read the private configuration and database. Start the test Cloud with
`CLOUD_VENUE_SERVICE_LEVELS=test` and `CLOUD_TEST_SERVICE_PLANS=0`; the command
reads those existing container settings and refuses other modes. Translation stays
refused.

For example, save this synthetic command as a private file outside the checkout:

```json
{"command":"guest-menu","venueId":"5c2e280d-10ba-4d39-af5f-cbdcc6dfd033","enabled":false}
```

Replace the venue ID with your test venue. On the configured Amazon test
layout, use the same settings you used to launch it:

```sh
docker compose --env-file deploy/test-cloud/test.env \
  -f compose.yaml -f deploy/test-cloud/compose.yaml \
  -f deploy/test-cloud/compose.amazon.yaml exec -T \
  account node deploy/test-cloud/service-controls.mjs < /private/menu-switch.json
```

The command reads the running container's test settings and `TEST_CLOUD_ORIGIN`.
The ordinary home-network Compose layout leaves venue-level mode dormant and
refuses these commands. Do not override its mode on an individual command.

For native local development, keep `LOCAL_STACK_CONFIG_DIR`, `DATABASE_URL`,
`TEST_CLOUD_ORIGIN` and the two test-mode settings in a private mode-0600 environment
file. The database's complete migration ledger must match the checked-out release:

```sh
node --env-file=/private/test-cloud.env deploy/test-cloud/service-controls.mjs \
  < /private/menu-switch.json
```

The guest command returns the menu state and revision. Disabling makes published
pages unavailable and blocks further publication. Enabling after disabling returns `off`: the box
must publish again, so you cannot accidentally restore an old menu. Production
venues refuse the command.

For remote access, use a private input file containing:

```json
{"command":"remote-access","installationId":"d62adff5-c9b8-4bc8-9fa2-d3bdd7691f81","enabled":false}
```

Replace the installation ID with your paired test box. The response is
`{"enabled":false}` once the setup change is saved. The running manifest and gateway
workers then remove its staff and public routes and tunnel peer. Check that both
addresses refuse access before treating withdrawal as complete; a stopped worker
cannot apply the change. Backups, the connected level and neighbouring venues stay on.

Send the same input with `enabled:true` to restore its existing placement and peer.
This requires a previously provisioned test installation. The response is
`{"enabled":true}`; route and certificate workers apply the restored setup.
Repeated on or off leaves the configuration revision unchanged.

Off retains the peer configuration so the box's ordinary refresh sees its current
key and does not request new provisioning. It still sees unconfigured setup and
removes its tunnel configuration. Explicit trusted provisioning can restore setup;
this switch does not revoke the installation or its keys. A level reset, recovery or
re-pairing needs fresh provisioning. Run off again after that setup change if needed.
Production, revoked and replaced installations refuse these commands.

For backups, use the same command with a private input file containing:

```json
{"command":"backups","installationId":"d62adff5-c9b8-4bc8-9fa2-d3bdd7691f81","enabled":false}
```

Replace the installation ID with your paired test box. A successful command returns
`{"enabled":false}` after withdrawing the storage writer. The connected level and
remote route stay available. The existing backup setup holds `testCloudEnabled:false`;
new signed stream setup and snapshot provisioning refuse while it is off. Restarting
storage preserves that refusal. Existing backup bytes and the stored read-only
credential remain; new reader grants and signed stream-position reads refuse while off.
If storage reload fails, the command fails after saving off; retry it to finish
withdrawal rather than treating the failed command as a completed stop.

The switch belongs to this installation's setup. A reset through the registered
level clears it, and re-pairing or recovery creates a new installation without it.
Run off again for the current installation after those changes.

To enable backups after off, send the same input with `enabled:true`. The response is
`{"enabled":true}`. This clears backup setup so the box must configure again and
receive a fresh writer; the old credential stays refused. Sending on when already on leaves setup unchanged.
This command changes no
venue level and refuses production, revoked and replaced installations.

For box email, the commands are `relay-stop`, `relay-resume` and `relay-status`.
Only `command` is needed. They return `{"stopped":true}` or `{"stopped":false}`.
Stopping affects the entire test box-email relay and uses its existing sending
control. Cloud’s own signup and password-reset mail use a separate worker. Box staff
password-reset mail is part of this relay and stops with it. Resuming
creates no grant and supplies no sending adapter.

To approve a paired box, pass one private JSON object with `command` set to
`relay-approve` and these existing core inputs:

- `session`: the owner's current `token` and `csrfToken`.
- `approval`: `installationId`, `expectedRevision`, `consent:true`,
  `consentVersion`, `managementOrigin` and `expiresAt`.
- `statement`: the box's current signed configuration envelope, obtained through
  the [private box handoff](transactional-email-relay-contract.md#discover-the-grant-over-the-existing-configuration-request).

The fixed synthetic consent version is `local-v1`. Invented versions refuse.
The shared fixture policy has three units per hour, version `local-v1` and
epoch `2026-01-01T00:00:00.000Z`, refusing excess and retaining debits.
Approval only validates this policy; it reserves no allowance and sends no mail.
The later test relay startup must use these same settings when reserving sends.
You cannot choose a policy through this command.

The statement must already have completed the signed configuration exchange.
It expires after 60 seconds; obtain a fresh one rather than replaying stale
private input. The test exception accepts a private network HTTPS address or a
`.local` name under the current key-bound lease and owner consent; it performs no
network challenge. Other origins remain refused. The response contains only the
grant ID, installation ID, revision, expiry and enabled state. It contains no
session token or management origin.

To revoke, pass `{"command":"relay-revoke","session":{...},"grantId":"..."}`.
The current owner session is required. A successful result is `{"revoked":true}`.
Re-enabling requires fresh consent at the current revision. Put sessions and
statements in mode-0600 input files or pipe them privately over SSH. Never put them
in command arguments, repository files or logs. A failure prints a fixed error and
exits unsuccessfully without echoing the input.

These commands manage the existing local core. They do not start a relay worker,
send real mail or deploy the Amazon machine. SES startup, feedback and suppression
qualification remain separate work.
