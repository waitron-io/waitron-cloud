# Initial focus

Status: open. Production qualification remains unfinished.

## Decisions and deliberate limits

- Launch first in Spain on AWS. AWS documents Europe (Spain) as `eu-south-2` and
  lists candidate services for the initial architecture, but no Waitron account or
  resource has been configured. Use the [launch evidence boundary](../launch-evidence.md)
  to select each service against the adopted residency policy before provisioning.
  Preserve support for other countries and Google Cloud in the design; implement and
  validate those deployments later.
- Make routine customer journeys self-service, aiming to operate without a dedicated
  support team. Cover setup, account management, billing, troubleshooting, backup
  recovery and cancellation with clear status, actionable errors and safe retries.
  Reserve staff intervention for exceptional cases; avoid required manual support steps.
- Build around one owner connecting one venue, or adding several venues in the same
  city. Keep the usual connection flow to one action that verifies both Cloud and
  local permissions.
- Remote access covers owners and staff plus customer-facing pages such as menus
  and bookings. Temporary unavailability is acceptable when the venue server or its
  internet connection is down. The public gateway now returns a concise English or
  Spanish unavailable page, with light/dark and phone layouts, a retry link, a
  30-second retry hint and no caching. Clients requesting JSON receive a generic
  error with the same 503 status. Real HTTP and Chromium tests cover failed venue
  responses, lost connections, language/content preferences and all eight visual
  states. The unavailable response also honours `application/*` preferences for
  JSON, while exact JSON exclusions and stronger HTML preferences still win.
  Native HTTP regressions cover upstream errors and lost connections, preserving
  the private 503 response, no caching and the default browser page. Production
  traffic remains unqualified.
  The D88 extension proposes concrete customer function/method families;
  exact Waitron routes/assets and session/retry semantics need joint acceptance
  before implementation. No offsite booking/order queue is included; a lost reply
  requires outcome reconciliation, not a blind retry.
- Complete self-service recovery onto a replacement server without routine staff assistance.
  The local continuous and verified-snapshot paths now share a matching-code owner
  approval flow. Continuous recovery freezes verified pointer evidence and releases a
  bounded recovery kit; snapshot recovery uses scoped download authority. A separate
  owner-confirmed Cloud replacement issues fresh installation and tunnel keys.
  When you choose a snapshot, older pages and catalogue refreshes keep that recovery
  source with a point on the displayed page. Changing it clears both confirmations;
  only a verified snapshot can be approved. Controller and stubbed-browser checks
  cover pagination, the displayed data-loss time and the approved snapshot identifier.
  A malformed recovery code now marks the code field and shows its guidance below
  the field, alongside the existing alert. English/Spanish browser checks cover both
  themes and widths, no request for malformed codes, and trimmed leading-zero codes.
  Long organisation names now stay within the recovery column on phones.
  Stubbed Chromium checks cover both languages, themes and widths, selection and
  disabling the organisation choice while installations refresh.
  Production activation remains separate work.
  Use Cloud-managed recovery keys by default for the stream and managed snapshots:
  an authorised owner must not need the original server or a separately saved backup
  key. Preserve the existing owner-held key model for customer-managed archives.
  Normally restore the latest recoverable continuous Litestream backup. Retained
  snapshots provide point-in-time archives and recovery if continuous backup data
  disappears. Start with daily snapshots retained for 30 days and monthly snapshots
  for 12 months, plus longer paid retention for selected snapshots. Validate costs and
  define prices, schedule details and continuous-backup retention. Show backup health
  and alert on interruption.
  While the backup subscription is active, protect the last verified snapshot from
  automatic expiry and mark it as out of date when backups stop. Verify a new snapshot
  before allowing it to replace the protected copy.
- Terminate public HTTPS in Cloud for bot and request inspection, then encrypt the
  onward connection. Keep staff traffic encrypted to the venue through a separate
  hostname using TLS passthrough, with network and connection controls in Cloud.
  Test that the public route cannot expose staff functions; define limits and monitor
  false positives. Staff application-level filtering remains at the venue.
- Provide assigned or customer-owned hostnames and automatic Let's Encrypt certificates.
  The durable local reconciler now issues and renews both certificate kinds through the
  existing DNS/ACME adapter contract and publishes signed cell routes. Repeat this with
  live provider DNS, production key storage and deployed workers. The signed Cloud
  CSR/chain transport and database staff reconciler are implemented locally; Waitron
  still needs A951's durable client, local stale-result checks and atomic install/reload
  path described in the proposed shared contract. The endpoint retains its private key.
  Venue devices default to `.local` with Waitron local trust, no Cloud redirect, WAN
  dependency or warning bypass. Qualify fresh offline clients. The certified staff
  hostname remains an alternative to an actual active server; a router override for
  that name is optional and needs router-specific setup/recovery tests. A Cloud-only
  primary cannot acquire an offline LAN server through DNS or a competing writer.
- Evaluate Plex-style public DNS names resolving to private LAN addresses as an option
  that can reduce customer configuration. Test certificate trust, local/remote address
  selection and router rebinding protection. Require a verified offline connection
  path after restart and DNS-cache expiry if selected; `.local` remains the device default.
- Place venues independently in cells, with a shared remote-access gateway per cell
  and separate venue tunnels and credentials. Keep customer-facing addresses stable
  when moving venues. A short remote-access interruption during cell replacement is
  accepted; define the recovery-time target and prove the replacement procedure.
- Keep stored backups and portal recovery independent of gateway machines. Test
  recovery with the gateway absent. Keep account management separate from traffic
  handling so a portal outage does not immediately interrupt established connections
  or backups; define credential expiry and revocation during that outage.
- Keep support for multiple legal businesses and countries in the underlying model.
  Detailed international administration, separate-approver workflows and ownership
  transfers can wait until needed. Each venue belongs to one organisation at a time.
