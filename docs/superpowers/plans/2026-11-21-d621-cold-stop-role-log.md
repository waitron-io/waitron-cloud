# D621 role placement before the all-machine stop

The D621 outside full-service journey already logs role placement before each
individual stop in private Linux and Stockholm. Operators need the same
diagnostic before the all-machine stop, including when recovery fails. Reuse
the existing lookup of the database primary, elected database operator,
active gateway and Flux apply controller.

- [ ] Extend the existing cold-restart cases in
  `scripts/kubernetes-services.test.mjs`. The fake restart checks that the
  placement line already holds the supplied node names, and the completed
  receipt carries those names. A failed lookup logs that placement is
  unavailable and the existing restart still runs. A cancelled lookup
  propagates the parent cancellation before any stop. Give the separate
  silent-account transport test a successful lookup and keep its assertions.
  Run the focused tests and see the missing placement check fail.
- [ ] In `scripts/kubernetes-services.mjs`, pass the existing `inventory`
  callback to `measureServiceRestart` as a required argument. After health
  and witness preparation, use its existing 30-second bound to read the
  placement and print `D621 all-machine stop inventory` before calling
  `restartAll`. On lookup error, propagate parent cancellation and otherwise
  print an unavailable record with the lookup stage. Continue the stop.
  Include the map in the successful result when available. Keep the
  existing stop admission cutoff and recovery deadlines.
- [ ] Update the D621 paragraph in `docs/backlog.md` and the full-service
  rehearsal steps in `docs/aws-infrastructure.md`. Run
  `node --test scripts/kubernetes-services.test.mjs scripts/p1-observer.test.mjs scripts/ci-docs.test.mjs`.
  Remove the new log line in a disposable copy and verify the test fails.

Allow about 10–15 implementation lines, 25–35 test lines and a few doc lines.
The separate gateway-only, database, storage and standalone cold checks
remain outside this slice. Some of those fixtures lack a gateway or Flux
apply controller. The five unresolved qualification checks are in the
campaign receipt. This slice adds evidence to the full-service stop path.
