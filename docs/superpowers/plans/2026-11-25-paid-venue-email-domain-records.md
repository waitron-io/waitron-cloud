# Paid venue email domain records implementation plan

In Connected and Hosted test setup, a venue owner can save a sending address, copy the one DNS alias their web administrator must add, download the same email and remote-access records as a PDF, and see whether each record checks out. This is [Cloud slice 2b](2026-11-25-paid-venue-email-cloud.md#2b-show-verified-domain-records) from the [paid venue email design](../specs/2026-11-23-venue-email-paid-design.md).

In the 25 November Stockholm sandbox, both the direct TXT and the alias to a TXT reached Amazon SES signing status `SUCCESS` in one test zone. The trial resources were removed without sending. Use fake SES and DNS for this slice. A separate venue zone, delivered signatures and live provider writes remain separate qualification work.

## Claim and retire the domain

Extend `packages/account-http/src/venue-email.ts`, `app.ts` and `remote-access.ts`. Reuse the Connected/Hosted test owner, active installation, origin and request-forgery checks. Save the sending address beside the existing reply address, defaulting replies to the sending address. Add and register a venue mail domains migration in `packages/registration/`. Bind each choice to its organisation and venue, with a fresh signing-key label and one unique Waitron DNS target. Reserve the normalised domain in PostgreSQL only after the venue's alias matches. Keep one claim per domain in the configured SES account and region until cleanup completes.

Use `packages/account-http/src/venue-email-ses.ts` for SES create, read and delete. Tag the identity with the claim ID on creation. Resume only a matching tagged attempt. Leave existing unrelated identities alone. Serialize provider changes with a PostgreSQL advisory lock per domain. Recheck authority and choice before recording results. Clear, replace or accepted owner transfer (`packages/registration/src/owner-transfer.ts`) retires the claim immediately. Hide proof on downgrade. In the existing `packages/account-http/src/server-cli.ts` cleanup loop, retire claims with no active installation and retry failed deletions. Delete only the tagged identity and exact Waitron TXT. Keep the claim reserved while a provider write or cleanup remains uncertain.

## Publish and check

Generate a 2048-bit RSA signing key per claim. Encrypt it in PostgreSQL with a separately injected wrapping key and key ID. Expose plaintext only to provisioning and SES, and erase stored ciphertext after cleanup. Publish the public key in one chunked TXT value through a mail-scoped operation in `packages/remote-access/src/route53-dns.ts`. Preserve its certificate rules. Replacing the TXT at a stable selector can break older signatures and cached lookups. Document a manual cutover using the Waitron sender until DNS and SES settle. Overlap requires a new selector and venue CNAME. [SES signing setup](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-bring-your-own.html), [Route 53 TXT format](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#TXTFormat).

Rate-limit checks on opening and refreshing setup. Use `dns-lookup.ts` for a three-second DNS bound and cap the SES read separately. Check the exact CNAME and TXT. The email tick requires a matching selector, signing enabled, `SUCCESS` and `VerifiedForSendingStatus` on the tagged identity. Expire the tick after five minutes. Show mismatches as unverified and timeouts as unknown. Drop results from superseded checks or choices.

## Show and test the records

In `apps/portal/src/{remote-screen,venue-email-screen,remote-controller,remote-types,api,locale}.ts`, show the email CNAME beside applicable remote CNAMEs, with copy buttons and current verification marks. Use that same list for a forwardable `pdf-lib` download with a short note for the DNS administrator.

Run failing tests first. Extend `packages/registration/test/venue-service-relay.test.ts` for authority, conflicting claims, retry and cleanup races, missing and stale checks. Extend `packages/remote-access/test/route53-dns.test.ts` for scoped TXT operations. Extend `apps/portal/test/venue-email-browser.test.ts` for record/PDF parity in English and Spanish, light and dark, at 390 and 1280 pixels. Keep `deploy/test-cloud/free-services-relay.test.mjs` green in Mailpit. Section 2c owns sender selection, fallback notices and delivery attribution. Keep Waitron From and free relay. Update `docs/backlog.md` and `docs/backlog/venue-email.md` with the finished slice.

**Estimate** 400–550 lines of code and 220–320 lines of tests. Claude reviews the plan and the watcher clears it before implementation.
