# Check a destination against its country policy

A region label alone cannot authorise a transfer. You need the same country
revision, purpose, supplier, account, data class, endpoint and region on one
qualified evidence record. `decideCountryFlow` checks that complete match without
sending data or issuing credentials.

From the repository root, you can check the production Spain default:

```sh
node --input-type=module <<'JS'
import {decideCountryFlow,spainCountryPolicy} from './packages/registration/src/index.ts';
console.log(decideCountryFlow(spainCountryPolicy,{
  country:'ES',policyRevision:1,serviceId:'venue-backup-home',
  supplierId:'aws-infrastructure',accountId:'example-account',dataClass:'backup',
  endpoint:'https://backup.example.test/spain',region:'eu-south-2',
}));
JS
```

The result is `{ allowed: false, reason: 'unqualified_flow' }`. The default records
Spain's intended home `eu-south-2` and extra backup `eu-west-3`, but its flow list
is empty. Neither location qualifies a supplier. All records in the
[purpose and supplier register](cloud-data-processing-register.md) remain
unqualified.

## Keep qualification separate from matching

Pass a trusted `CountryPolicy` snapshot to the function. It does not authenticate
the source, read the register or decide whether legal and provider evidence is
adequate. Accept that evidence before adding any qualified flow. Never accept a
policy or `qualified` flag from the party requesting a transfer.

Each flow contains the register's stable `serviceId` and `evidenceId`, an exact
`supplierId`, `accountId` and `endpoint`, and lists of permitted `dataClasses` and
`regions`. The endpoint must be a canonical HTTPS URL without credentials, query
or fragment. Root URLs include the trailing `/`. Matching does not rewrite URLs,
follow redirects or infer locations from names. A matching endpoint and a matching
region must belong to the same evidence record.

Keep qualified records from overlapping. If more than one record matches the
complete request, the function returns the first record's evidence ID; it does
not merge evidence or resolve conflicting approvals.

The policy's `homeRegion` and `backupRegions` describe its intended locations;
they do not automatically permit any service there. Keep Spain logs and keys
home-only in their respective flow records. Give the Paris encrypted backup and
EU SES email their own qualified records. Do not treat Norway, the UK or
Switzerland as EU destinations. Another approved country's policy can name its
own home; this function does not apply Spain's locations to every country.
The function does not classify EU membership. Qualification must establish the
permitted list; the tests prove that unlisted regions are refused.

An allowed result contains only `{allowed:true,policyRevision,evidenceId}`. It
records the matched configuration, not a new credential or independent proof of
supplier qualification. Refusals contain only a reason:

| Reason | Meaning |
| --- | --- |
| `unknown_policy` | No policy, invalid country identifier, or a different country |
| `stale_policy` | A different revision, or a policy revision that is not a positive safe integer |
| `unqualified_flow` | No qualified record with usable evidence for that purpose and data class |
| `destination_denied` | An invalid request binding or no exact destination on that qualified record |

The pure function does not read durable bindings. The production AI
adapter still refuses every call even when a test country policy allows its
destination. The separate input-eligibility and supplier gates remain open.

## Check a stored venue binding inside a transaction

When an internal caller needs a stored decision, use `authorizeFlow(client, input)`
from registration after taking its existing service and installation locks. You
must supply an open transaction and the exact country, destination, venue,
policy revision, placement revision and lifecycle revision. Here `revision` is
the lifecycle revision; it is separate from installation configuration.

The check first takes a shared key lock on the venue, then shared locks on the
current policy, lifecycle and binding before comparing their stored values. The
venue lock keeps a cancellation from holding the venue while your transaction
needs it for a later foreign-key insert. Concurrent admission reads can share
these locks. Keep this transaction read-only with respect to lifecycle authority;
do not call a lifecycle writer or upgrade its lock from this admission. Later
integration must reconcile any writer's lock order explicitly.

The stored locks keep a policy update or rebind from changing the decision
inside your transaction. The check parses stored policies strictly and checks the
effective end against database time after waiting for locks. Only an active
lifecycle before its effective end can pass. Exit preparation and read-only
recovery do not grant producer permission through this function.

Run the synthetic database examples from the repository root:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/flow-authority.test.ts test/country-flow-migration.test.ts
```

The exact qualified fixture returns `{policyRevision:1,evidenceId:'test-evidence'}`.
A changed stored destination or revision throws `flow_conflict`; unqualified
evidence throws `flow_denied`. Missing or malformed stored authority throws
`flow_unavailable`, and autocommit throws `transaction_required`. Errors contain
only these fixed codes. The tests also exercise lock waits, lifecycle changes
and interrupted migration recovery.

This is an internal admission boundary. No product adapter calls it yet, no
production setter is exposed, and migrations insert no policy or venue binding.
You still need the later placement, credential and outbound integrations before
this check enforces a service boundary. Spain's production flow list stays empty.


## Keep SES account sharing separate from offline policy checks

The [SES offline qualification guide](ses-feedback-qualification.md) pairs trusted
purpose/resource bindings with a limited AWS policy-document profile. Stockholm
is the configured default; either Stockholm or Paris requires explicit regional
qualification. The profile admits only the configuration's single country and
rejects caller assertions of approved sharing. A second country needs a separately
reviewed isolation/sharing design because provider suppression is regional across
the account. A passing offline check cannot add a qualified country flow, move
Spain venue keys, or grant production mail authority.
