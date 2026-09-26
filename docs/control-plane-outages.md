# Keep data services bounded during a control-plane outage

Your account API should not sit in the data path for every remote request or backup
transfer. If it stops, an already configured gateway and an already issued storage
credential continue to work until their signed expiry. They never gain extra time from
a restart or from cached state.

This distinction matters during an outage. An unavailable account API is not a
revocation. A gateway keeps its last signed manifest for at most ten minutes. Cloud asks
the provider for a fifteen-minute storage credential and rejects a returned expiry more
than fifteen minutes plus one second ahead. An installation control lease lasts for at
most one hour. Each verifier rejects authority at its exact signed expiry. There is no
offline grace period.

Run the complete local drill with:

```sh
pnpm test:control-plane-outages
```

The command creates an isolated PostgreSQL schema, launches the account API as a
separate process, drives a gateway authority through a real HTTP socket, and obtains a
TLS-protected scoped credential from SeaweedFS. It stops the account API while the
route and storage service remain up. It then proves cached restart, exact expiry,
control recovery, issuer-key rotation, installation revocation and route withdrawal.
The command writes and verifies `/tmp/cloud-control-plane-outage-receipt.json`.

This is local integration evidence. It does not prove AWS, Google Cloud, Kubernetes,
load-balancer or production database-failover behaviour.

## Rotate the installation issuer without cutting off live leases

`CLOUD_INSTALLATION_ISSUER_KEY` is the active Ed25519 private key. The account API
uses it only to sign new leases. `CLOUD_INSTALLATION_TRUSTED_KEYS` is a JSON array of
additional Ed25519 public keys in unpadded base64url form. Every lease consumer uses
the resulting trust set. The active issuer's public key is always included.

Use an overlap when you rotate the issuer:

1. Add the new public key to `CLOUD_INSTALLATION_TRUSTED_KEYS` on every API instance.
   Keep the old private key active.
2. Confirm every instance trusts both keys. Then replace
   `CLOUD_INSTALLATION_ISSUER_KEY` with the new private key and restart every instance.
   Keep the old public key in the trust list.
3. Record the time when the final old signer stopped. Wait until every lease it could
   have issued has expired. The current maximum is one hour.
4. Remove the old public key and restart each instance. A request with an old lease is
   now refused, while leases signed by the new key continue normally.

Do not rotate the private key and trust list in one step. That rejects otherwise valid
old leases as soon as the first new process starts. Also do not leave an old signer in
service after starting the one-hour retirement clock. It could issue a later lease and
make the planned removal unsafe.

Malformed trust configuration stops the account process with its fixed startup error.
The diagnostic does not print keys.

## What revocation can promise

Revocation immediately refuses new control operations and new grants after the account
API commits it. A gateway learns the change from its next signed manifest. If the
management service is unavailable, the gateway cannot learn a new revocation, so its
last manifest remains usable only until the original signed expiry. Restarting from
that cache preserves the sequence floor and the same expiry.

An issued storage credential is independent of the account process. It can finish a
transfer during an outage, but the provider refuses it after its credential expiry.
Revocation prevents a new credential from being issued; it does not rewrite a
credential that the provider has already accepted. Keep provider credential lifetimes
short enough for the revocation window you can support.
