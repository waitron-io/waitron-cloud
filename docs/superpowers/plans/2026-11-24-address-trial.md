# Google address quality trial

The Mac runs 40 fixed public addresses through Cloud’s Google adapter and reports
which editable fields match and which addresses return no draft. It validates the
first suggestion. This follows ADDRESS-TRIAL in the [joint Waitron plan](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/plans/2026-11-24-address-lookup-finish.md).
The watcher cleared the Mac run on 24 November at 21:22 after Claude reviewed the
earlier plan for the signed route. Deployment and the signed contract remain for
the later service and screen checks.

1. In `packages/account-http/src/address-lookup-google.ts`, omit Google session
   tokens. Test both outgoing bodies in `packages/account-http/test/address-lookup-google.test.ts`.
2. Use a one-off Mac script with the existing private key file and published civic,
   tourism and business addresses. Keep the script and synthetic tests in the trial
   receipts, as the watcher directed at 22:28. The watcher extended the live cap to
   170 calls at 22:21 for the street checks. Save field outcomes and component types.
   Keep provider text in memory while checking the remaining choices.
3. Reproduce mapping faults with synthetic replies before changing the adapter.
   Publish the measurement and street checks in `docs/address-lookup-trial.md`.
   Update the backlog and
   point the October design to the current Save flow. The owner reads the billing
   categories in their Google report.

Expected patch after removing the one-off runner is about 10 production lines and
65 test lines.
