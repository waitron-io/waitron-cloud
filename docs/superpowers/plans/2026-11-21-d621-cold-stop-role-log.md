# D621 role placement before the all-machine stop

The full-service rehearsal already prints the database primary, elected
database operator, active gateway and Flux apply controller before each
individual stop. Both the private Linux and Stockholm full-service paths use
`runKubernetesServices`. The separate all-machine restart in that same journey
calls `measureServiceRestart` without recording the roles. Operators should
have the placement line even when that stop or its recovery fails.

- [ ] In `scripts/kubernetes-services.test.mjs`, extend the successful
  all-machine case with a synthetic role map. Capture the placement line, and
  assert from the fake stop callback that it already contains the role map.
  Keep the outage, restore and backup assertions. Run the test and see the
  missing pre-stop line fail.
- [ ] In `scripts/kubernetes-services.mjs`, pass the existing `inventory`
  callback to `measureServiceRestart`. Read it after health and witness
  preparation and before invoking `restartAll`. Print
  `D621 all-machine stop inventory` with the returned node names. Reuse the
  existing bounded inventory read, so the stop does not begin with unknown
  placement. Keep the stop, outage and recovery deadlines as they are.
- [ ] Update the existing D621 paragraph in `docs/backlog.md` to name the
  new line and keep machine-loss qualification open. Run
  `node --test scripts/kubernetes-services.test.mjs scripts/p1-observer.test.mjs scripts/ci-docs.test.mjs`
  and check that removing the new line in a disposable copy breaks the
  focused test. Broader CI runs through the normal branch workflow.

Allow about 6–10 implementation lines and 10–20 test lines plus the backlog
sentence. This slice covers the D621 outside full-service journey. The isolated
database, gateway and store tests use their own fixtures. Diagnosis of the
earlier failures, a new rehearsal and paid qualification stay open.
