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
with both faults restored. Local database checks remain unavailable while Docker
is down.
