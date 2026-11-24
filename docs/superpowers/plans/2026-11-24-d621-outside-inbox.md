# Keep the D621 test inbox outside the three machines

After any cell machine stops, the outside rehearsal can still read a synthetic
sign-in message accepted before the stop and complete sign-in using that message.
The 24 November free diagnostic matched an outbox Message-ID to Mailpit on the
database primary. Both surviving inboxes answered after the stop and neither had
the message. This proves the loss mechanism in Kind. Stockholm kept no inbox
placement for its first message.

1. Start one Mailpit on the launch host for the outside baseline, after the
   private rehearsal network and run credentials are ready. Reuse the pinned
   Mailpit image, the synthetic-recipient rule and TLS and authentication settings
   from `deploy/kubernetes/services.mjs`. In `scripts/kubernetes-outside.mjs`,
   bind SMTP only to the launch host's WireGuard address and the inbox API only
   to loopback. Extend the exact-port and peer checks shared with the existing
   Git mirror in `scripts/kubernetes-git.mjs`. Keep the listener and its temporary
   state for the whole rehearsal, including the all-machine restart. Remove the
   owned listener, credentials and rules before releasing the rehearsal network.
2. In `scripts/kubernetes-services.mjs`, pass the shared SMTP endpoint and trusted
   certificate to the three existing email workers, each still on its own machine.
   Drop the Mailpit sidecar only from that outside configuration. Read the shared
   inbox through the launch host. Keep the signup proof's surviving-sender check.
   Read the source from the first Received header added by Mailpit and resolve it
   to a known cell peer. Refuse missing or unmatched evidence. The local one-node
   service check keeps its loopback inbox. Update the D621 entry in `docs/backlog.md`.
3. Write the failing check first in `scripts/kubernetes-services.test.mjs`. Record a
   sent message on the primary, stop that node and reread the same Message-ID.
   The current per-pod inbox loses it. With the shared inbox, finish the matching
   sign-in and prove a fresh signup message came from a surviving worker. Use
   `deploy/kubernetes/services.test.mjs` for service wiring, `scripts/kubernetes-git.test.mjs`
   for the private binding and cleanup, and the existing inbox checks for refusal
   of missing authentication and non-synthetic recipients. Also exercise a failed
   start so the host filter is removed only when its listener is gone. Run the
   outside check in a disposable three-node Kind guest before qualification.

Budget about 180 lines of code and 130 of tests; reuse the existing mirror command
ownership and fault harness. This slice covers test capture and sender evidence.
Worker recovery after database movement is a separate decision. The observer's
challenge matching, the 90-second target and production mail stay as specified
in the [D621 service-recovery plan](2026-11-20-d621-stockholm-service-recovery.md).
