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

The policy's `homeRegion` and `backupRegions` describe its intended locations;
they do not automatically permit any service there. Keep Spain logs and keys
home-only in their respective flow records. Give the Paris encrypted backup and
EU SES email their own qualified records. Do not treat Norway, the UK or
Switzerland as EU destinations. Another approved country's policy can name its
own home; this function does not apply Spain's locations to every country.

An allowed result contains only `{allowed:true,policyRevision,evidenceId}`. It
records the matched configuration, not a new credential or independent proof of
supplier qualification. Refusals contain only a reason:

| Reason | Meaning |
| --- | --- |
| `unknown_policy` | No policy, invalid country identifier, or a different country |
| `stale_policy` | A different revision, or a policy revision that is not a positive safe integer |
| `unqualified_flow` | No qualified record with usable evidence for that purpose and data class |
| `destination_denied` | An invalid request binding or no exact destination on that qualified record |

This SQL-free slice does not bind placements, jobs or credentials to durable
policy revisions. Those checks belong to later D101 slices. The production AI
adapter still refuses every call even when a test country policy allows its
destination. The separate input-eligibility and supplier gates remain open.
