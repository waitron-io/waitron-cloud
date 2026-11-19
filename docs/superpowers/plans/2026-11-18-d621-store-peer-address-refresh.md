# D621 Stockholm store peer address refresh

After the first Stockholm machine returns, prove the private test store can
repair both returned drives with one explicit bucket repair before the next
outage. Keep the cell configuration change in its own commit for
[the country-cell plan](2026-10-22-cloud-country-cell.md#task-7-deploy-api-email-usage-monitor-probe-and-operations-4060-calls).

In the single Linux capture, all six drive IDs matched before and after restart.
The returning pod addresses changed. A survivor dialled both old addresses
during reconnect and got no reply. It later skipped the repair reads because
both HTTP clients remained offline, even after both serving peers reported six
online drives. The job finished with missing pieces on disk. The capture did
not establish what address the cache held at repair time. Refreshing DNS sooner
addresses the old dials. The separate HTTP retry loop can still wait up to 30
seconds, so the change needs live verification.
[MinIO setting](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/cmd/server-main.go#L121-L132)
[MinIO DNS refresh](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/cmd/common-main.go#L527-L552)
[HTTP reconnect](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/internal/rest/client.go#L475-L508)

- [ ] Extend the existing six-peer placement test in
  `scripts/kubernetes-storage.test.mjs` to expect `MINIO_DNS_CACHE_TTL=1s` in the
  rendered store container. Run that file and check the assertion fails. Set
  the environment variable in `scripts/kubernetes-storage.mjs`, which renders
  the same store for Kind and bounded Stockholm, then rerun the file.
- [ ] Apply the cell commit to the explicit-repair branch. Run the existing
  live case on that exact combined commit twice in approved Linux guests.
  Record the commit, source snapshot and repair times. Use the pinned MinIO
  image without the scratch logging. Each run must finish the first outage
  within 90 seconds, make one
  bucket repair request after rejoin, and verify both ordinary and multipart
  pieces on each returned disk and both encrypted byte streams within the
  existing 180-second repair deadline. The failing capture is the unchanged
  comparison. If either run misses repair, keep the failure and return to the
  watcher before changing anything else.
- [ ] Send the combined branch through whole-branch review and CI before
  landing the cell change and repair proof together. In that PR, link the
  peer refresh and single bucket repair to the consecutive-outage check in
  the country-cell plan. Update the AWS guide and backlog. Keep the
  consecutive-outage check and paid run gates. Use the existing store,
  disk assignments, peer names and repair call. This slice adds no polling,
  retry or upstream patch.

Expected size is one configuration line and about four test lines, plus
short guide and backlog updates. The render test owns the configuration.
The existing live case owns the first-outage and repair outcomes.
