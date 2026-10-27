# Account relay contention admits more than the fixture allowance

- [Run40484554632, account HTTP shard3](https://github.com/waitron-io/waitron-cloud/actions/runs/40484554632/job/122123115959)
  failed `account contention across installations admits only the explicit fixture allowance`
  at `packages/account-http/test/relay-messages.test.ts:143`: three responses
  were accepted instead of the expected two. The D333 tests-only head changes no
  account HTTP or registration file. The cause is unknown; reproduce the exact
  contention case through PostgreSQL, then repair the shown cause while retaining
  the allowance, its expected responses and every ownership check. Local database
  reproduction waits for Docker. Lane D records the follow-up for queue assignment;
  this browser-source change does not repair or explain the extra admission.
