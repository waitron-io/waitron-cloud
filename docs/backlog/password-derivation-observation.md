# Password derivation observation on Linux (D129)

The password-reset-during-derivation case failed before reaching its final
permission and state checks in run 39953541488. Its historical cause remains
unattributed. Twelve instrumented Linux repetitions passed the original case;
twelve delayed-observer repetitions reproduced the assertion after the real
password derivation had finished and the connection reached its account lock.
The test now holds the real derivation result until the observer sees the
credential snapshot and the competing reset commits. It forwards the actual
result, checks one derivation and restores the interception during cleanup.
Both immediate and delayed observation retain the password-reset refusal,
factor, enrolment and recovery-code assertions, 200-poll bound and database
statement timeout. Product authentication and locking are unchanged. Linux
PostgreSQL qualification passes both observation cases, catches removal of the
result barrier and an account lock moved before derivation, then passes again
with both faults restored.

[Linux qualification run 41842286171](https://github.com/waitron-io/waitron-cloud/actions/runs/41842286171/job/126616708546)
passes four concurrent immediate/delayed pairs and the restored pair, and catches
both deliberate faults. The complete test file and authentication session code
match main at `a9a9476d` and the documentation candidate; the observation pair also
matches the original repair in PR318. This retained CI evidence does not reproduce
or explain the historical failure. Use the shared test box for local database
checks; it was busy with another lane during this recheck, so no fresh local
PostgreSQL result is claimed. Keep the historical cause open until a recurrence
supplies evidence that distinguishes the password calculation, its result delivery
and the database observer.
