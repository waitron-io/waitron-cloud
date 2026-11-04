# Remote access HTTP boundaries

## Remote hostname save transport and read-back (D427)

If a hostname save loses its reply, the portal reads the current status once
to find out whether it succeeded. Native HTTP/client/controller checks cover
refused, unreadable and lost replies, plus failed read-back and explicit status
retries. Only a matching current hostname confirms the save; another apply
requires a fresh review. A server wait permits this immediate read-back but
blocks later requests until its deadline. Runtime and existing tests stay
unchanged. Live DNS/ACME, browser and deployment qualification remain open.

## Remote status and DNS-preview transport failures (D438)

When a remote status read or DNS preview loses its reply, your setup remains
available for an explicit retry. Session or permission refusals clear it; every
failed read clears the temporary public-forward warning. Native HTTP/client/controller
checks cover unreadable replies, refused responses carrying valid-looking data,
pending duplicate requests, and exact seconds/date retry expiry across account
and venue changes. A fresh matching preview is required before a save. Run
`node --test apps/portal/test/remote-read-transport-boundary.test.ts`.
Runtime and existing assertions are unchanged. Live DNS/ACME, browser integration
and deployment qualification remain open.

## Remote-access HTTP response boundaries (D420)

Native HTTP client and controller checks reject malformed remote status and DNS
replies before they replace your setup or create a review. DNS reviews must match
the selected installation, route kind, requested hostname and assigned target.
An invalid save reply triggers one status read without replaying the write; only
a matching current hostname confirms the result. Mismatched save replies require
you to reload. Permission refusals clear the setup, and server retry waits block
new requests until their deadline. Runtime rules and existing tests are unchanged.
Live DNS/ACME, browser integration and deployment qualification remain open.
