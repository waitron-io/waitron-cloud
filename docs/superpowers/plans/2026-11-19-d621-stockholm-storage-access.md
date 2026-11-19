# D621 run 9, PR 4 — stable keys and scoped storage access

On a private Linux Kind cluster, a box can get temporary credentials scoped to its permitted storage
objects and methods. A surviving machine can issue them, and pod replacement preserves the keys.
This covers storage custody in [Task 3](2026-10-22-cloud-country-cell.md#task-3-keep-secrets-stable-and-consumers-schema-gated-3555-calls)
and the exchange in [Task 6a](2026-10-22-cloud-country-cell.md#task-6a-qualify-real-scoped-temporary-storage-credentials-3555-calls).
PR 5 deploys Cloud services and runs the venue journey.

1. **Set up trust and custody.** Create the signing key, backup master key and issuer TLS identity
   once in private run custody using `deploy/kubernetes/secrets.mjs`. Refuse a missing key on
   restart. Have `deploy/kubernetes/storage-identity.mjs` consume it, render the existing
   `captureRuntime` settings, and serve only discovery and public keys from two spread pods with a
   digest-pinned Node 26 image. Start these pods before the store. Add the issuer CA's public
   certificate to MinIO's trust alongside its existing store certificate. Use the store's OpenID
   environment on first startup so a peer can load discovery after one machine stops.
2. **Qualify the pinned store.** Use unchanged `StorageAuthority.grant`. Install one policy before
   the first exchange through its supported admin client. Map the three Cloud grant kinds to the
   role reported by the store. Bind each method and the rehearsal bucket to the signed subject.
   Capture permits PUT on its exact key, restore permits GET on its exact key, and stream permits
   GET, PUT and DELETE under its prefix plus prefix-filtered LIST. Match objects using the signed
   scope. Prove each substitution with an allowed operation and a crossed-scope refusal before
   extending deployment wiring. Keep administrative credentials in private input or mounted files.
   MinIO does not check the token's issuer. Signature and audience are checked and only Cloud
   holds the key. Verify that a token from an untrusted signing key fails at exchange.
   [Pinned token validation](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/internal/config/identity/openid/jwt.go#L136-L221)

Run new tests against the missing behavior first. `deploy/kubernetes/storage-identity.test.mjs`
covers missing-key refusal and secret projection. `scripts/kubernetes-storage-identity.test.mjs`
drives `scripts/kubernetes-check.mjs --storage-identity` through the existing Kind runner and store
installer. Its real exchange checks all three temporary fields, a maximum 901-second expiry,
encrypted bytes, wrong audience/signature/expired-token refusals and scoped operations. Prove
each policy guard with a disposable control. Replace an identity pod and compare its public key;
reopen a synthetic backup-key envelope with custody reloaded. Time the 90-second outage leg
around the actual 900-second expiry so a surviving store peer refuses an expired grant and accepts
the renewal while the node is down. Run with `TEST_KUBERNETES_STORAGE_IDENTITY=1` on the approved
Linux guest. Run the renderer and `scripts/kubernetes-storage.test.mjs` files locally. Update
D621's existing `docs/backlog.md` entry. Estimate 340–450 implementation and 180–250 test lines.

The loopback HTTPS receipts show two GETs from `BackupObjects` after one busy response and one
POST from `StorageAuthority.grant` after a busy exchange response. Only the object read refusal
was observed in the Linux outage. Preserve both observations and check issuance during the new
outage leg. The watcher decides whether this slice changes retry behavior. Store repair remains open.
