# Switch test guest pages and box email

You can withdraw a test venue's guest menu and control its box email without
changing its paid level. Run the local command inside the test account container,
where it can read the private configuration and database. Start the test Cloud with
`CLOUD_VENUE_SERVICE_LEVELS=test` and `CLOUD_TEST_SERVICE_PLANS=0`; the command
reads those existing container settings and refuses other modes. Translation stays
refused. Remote-access and backup switches are still unavailable.

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

For box email, the commands are `relay-stop`, `relay-resume` and `relay-status`,
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
The shared test settings allow three units per hour, with version `local-v1`
and epoch `2026-01-01T00:00:00.000Z`, refusing excess and retaining debits.
These are local fixture settings; the command accepts no policy choice.

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
