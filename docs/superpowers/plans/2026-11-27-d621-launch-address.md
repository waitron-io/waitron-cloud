# Check the Stockholm launch host’s IPv4 address

Before using paid slot 6, the measured launcher checks the launch host’s public IPv4 against the single `/32` allowed by the private `D618_CONFIG`. It refuses to create a stack when the address differs or cannot be read. The dry run makes the same check. The watcher requested this on 27 November at 04:16 after slot 5 stopped in setup. The owner’s 26 November 08:11 instruction requires a free fix before each paid run. Five slots are used. This change covers the launcher and free checks. The paid rehearsal, full restart and encrypted restore are separate.

1. **Watch the tests fail.** Extend the injected command scenarios in [amazon-run.test.mjs](../../../scripts/amazon-run.test.mjs). In `baseline measured stops`, require one IPv4 lookup after local networking is ready and directly before `create-stack`. In `measured stops dry run`, require the lookup and keep the zero AWS API assertion. Add synthetic measured cases for a different IPv4, malformed output and command failure, plus a dry-run mismatch. Each refusal must reach neither `create-stack` nor `delete-stack`. Ordinary `baseline` keeps its existing path. Run the command below before and after the fix.

2. **Add one check before the experiment.** In `startAmazon` in [amazon-run.mjs](../../../scripts/amazon-run.mjs), after local network setup and before the dry-run return or `runAmazonExperiment`, use the existing `run` command when `config.measuredStops` is set. Run `curl -q -4 --noproxy '*' --fail --silent --connect-timeout 3 --max-time 5 https://checkip.amazonaws.com` with a six-second process limit. Reuse `isIPv4` and require that the returned address plus `/32` equals `operatorCidr`. Report the refusal without printing either address. Keep the check outside the experiment so an earlier refusal uses only local cleanup. Keep existing AWS API calls and ingress rules.

3. **Verify and document.** Run `node --test scripts/amazon-run.test.mjs` after the focused check passes. On a disposable launch-host configuration, save the matching dry run and show that a synthetic mismatched `/32` is refused before provider use. The HTTPS lookup reads public egress and does not use AWS account APIs. Repeat the matching dry run on the exact installed checkout and configuration before any paid launch. Update [the rehearsal guide](../../aws-infrastructure.md#rehearse-the-full-service-journey-from-outside-the-cell) and [the backlog](../../backlog.md) with the check and the remaining Stockholm work.

Estimate 6–10 changed launcher lines, 30–45 test lines and 4–8 guide and backlog lines.

```sh
node --test --test-name-pattern='^Amazon distribution and journeys: (measured stops|baseline measured stops|baseline$)' scripts/amazon-run.test.mjs
```
