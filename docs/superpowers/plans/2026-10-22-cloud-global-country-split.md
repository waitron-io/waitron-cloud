# P3: Independent countries and a small worldwide admin console

**Direction, 2026-11-16:** at 19:47 the owner said, “the worldwide operator layer just
needs to monitor and deploy the country-specific installations i think. no passing
messages from one country to another. each country is an independent unit”. At 19:55:
“the worldwide layer still needs login for the waitron admins”; at 19:56 he chose
“Small admin console (Recommended)”. Source: `~/waitron-campaign-g/questions.md`,
19:48/19:57 watcher entries, and `~/waitron-campaign-g/queue.md`, D112-S.
The console choice supersedes 19:51’s “No servers of our own”.

Each country is self-contained, including customer sign-in, billing, email, data,
keys, backups and its own second region ([production design, §4](../specs/2026-10-22-cloud-production-deployment-design.md#4-the-shape-countries-a-global-layer-cells-machines)).
You sign in separately to that country’s operator account to act inside it.
No messages pass between countries.

Worldwide has one small admin web app, server and database outside every country,
its own passkey sign-in, country health and deploy starts only. Its database holds
console admins only; worldwide keeps necessary admin security, health and deployment
state, never customer or venue copies. It cannot grant country operator authority.
It owns the `waitron.io` apex DNS and front-page redirect to `es.waitron.io`;
the console has its own sign-in origin. Each country pulls reviewed repository
releases started from the console.

After this documentation slice, two implementation PRs remain:

1. Configure Spain’s country and refuse foreign-business signup:
   `Waitron Cloud isn't available in <country> yet` (owner’s 19:52 choice, D112-S).
2. Plan first, then reuse/shrink P2’s `deploy/aws/roots/global` for the console and
   DNS/redirect; retire customer sign-in, portal and registration worker, and shrink
   its database to console admins. P7 owns the outside checker.

D608 slices 12–13 build the one-owner database rule and swap-owner function.
Everything else in [old P3](../../reference/2026-11-16-retired-p3-global-country-split.md) is retired.
These docs change or deploy no code/infrastructure and approve no AWS spend or live email.
