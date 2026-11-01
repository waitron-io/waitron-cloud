import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prepareCalculatorData, renderCalculator } from './render.mjs';
import { calculateCosts, defaultControls } from './calculator.mjs';
import { assessStorageRehearsal } from './rehearsal.mjs';

const fail = () => { throw Error('Invalid cloud cost publication'); };
const root = new URL('../../', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL('docs/cost-model/' + name + '.json', root), 'utf8'));
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderModel({ data, inventory, assessment }) {
  const result = calculateCosts({ data, controls: defaultControls(data) });
  const prices = data.prices.map(rate => `| ${rate.id} | ${rate.region} | ${rate.value} | ${rate.unit} | ${rate.tier.begin}–${rate.tier.end ?? 'unbounded'} | ${rate.sku} / ${rate.rateCode} | [${rate.retrievedAt.slice(0, 10)}](${rate.source}) | ${rate.effectiveAt} |`).join('\n');
  const capabilities = inventory.rows.map(row => {
    const shown = row.id === 'fiscal-api' ? {...row, inclusion: 'historical', gap: 'The obsolete registry and live producer are removed. Saved measurements remain historical; no current registry service or external fee is selected.'} : row;
    return `| ${shown.id} | ${shown.inclusion} | ${shown.scope} | ${cell(shown.driver)} | ${cell(shown.gap ?? shown.reason)} |`;
  }).join('\n');
  return `# Estimate what serving a venue could cost

You need both a running platform and enough capacity for each venue. The
[offline calculator](cloud-cost-calculator.html) separates their priced subtotals
at zero, 1, 10, 100 and 1,000 venues. The full monthly bill remains unknown.
Each subtotal excludes named gaps, so you must not use it as a complete budget
or a customer subscription price.

Open the HTML file directly in your browser. It contains its data and calculation
code and works without a connection. Change region, orders, monthly archive
retention and owner sessions. Open **More assumptions** to enter capacity, disks,
keys and traffic choices. Empty inputs stay unknown. An explicit zero is different
from an empty field; zero sales still leaves startup and idle traffic.

## Rebuild and check the public files

From the repository, run:

\`\`\`sh
node scripts/cloud-cost/cli.mjs build
node scripts/cloud-cost/cli.mjs verify
\`\`\`

Both commands use only the public files in [cost-model/](cost-model/). They never
start a private replay or call a provider. Verification rebuilds the expected HTML,
this document and the trial assessment, then compares their complete contents.
It refuses changed, missing or stale artifacts. A successful check means the files
agree, while reporting that the cost estimate is incomplete.

## Run the generated-data rehearsals

Run \`pnpm test:cloud-cost\` for the local model checks and publication verification.
Run \`pnpm test:cloud-cost:conformance\` for the deeper integration tests. The
second command requires Docker, Git and pnpm. It downloads the pinned public
Waitron source, installs its locked dependencies, compiles the rehearsal runtime
and prepares local service images. Tests generate their own venue state; no venue
source path or provider credentials are accepted by this setup.

Use \`node scripts/cloud-cost/conformance.mjs --list\` to see every integration
file. Pass \`--only <listed file>\` to the pnpm conformance command for one file.
The Cloud cost conformance workflow discovers this same list and runs each file
in bounded jobs, splitting the longer stack file into three groups. New stack
case names stay in the third group unless a prior group selects them. Generated
runtime files and owned test containers are
collected at the end; reusable Docker build layers may remain in the local cache.

## Read the measurements narrowly

The [joined evidence](cost-model/local-driver-evidence.json) preserves separate
experiments and their producing revisions. The [stream sample](cost-model/measurements.json)
replays all ${data.basis.sales} selected sales into a fresh venue. Its copied source
database is ${data.basis.databaseBytes.toLocaleString('en-US')} bytes; fresh-venue database
growth is ${data.basis.growthBytes.toLocaleString('en-US')} bytes. It records startup,
accelerated sales, ${data.basis.idleSeconds} seconds of idle observation, restore,
setup, observer and cleanup requests. Every one of its ${data.basis.requests.reduce((sum, row) => sum + row.attempts, 0)} physical requests stays
in the trial assessment, including ${data.basis.requests.reduce((sum, row) => sum + row.failed, 0)} failed attempts. The calculator projects
startup, workload and idle separately; it does not add the experiment's setup or
cleanup to ordinary daily activity.

The [selected-sale archive](cost-model/archive-replay.json) contains
${data.basis.archiveBytes.toLocaleString('en-US')} bytes and restores all selected sales.
The [one-sale storage sample](cost-model/archive-storage.json) separately counts
archive uploads, reads, listing, HEAD, an abandoned multipart part and cleanup.
It does not measure storage transfers for the selected-sale archive.
The [generated owner browser journey](cost-model/remote-owner-browser.json)
observes ${data.basis.ownerBytesOut.toLocaleString('en-US')} encrypted response bytes,
including transport records. This does not establish public activity, monthly
owner frequency or provider-billed transfer. Service and API samples remain
available in the joined evidence; their absent monthly frequencies stay unknown.

These are measurements on this Mac. They establish neither typical venue state
nor AWS capacity. Raw sales, archive contents, credentials and private journals
are absent. For exact clocks and producer revisions, use the linked receipts.

## Separate assumptions from prices

Spain is the default modelling region; Stockholm is the comparison. The single-zone
example uses one control instance and one gateway per cell. The redundant example
uses two of each and the listed Multi-AZ database price, which already includes
its standby. These are illustrative configurations, not availability promises.
EC2 t3.small and RDS db.t4g.micro are priced candidates, not measured sizing advice.
Database deployment count and gateway cells change at the assumed venue capacity.
A gateway cell means one independently sized group of gateways. CPU, memory,
traffic and concurrency may impose a lower capacity than your assumed venue count.

Running resources use an assumed 730 hours/month. Request projections repeat the
sample for an assumed 31 days. Orders default to the reconciled ${data.basis.sales},
not the earlier source-selection count of 203. Monthly owner sessions start empty.
Monthly archive retention starts at 12 months; the calculator supports 1–36 months.
All editable quantities are assumptions. The source files label measured inputs
with their units, scope, observation time and revision. A calculation carries
assumed status when it repeats or scales a measurement.

Low/base/high multiply future archive growth, sales-request cadence and owner-session
volume by 0.5/1/2, and divide assumed resource capacity by that factor. Startup and
idle remain separate. This range is illustrative, not a measured error bound.
Request quantities are aggregated across venues before tier pricing and rounding
up to a whole expected request. Failed-request billing and unknown request classes
remain gaps. The calculator does not claim an exact KMS request meter.

Archive simulation starts on 1 January 2027. It assumes a daily capture plus a
separate monthly capture on the first day, daily retention of 30 days and your
selected monthly retention. No production scheduler or shared-object selection is
inferred. Initial archive bytes default to the copied database size as an explicit
uncompressed-size assumption; they are not the measured small fresh-venue archive.
Future per-sale growth repeats the measured fresh-venue growth with your multiplier.
Each simulated capture verifies successfully. The pure retention model preserves
the last verified copy, but failure frequency, additional recovery references,
noncurrent versions, multipart lifetimes and continuous-stream storage remain gaps.
The later retention window begins one month beyond the selected retention horizon;
its database keeps growing. It is not a stationary storage total.

The displayed storage quantities are average retained bytes: byte-seconds divided
by the actual calendar-window seconds. Pricing divides byte-seconds by those
seconds and the S3 billing divisor of 1,073,741,824 bytes per billed GB. Decimal
GB is 1,000,000,000 bytes; GiB is 1,073,741,824 bytes. Other provider byte definitions
are not silently borrowed from S3. An assumed transfer-byte divisor is exposed
separately. Missing minimum/rounding terms prevent pricing both archive storage
and transfer in the current snapshot, even when their quantities can be projected.

## The synthetic AWS trial stopped before creation

The [trial assessment](cost-model/live-check.json) reports
**${assessment.status}**. Object-size/lifetime distributions, schedules,
retry ceilings and operation-specific billing bounds are incomplete. The
illustrative high-cadence workload component alone projects
${assessment.scenarios.high.workloadAttempts.toLocaleString('en-US')} requests,
above the 10,000-request cap before cleanup. That multiplier is an assumption,
not a proved request ceiling. The base projection also cannot authorise a trial:
being under the cap for known components does not bound missing work.

No synthetic payloads or AWS resources were created for this trial, and no
Cost Explorer read is due for it. Live and billing execution are unavailable.
There is no measured provider bill or billing agreement. The earlier storage
rehearsal, its key-deletion follow-up and its billing budget stay separate.
Do not truncate measured operations or increase a cap to turn this stop into a pass.

## Keep unpriced costs visible

Every required capability below stays in the gap list until its quantities,
billing rules and scenario coverage are complete. A priced instance alone does
not cover its disks, CPU credits, backups or operating work. Alternative and
excluded rows remain visible so they cannot silently become zero-cost promises.
The current model reports ${result.gaps.length} named capability or evidence gaps.

| Capability | Inclusion | Scope | Quantity driver | Open choice or limitation |
| --- | --- | --- | --- | --- |
${capabilities}

Gross AWS subtotals apply no free allowance, discount, credit or tax. Allowances
may be shared across an account and cannot be applied once per venue. Customer
credits are not a reduction in the service's underlying list cost. Tax, exchange
rates and external mail API prices remain unknown. GitHub's standard-runner
CI is free for this public repository under the owner's current operating decision;
paid/private/special runner use is a separate quantity and is not included here.
The historical paid-minute snapshot in prices.json is not a monthly CI charge.

## Price snapshot and exact regional terms

These are stored list-price receipts read on 14 October 2026, not a fresh provider
quote. The [full price file](cost-model/prices.json) carries service attributes,
units, tiers, minimums, rounding, source quotes, applicability and exclusions.
An unavailable regional price remains unknown. The calculator does not substitute
a Stockholm price for Spain. The source date links below open the exact offer file.

| Price | Region | USD/unit | Unit | Tier | SKU / rate code | Read date and source | Effective at |
| --- | --- | ---: | --- | --- | --- | --- | --- |
${prices}

Before using a complete figure for a launch decision, establish each remaining
driver and billing path, validate provider capacity and costs, and review the
[launch evidence boundary](launch-evidence.md). An offline subtotal supplies no
deployment or recovery authority.

The registry measurements in \`docs/cost-model/\`, including
\`service-mail-retry-fiscal-lifecycle.json\` and
\`service-signup-recovery-fiscal-refusal.json\`, are historical receipts for the
retired service. Their formats, numbers and parsers remain unchanged. Current
mixed conformance journeys retain mail delivery, signup, password recovery,
privacy and owned cleanup; they do not generate a replacement fiscal measurement.
`;
}

export async function generatePublicArtifacts() {
  try {
    const inputs = { prices: read('prices'), inventory: read('inventory'), samples: read('local-driver-evidence').experiments,
      settings: read('projection-settings') };
    const data = prepareCalculatorData(inputs), assessment = assessStorageRehearsal({ samples: inputs.samples, ...inputs.settings });
    return { 'docs/cloud-cost-calculator.html': await renderCalculator({ data }),
      'docs/cloud-cost-model.md': renderModel({ data, inventory: inputs.inventory, assessment }),
      'docs/cost-model/live-check.json': JSON.stringify(assessment, null, 2) + '\n' };
  } catch { fail(); }
}

export function verifyArtifacts(actual, expected) {
  try {
    const paths = Object.keys(expected);
    if (Object.keys(actual).length !== paths.length || paths.some(path => typeof actual[path] !== 'string' || actual[path] !== expected[path])) fail();
    return { artifacts: paths.length, complete: false, liveCheck: 'stopped-before-provision' };
  } catch { fail(); }
}

export async function runPublicCommand(command) {
  try {
    if (!['build', 'verify'].includes(command)) fail();
    const expected = await generatePublicArtifacts();
    if (command === 'build') {
      for (const [path, text] of Object.entries(expected)) {
        const destination = new URL(path, root), temporary = new URL(path + '.tmp-' + randomUUID(), root);
        try { writeFileSync(temporary, text, { flag: 'wx' }); renameSync(temporary, destination); }
        finally { if (existsSync(temporary)) unlinkSync(temporary); }
      }
    }
    const actual = Object.fromEntries(Object.keys(expected).map(path => [path, readFileSync(new URL(path, root), 'utf8')]));
    return verifyArtifacts(actual, expected);
  } catch { fail(); }
}
