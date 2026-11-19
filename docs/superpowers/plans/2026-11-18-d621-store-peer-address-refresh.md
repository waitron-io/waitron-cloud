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
not establish what address the cache held at repair time. The one-second setting asks MinIO to refresh cached peer addresses more often.
The separate HTTP retry loop can still wait up to 30 seconds.
[MinIO setting](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/cmd/server-main.go#L121-L132)
[MinIO DNS refresh](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/cmd/common-main.go#L527-L552)
[HTTP reconnect](https://github.com/minio/minio/blob/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a/internal/rest/client.go#L475-L508)

- [x] Extend the existing six-peer placement test in
  `scripts/kubernetes-storage.test.mjs` to expect `MINIO_DNS_CACHE_TTL=1s` in the
  rendered store container. Run that file and check the assertion fails. Set
  the environment variable in `scripts/kubernetes-storage.mjs`, which renders
  the same store for Kind and bounded Stockholm, then rerun the file.
- Keep the cell setting and the explicit repair together. The original Linux run
  stopped on an HTTP 503 read during the outage before requesting repair. After
  DNS placement landed, the watcher's 04:32 note on 19 November cleared one
  recheck. It passed the 90-second outage leg in 45.890 seconds and the 180-second
  repair leg in 18.746 seconds. Both logged data reconnects preceded the repair
  request. This run combined both DNS changes with one explicit repair.
  See [the storage rehearsal notes](2026-11-18-d621-stockholm-storage.md#limits-found-in-the-linux-rehearsal).
- [x] Send the combined branch through whole-branch review and CI before
  landing the cell change and repair proof together. In that PR, link the
  peer refresh and single bucket repair to the consecutive-outage check in
  the country-cell plan. Update the AWS guide and backlog. Keep the
  consecutive-outage check and paid run gates. Use the existing store,
  disk assignments and peer names. The rehearsal polls only the explicit
  repair job returned by the pinned test store.

The peer refresh is one environment setting and one render assertion. The
Linux rehearsal checks the first-outage and repair outcomes for both changes.

The returned-drive repair and peer refresh landed together in [#1317](https://github.com/waitron-io/waitron-cloud/pull/1317).
