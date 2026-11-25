# D621 Kind store return path

Let the private Kind rehearsal repair each returning store through that machine’s Docker bridge port so it can reach the remaining stops and restart. Keep the original check of both peers through WireGuard as a condition for passing the live test. This proposal needs Lane G watcher clearance.

In the 25 November free run, two Ready pods and the bridge port returned six-drive counts during the second return. The WireGuard port timed out before TCP in all 22 samples. The test reached the 180-second deadline without a drive count. The first repair found zero incomplete objects. The third stop and full restart remain open. The exact pinned pair, timed comparisons and logs are in Lane G’s private receipt, receipts/d621-all-store.a2QsAoMk/result.md.

## Change

- In scripts/kubernetes-services.mjs, select the repair target by name from the original nodes. These addresses are on the Docker bridge for Kind and already use WireGuard for Amazon. In Kind, include the three owned bridge addresses alongside the existing three mesh addresses when scripts/kubernetes-storage-proof.mjs calls installStockholmStore. In scripts/kubernetes-storage.mjs, validate the optional three bridge addresses and include them in the test certificate. Metrics and signed repair reuse their existing TLS, IP and credential handling.
- In scripts/kubernetes-storage-proof.mjs, bound each storeMetrics request to five seconds from its start, including DNS, TCP, TLS and the body. Use a local AbortSignal deadline linked to the caller’s signal. Report an internal timeout as ETIMEDOUT so waitForStoreDrives can retry within the existing 180 seconds. Preserve the caller’s cancellation.
- For Kind, start the existing two-peer drive check over WireGuard alongside the bridge repair under the same 180-second return deadline. Record its result on the leg with the failure reason. Keep the 180-second limit, exact peer names, both full reads before repair and zero incomplete objects within three attempts on the bridge. The named Linux test requires all three original WireGuard results after it has attempted the stops and restart. Keep the existing external venue, signup, backup and restart checks. Amazon keeps its existing single-path checks.

## Verification

- In scripts/kubernetes-services.test.mjs, cover bridge use on return and a refused WireGuard result that still reaches the next stop and makes the final proof fail. Require the recorded reason. Cover the unchanged Amazon target without adding a second read.
- In scripts/kubernetes-storage.test.mjs, verify that a request that never connects reaches the five-second request limit and that caller cancellation still wins. Check that the Kind certificate accepts the three bridge and three WireGuard addresses and the ordinary store keeps its three existing addresses. Run these two explicit files before and after implementation. Estimate 35–55 implementation lines and 65–95 test lines.
- Update docs/backlog.md and docs/aws-infrastructure.md with the two read paths and the tested result. After plan clearance, run the named Linux outside rehearsal using the exact Cloud revision containing the repair and the pinned Waitron build. Keep the full three-stop, repair and restart criteria and record WireGuard return evidence separately. Paid Stockholm stays open.
