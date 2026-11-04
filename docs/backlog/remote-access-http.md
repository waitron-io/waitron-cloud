# Remote access HTTP boundaries

## Remote hostname save qualification

Run `node --test apps/portal/test/remote-transport-boundary.test.ts` to check refused,
unreadable and lost save replies, failed read-back and explicit status retries.
One status read checks whether the requested hostname was saved without replaying
the write; another save requires a fresh review. Permission refusals still clear
the setup. A server wait permits the immediate read-back but blocks later requests
until its deadline. These native HTTP/client/controller checks leave live DNS,
certificate issuance, browser integration and deployment unqualified.

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
