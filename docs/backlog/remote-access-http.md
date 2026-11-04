# Remote access HTTP boundaries

## Remote hostname save qualification

Run `node --test apps/portal/test/remote-transport-boundary.test.ts` to check refused,
unreadable and lost save replies, failed read-back and explicit status retries.
One status read checks whether the requested hostname was saved without replaying
the write; another save requires a fresh review. Permission refusals still clear
the setup. A server wait permits the immediate read-back but blocks later requests
until its deadline. These native HTTP/client/controller checks leave live DNS,
certificate issuance, browser integration and deployment unqualified.

## Remote status and DNS-preview deployment qualification

When a remote status read or DNS preview loses its reply, you can retry explicitly.
Session or permission refusals clear your setup; every failed read clears the
temporary public-forward warning. A fresh matching preview is required before saving.
Run `node --test apps/portal/test/remote-read-transport-boundary.test.ts` for
unreadable and refused replies, duplicate requests and exact seconds/date retry
expiry across account and venue changes. These native checks leave live DNS,
certificate issuance, browser integration and deployment unqualified. Retain the
existing permission and retry rules when qualifying those paths.
