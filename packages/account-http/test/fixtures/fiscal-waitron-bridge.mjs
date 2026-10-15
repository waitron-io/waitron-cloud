import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const c = JSON.parse(await readFile(process.argv[2], 'utf8'));
const load = (path) => import(pathToFileURL(join(c.candidate, path)).href);
const fiscal = await load('packages/fiscal-verifactu/src/index.ts');
const { createCloudFiscalAllocationClient } = await load('apps/server/src/cloud-fiscal-allocation-client.ts');
const { reconcileCloudFiscalAllocation } = await load('apps/server/src/cloud-fiscal-allocation.ts');
const trust = { issuer: c.trust.issuer, keys: new Map([[c.trust.keyId, c.trust.publicKey]]) };
const allocation = c.receipt.payload.allocation;
const approval = c.receipt.payload.approval;
const bases = [{ code: 'A', purpose: 'standard' }, { code: 'FF', purpose: 'full' }, { code: 'R', purpose: 'rectificative' }];
const context = { taxpayerNif: '89890001K', softwareId: 'WT', environment: 'preproduction', mode: 'recovery',
  ...c.receipt.payload.binding, requiredBases: bases, priorActivation: 'none',
  reauthentication: { operatorId: approval.operatorId, eventId: approval.eventId }, authority: { kind: 'cloud', trust, receipt: c.receipt } };
const client = (account = c.account) => createCloudFiscalAllocationClient({ origin: c.origin, environment: 'dev', account });
let reportConfiguration;
let reportRequests;

async function activate() {
  const dbApi = await load('packages/db/src/index.ts');
  const { installAppendOnlyTriggers } = await load('packages/store/src/index.ts');
  const { TEST_MIGRATIONS } = await load('packages/fiscal-verifactu/test/migrations.ts');
  const { seedTenants, TENANT_A } = await load('packages/fiscal-verifactu/test/fixtures.ts');
  const { seedFixtureSif } = await load('packages/fiscal-verifactu/test/sif-fixture.ts');
  const { withOperationAuthority } = await load('packages/module/src/index.ts');
  const { activatePreparedModuleAllocation } = await load('packages/fiscal-verifactu/src/allocation-preparation.ts');
  const store = await dbApi.openVenueDatabase(join(c.root, 'venue'));
  try {
    const db = store.venue;
    for (const set of TEST_MIGRATIONS) {
      await dbApi.runMigrations(db, set);
      installAppendOnlyTriggers(db, set.appendOnlyTables ?? []);
    }
    await seedTenants(db);
    // The Cloud reservation is bound to the fixture's actual replacement node.
    if (TENANT_A.nodeId !== approval.targetNodeId) throw Error(`target fixture mismatch: ${TENANT_A.nodeId}`);
    await db.insert(dbApi.deployment).values({ id: 1, environment: 'preproduction' });
    await db.insert(dbApi.invoiceSeries).values(bases.map((base) => ({ ...base, nodeId: TENANT_A.nodeId })));
    await dbApi.withTransaction(db, (tx) => seedFixtureSif(tx, { nodeId: TENANT_A.nodeId, nif: '89890001K', idSistemaInformatico: 'WT', numeroInstalacion: 'P000001' }));
    const outside = join(c.root, 'outside'); await mkdir(outside);
    const confirmationPath = join(c.root, 'current.json');
    const binding = { module: 'fiscal-verifactu', action: 'restore', eventId: approval.eventId, sourceId: approval.sourceId, targetNodeId: approval.targetNodeId };
    await writeFile(confirmationPath, JSON.stringify({ version: 1, binding, operatorId: approval.operatorId, allocationId: allocation.allocationId, receiptId: c.receipt.payload.receiptId,
      priorActivation: 'none', incidentEvidence: approval.incidentEvidence, requiredBases: bases }));
    const preparation = fiscal.createCloudAllocationPreparation({ trust, confirmationPath, receiptDirectory: outside });
    const result = await withOperationAuthority(binding, approval.operatorId, (authority) => preparation.prepare({ binding, authority,
      input: { allocation, approval, receipt: c.packet } }, (ready) => dbApi.withTransaction(db, (tx) => activatePreparedModuleAllocation(tx, { nodeId: TENANT_A.nodeId, locationId: TENANT_A.locationId }, ready))));
    const receiptPath = join(outside, createHash('sha256').update(allocation.allocationId).digest('hex') + '.json');
    const operation = await fiscal.readCloudAllocationReport(db, { nodeId: TENANT_A.nodeId, locationId: TENANT_A.locationId }, { receiptPath, trust });
    const journal = join(c.root, 'journal'); await mkdir(journal);
    let requests = 0;
    reportRequests = () => requests;
    const transport = { async report(proof) { requests++; return client().report(proof); } };
    reportConfiguration = { directory: journal, operation, transport, authenticate: async () => c.authentication };
    const report = await reconcileCloudFiscalAllocation(reportConfiguration);
    const repeated = await reconcileCloudFiscalAllocation(reportConfiguration);
    const files = await readdir(journal);
    const text = (await Promise.all(files.map((path) => readFile(join(journal, path), 'utf8')))).join('\n');
    return { series: result.series.map(({ code, purpose }) => ({ code, purpose })), operatorId: (await db.select().from(fiscal.fiscalAllocations))[0].approval.operatorId,
      localAllocations: (await db.select().from(fiscal.fiscalAllocations)).length, report, repeated, requests,
      secretInJournal: text.includes(c.authentication.privateKey) || text.includes(c.authentication.lease.payload) || text.includes(c.account.cookie) };
  } finally { await store.close(); }
}
async function run(action, input) {
  if (action === 'ready') return { candidate: c.candidate };
  if (action === 'status') {
    const account = { ...c.account };
    if (input.field) account[input.field] = 'invalid';
    try { return await client(account).status(c.status); } catch (error) { return { error: error.code }; }
  }
  if (action === 'verify') {
    const held = structuredClone(context);
    if (input.field === 'requiredBases') held.requiredBases = [{ code: 'A', purpose: 'standard' }, { code: 'FF', purpose: 'standard' }, { code: 'R', purpose: 'rectificative' }];
    else if (input.field && !['trust', 'reserved'].includes(input.field)) held[input.field] = 'changed';
    let supplied = input.field === 'reserved' ? c.reserved : c.packet;
    if (input.field === 'signature') {
      supplied = structuredClone(c.receipt);
      const signature = Buffer.from(supplied.signature, 'base64url');
      signature[0] ^= 1; supplied.signature = signature.toString('base64url');
    }
    return fiscal.verifyCloudAllocationEvidence(supplied, input.field === 'trust' ? null : trust, held);
  }
  if (action === 'activate') return activate();
  if (action === 'lostReport') {
    const directory = join(c.root, 'lost-journal'); await mkdir(directory);
    let requests = 0, authentications = 0;
    const proofs = [];
    const configuration = { ...reportConfiguration, directory,
      operation: { ...reportConfiguration.operation, operationId: randomUUID() },
      async authenticate() { authentications++; return { ...c.authentication, now: Date.now() + authentications }; },
      transport: { async report(proof) {
        requests++; proofs.push(JSON.parse(Buffer.from(proof.payload, 'base64url').toString('utf8')));
        const result = await client().report(proof);
        if (requests === 1) throw Error('discarded actual committed HTTP reply');
        return result;
      } },
    };
    let firstError;
    try { await reconcileCloudFiscalAllocation(configuration); } catch (error) { firstError = error.code; }
    const recovered = await reconcileCloudFiscalAllocation(configuration);
    return { firstError, recovered, requests, authentications, sameOperation: proofs[0][5] === proofs[1][5] && JSON.stringify(proofs[0][9]) === JSON.stringify(proofs[1][9]) && proofs[0][6] !== proofs[1][6] };
  }
  if (action === 'conflict') {
    const before = reportRequests();
    let refusal;
    try { await reconcileCloudFiscalAllocation({ ...reportConfiguration, operation: { ...reportConfiguration.operation, body: { ...reportConfiguration.operation.body, activationEvidence: { changed: true } } } }); }
    catch (error) { refusal = error.code; }
    if (!refusal) throw Error('changed report unexpectedly accepted');
    const repeated = await reconcileCloudFiscalAllocation(reportConfiguration);
    return { error: refusal, repeated, requests: reportRequests() - before };
  }
  throw Error('unknown joint command');
}
for await (const line of createInterface({ input: process.stdin })) {
  const { id, action, input } = JSON.parse(line);
  try { process.stdout.write('JOINT:' + JSON.stringify({ id, result: await run(action, input) }) + '\n'); }
  catch (error) { process.stdout.write('JOINT:' + JSON.stringify({ id, failure: error.stack }) + '\n'); }
}
