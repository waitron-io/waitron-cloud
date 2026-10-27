# Installation renewal accepted during owner revocation

PR #316 run `39953541488`, registration shard 5/5, accepted a renewal where
`installations.test.ts` expected a `revoked` refusal. The historical cause remains
unattributed. Forty instrumented Linux cases observed the correct installation wait
and passed. A forced earlier session wait exposed a test-observer defect in four
of four Linux cases: any lock wait could release the competing renewal. The test
now waits for the installation-lock statement blocked by its own held connection.
The regression rejects the earlier session wait, observes the real installation
wait and excludes an idle observer connection. Existing security, venue, service
and audit checks remain unchanged; production locking is unchanged. Linux
qualification passed 40 paired cases (80 checks), caught all three deliberate guard
removals, then passed the restored 14-test file. The temporary diagnostic workflow
is removed after retaining those receipts. A deterministic check for deleting only
the main test's call to its ordering helper remains open; the 40 cases verify the
observed wait with that call present. Local database checks remain unavailable
while Docker is down. No deployed vulnerability or fix for the historical refusal
is established by this evidence.
