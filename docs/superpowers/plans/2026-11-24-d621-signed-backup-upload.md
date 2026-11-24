# D621. One signed PUT per backup reservation

Disposable Linux reproduced two reservation HTTP 503s after the database primary stopped. Later retries verified a fresh backup in 179 seconds. Let the box upload one reserved object without waiting for storage to issue a session.

## Cloud slice

- In `packages/backups/src/captures.ts`, accept signed `{"upload":"presigned-put-v1"}` on `backup-reserve`. Return the existing reservation fields and expiry, with `uploadUrl` replacing `credentials`. Keep serving the current session reply to `{}` for older boxes. Its behaviour during an outage remains the same.
- Add an optional signer to `CaptureOptions`. In `capture-config.ts` and `storage.ts`, use the account process's existing storage identity and the S3 SDK presigner. Add its dependency in `packages/backups/package.json` and regenerate `pnpm-lock.yaml`. Sign a path-style HTTPS PUT for the configured host, exact bucket and `incoming/<captureId>` key with signed `If-None-Match: *` and at most 900 seconds of validity. The URL is a secret.
- Offer this to authenticated test installations on the direct storage route, including Stockholm's port 9000 relay. Older HTTPS proxy installations keep the existing path. Unsupported opt-in returns `400 invalid_metadata`. A failed signing attempt returns `503 temporarily_unavailable`. Validate the configured endpoint before signing. Recheck reserve permission and compare location before returning the URL in every supported mode. Keep Cloud's independent digest and size checks, live permission check and 512 MiB publication ceiling. The direct route enforces that ceiling at publication.
- `packages/backups/test/venue-service-captures.test.ts` covers legacy replies, zero storage session calls for opt-in, and refusal after an authority or location change during signing. `capture-config.test.ts` covers endpoint binding. Extend `deploy/test-cloud/backup-publication.test.mjs` to exercise direct HTTPS, exact method and key, signed condition, expiry, replay and independent byte checks using disposable storage. Update `docs/authenticated-captures.md` and `docs/backlog.md`.

## Rollout and free proof

Land Cloud before the box opts in. Use the exact new Waitron revision in the free primary-stop rehearsal. In `integration-venue.mjs` and `scripts/test-cloud-integration.mjs`, prove the first fresh reservation uses a signed URL, without a storage session call or reservation 503, then publish and independently verify within five minutes. Keep the legacy credential withdrawal proof. Only record the upload method and timing, with the URL kept in memory. Paid runs stay held until this proof passes.

**Cloud estimate** · 110–170 code lines and 120–180 tests, plus generated lockfile.

## Separate Waitron lane

Update `apps/server/src/cloud-backup.ts` and `cloud-backup-upload.ts`. Opt in and fall back once to `{}` only on `400 invalid_metadata`. Verify HTTPS origin and exact object path, stream with explicit TLS and no redirects, and send the signed condition. Treat 412 as an existing upload and send it through publication. Reopen the file on retry. Cover these cases in the matching test files. Estimate 90–140 code lines and 100–150 tests.
