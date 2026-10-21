import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync,
  statSync, chmodSync, copyFileSync, renameSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as local from './local.mjs';

const invalid = { message: 'Invalid cloud cost local run' };
const available = () => assert.equal(typeof local.readPrivateReplayBills, 'function', 'read copied paid bills through the normal sale-input boundary');
const startAt = '2026-03-28T05:00:00.000Z', endAt = '2026-03-29T04:00:00.000Z';
const fingerprint = path => ({ sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), mtime: statSync(path).mtimeMs });
async function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-source-bills-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const database = join(source, 'venue.db'), db = new DatabaseSync(database);
  try {
    db.exec(`CREATE TABLE locations(id TEXT PRIMARY KEY,time_zone TEXT,day_cutover TEXT);
      CREATE TABLE location_day_cutover_changes(location_id TEXT,effective_business_day TEXT,day_cutover TEXT);
      INSERT INTO locations VALUES('location-one','Europe/Madrid','06:00:00'),('location-two','UTC','00:00:00');
      CREATE TABLE nodes(id TEXT PRIMARY KEY,location_id TEXT);
      INSERT INTO nodes VALUES('node-one','location-one'),('node-two','location-two');
      CREATE TABLE sales(id TEXT PRIMARY KEY,node_id TEXT,issued_at TEXT,issued_offset_minutes INTEGER,total INTEGER,
        vat_breakdown TEXT,locale TEXT,invoice_locales TEXT,corrects_sale_id TEXT,counterparty_tax_id TEXT,
        counterparty_legal_name TEXT,counterparty_country_code TEXT,counterparty_address TEXT);
      CREATE TABLE sale_lines(id TEXT PRIMARY KEY,sale_id TEXT,line_no INTEGER,name TEXT,descriptions TEXT,
        quantity INTEGER,price_quantity INTEGER,unit_price INTEGER,vat_rate INTEGER,line_total INTEGER,
        parent_line_id TEXT,option_snapshots TEXT,unit_name TEXT,unit_precision INTEGER,category TEXT,
        variant_name TEXT,variant_descriptions TEXT,variant_kitchen_name TEXT,kitchen_name TEXT,
        product_id TEXT,parent_product_id TEXT,menu_id TEXT,menu_version_id TEXT,line_gross INTEGER,
        list_gross INTEGER,classification TEXT,corrects_line_id TEXT);
      CREATE TABLE tenders(id TEXT PRIMARY KEY,sale_id TEXT,method TEXT,amount INTEGER,cash_tendered INTEGER,tip_amount INTEGER,settled_at TEXT);
      CREATE TABLE sale_settlements(sale_id TEXT,settled_at TEXT);
      CREATE TABLE sale_voids(sale_id TEXT);
      CREATE TABLE sale_substitutions(substitution_sale_id TEXT,substituted_sale_id TEXT);`);
    const insertSale = db.prepare(`INSERT INTO sales VALUES(?, ?, ?, 60, ?, '[{"rate":"21.00","base":"10.00","tax":"2.10"}]',
      'es','["es","en"]',NULL,NULL,NULL,NULL,NULL)`);
    const entries = [['left','node-one','2026-03-28T04:59:59.999Z',1210], ['first','node-one',startAt,1210],
      ['tie','node-one',startAt,1210], ['right','node-one',endAt,1210], ['unpaid','node-one',startAt,1210],
      ['zero','node-one',startAt,0], ['foreign','node-two',startAt,1210]];
    for (const [id,node,at,total] of entries) {
      insertSale.run(id,node,at,total);
      if (id !== 'unpaid') db.prepare('INSERT INTO sale_settlements VALUES(?,?)').run(id,at);
      db.prepare(`INSERT INTO sale_lines(id,sale_id,line_no,name,descriptions,quantity,price_quantity,unit_price,vat_rate,line_total,option_snapshots)
        VALUES(?,?,1,'SYNTHETIC_PRIVATE_ITEM','{"es":"Artículo","en":"Item"}',1000,1000,1000,2100,1000,'[]')`).run(id+'-line',id);
      db.prepare('INSERT INTO tenders VALUES(?,?,\'cash\',1210,2000,0,?)').run(id+'-tender',id,at);
    }
  } finally { db.close(); }
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const args = { source, root, journal: { path, token } };
  const copy = await local.preparePrivateCopy({ ...args, database });
  return { ...args, database: copy.database, sourceDatabase: database, copy, locationId: 'location-one',
    bounds: { startAt, endAt }, expectedSales: 2 };
}
function edit(f, sql) { const db = new DatabaseSync(f.database); try { db.exec(sql); } finally { db.close(); } }

// The reader must not select another location, an unpaid bill, zero revenue, or the right boundary.
test('copiedPaidBillsSelectTheLocationAndHalfOpenTradingDayInStableOrder', async t => {
  available(); const f = await fixture(t), result = local.readPrivateReplayBills(f);
  assert.deepEqual(result.counts, { source: 6, paid: 4, selected: 2 });
  assert.deepEqual(result.events.map(e => e.at), [startAt,startAt]);
  assert.deepEqual(result.events.map(e => e.sale.total), ['12.10','12.10']);
  assert.deepEqual(result.events[0].sale.origin, { source: 'operator_script', deviceId: null });
  for (const event of result.events) {
    assert.equal('nodeId' in event.sale, false); assert.equal('seriesId' in event.sale, false);
    assert.equal('workingOrderId' in event.sale, false);
    assert.deepEqual(event.sale.vatBreakdown, [{ rate: '21.00', base: '10.00', tax: '2.10' }]);
    assert.equal(event.sale.locale, 'es'); assert.deepEqual(event.sale.invoiceLocales, ['es','en']);
    const time = event.sale.clock.now();
    assert.equal(time.instant.toISOString(), startAt); assert.equal(time.offsetMinutes, 60);
    time.instant.setUTCFullYear(2000);
    assert.equal(event.sale.clock.now().instant.toISOString(), startAt);
  }
  edit(f, "UPDATE sale_lines SET name='Second stable sale' WHERE sale_id='tie'");
  assert.deepEqual(local.readPrivateReplayBills(f).events.map(e => e.sale.lines[0].name), ['SYNTHETIC_PRIVATE_ITEM','Second stable sale']);
  const scheduled = local.prepareReplayDay({ bounds: f.bounds, events: result.events, expectedSales: 2 });
  assert.deepEqual(scheduled.events.map(e => e.offsetSeconds), [0,0]);
});

test('copiedLinesKeepTheirIndependentScalesAndPresentationSnapshots', async t => {
  available(); const f = await fixture(t);
  edit(f, `UPDATE sale_lines SET quantity=5,price_quantity=250,unit_price=12345,vat_rate=725,line_total=-101,
    line_gross=123,list_gross=145,unit_name='{"es":"kg"}',unit_precision=3,category='Food',
    variant_name='Large',variant_descriptions='{"es":"Grande"}',variant_kitchen_name='L',kitchen_name='Dish',
    product_id='product',parent_product_id='parent',menu_id='menu',menu_version_id='version',
    classification='{"category":"Synthetic"}',option_snapshots='[{"synthetic":"choice"}]' WHERE sale_id='first';
    INSERT INTO sale_lines(id,sale_id,line_no,name,descriptions,quantity,price_quantity,unit_price,vat_rate,line_total,parent_line_id,option_snapshots)
    VALUES('child','first',2,'Extra','{"es":"Extra"}',1000,1000,50,2100,50,'first-line','[]')`);
  const [line,child] = local.readPrivateReplayBills(f).events[0].sale.lines;
  assert.deepEqual(line, { lineNo: 1, name: 'SYNTHETIC_PRIVATE_ITEM', descriptions: { es:'Artículo',en:'Item' },
    quantity:'0.005',priceQuantity:'0.250',unitPrice:'123.45',vatRate:'7.25',lineTotal:'-1.01',
    lineGross:'1.23',listGross:'1.45',parentLineNo:null,optionSnapshots:[{synthetic:'choice'}],
    unitName:{es:'kg'},unitPrecision:3,category:'Food',variantName:'Large',variantDescriptions:{es:'Grande'},
    variantKitchenName:'L',kitchenName:'Dish',productId:'product',parentProductId:'parent',menuId:'menu',
    menuVersionId:'version',classification:{category:'Synthetic'} });
  assert.equal(child.parentLineNo, 1);
  assert.equal(child.lineGross, null); assert.equal(child.listGross, null);
  assert.equal(child.unitName, null); assert.equal(child.unitPrecision, null);
});

test('copiedPaymentsPreserveSplitAmountsTipsCashAndSettlementInstants', async t => {
  available(); const f = await fixture(t);
  edit(f, `UPDATE tenders SET amount=600,cash_tendered=1000,tip_amount=50 WHERE sale_id='first';
    INSERT INTO tenders VALUES('split','first','card',710,NULL,50,'2026-03-28T05:00:05.000Z')`);
  const tenders = local.readPrivateReplayBills(f).events[0].sale.settlement;
  assert.deepEqual(tenders, { kind:'immediate',tenders:[
    { method:'cash',amount:'6.00',cashTendered:'10.00',tipAmount:'0.50',settledAt:new Date(startAt) },
    { method:'card',amount:'7.10',cashTendered:null,tipAmount:'0.50',settledAt:new Date('2026-03-28T05:00:05.000Z') },
  ] });
});

test('copiedFullInvoiceKeepsRecipientWithoutCarryingTheOriginalLedgerIdentity', async t => {
  available(); const f = await fixture(t);
  edit(f, `UPDATE sales SET counterparty_tax_id='12345678Z',counterparty_legal_name='Synthetic SL',
    counterparty_country_code='ES',counterparty_address='Synthetic address' WHERE id='first'`);
  const sale = local.readPrivateReplayBills(f).events[0].sale;
  assert.deepEqual(sale.counterparty, { taxId:'12345678Z',legalName:'Synthetic SL',countryCode:'ES' });
  assert.equal(sale.recipientAddress, 'Synthetic address');
});

test('readingBillsLeavesSourceCopyJournalAndSidecarSetUnchanged', async t => {
  available(); const f = await fixture(t), paths = [f.database,f.sourceDatabase,f.journal.path];
  const before = paths.map(fingerprint), entries = readdirSync(f.root).sort();
  local.readPrivateReplayBills(f); local.readPrivateReplayBills(f);
  assert.deepEqual(paths.map(fingerprint),before); assert.deepEqual(readdirSync(f.root).sort(),entries);
  await f.copy.close(); assert.throws(() => local.readPrivateReplayBills(f), invalid);
});

for (const [name,sql] of [
  ['corrective',"UPDATE sales SET corrects_sale_id='left' WHERE id='first'"],
  ['void',"INSERT INTO sale_voids VALUES('first')"],
  ['substitute',"INSERT INTO sale_substitutions VALUES('first','left')"],
  ['substituted',"INSERT INTO sale_substitutions VALUES('left','first')"],
  ['corrective-line',"UPDATE sale_lines SET corrects_line_id='left-line' WHERE sale_id='first'"],
  ['missing-lines',"DELETE FROM sale_lines WHERE sale_id='first'"],
  ['missing-tenders',"DELETE FROM tenders WHERE sale_id='first'"],
  ['dangling-parent',"UPDATE sale_lines SET parent_line_id='foreign-line' WHERE sale_id='first'"],
  ['self-parent',"UPDATE sale_lines SET parent_line_id=id WHERE sale_id='first'"],
  ['fractional-cents',"UPDATE sales SET total=1210.5 WHERE id='first'"],
  ['unsafe-integer',"UPDATE sale_lines SET unit_price=9007199254740992 WHERE sale_id='first'"],
  ['text-integer',"UPDATE sale_lines SET unit_price='0x12' WHERE sale_id='first'"],
  ['bad-issued-time',"UPDATE sales SET issued_at='SYNTHETIC_PRIVATE_TIMESTAMP' WHERE id='first'"],
  ['normalised-date',"UPDATE sales SET issued_at='2026-02-30T05:00:00.000Z' WHERE id='left'"],
  ['offset',"UPDATE sales SET issued_offset_minutes=841 WHERE id='first'"],
  ['bad-settled-time',"UPDATE tenders SET settled_at='SYNTHETIC_PRIVATE_TIMESTAMP' WHERE sale_id='first'"],
  ['bad-json',"UPDATE sale_lines SET descriptions='SYNTHETIC_PRIVATE_JSON' WHERE sale_id='first'"],
  ['missing-vat',"UPDATE sales SET vat_breakdown=NULL WHERE id='first'"],
  ['empty-vat',"UPDATE sales SET vat_breakdown='[]' WHERE id='first'"],
  ['locale-membership',"UPDATE sales SET locale='fr' WHERE id='first'"],
  ['partial-recipient',"UPDATE sales SET counterparty_tax_id='12345678Z' WHERE id='first'"],
  ['duplicate-lines',"UPDATE sale_lines SET line_no=0 WHERE sale_id='first'"],
  ['duplicate-settlement',"INSERT INTO sale_settlements VALUES('first','2026-03-28T05:00:00.000Z')"],
  ['missing-schema','DROP TABLE sale_substitutions'],
  ['negative-offset',"UPDATE sales SET issued_offset_minutes=-841 WHERE id='first'"],
  ['missing-name',"UPDATE sale_lines SET name=NULL WHERE sale_id='first'"],
  ['oversized-name',"UPDATE sale_lines SET name=replace(hex(zeroblob(32769)),'0','x') WHERE sale_id='first'"],
  ['wrong-description-shape',"UPDATE sale_lines SET descriptions='[]' WHERE sale_id='first'"],
  ['wrong-options-shape',"UPDATE sale_lines SET option_snapshots='{}' WHERE sale_id='first'"],
  ['locale-not-an-array',"UPDATE sales SET invoice_locales='{}' WHERE id='first'"],
  ['too-many-locales',"UPDATE sales SET invoice_locales='[\"es\",\"en\",\"fr\"]' WHERE id='first'"],
  ['nontext-locale',"UPDATE sales SET invoice_locales='[\"es\",2]' WHERE id='first'"],
  ['recipient-address',"UPDATE sales SET counterparty_tax_id='12345678Z',counterparty_legal_name='Synthetic SL',counterparty_country_code='ES',counterparty_address=NULL WHERE id='first'"],
  ['orphan-recipient-address',"UPDATE sales SET counterparty_address='Synthetic street' WHERE id='first'"],
]) test(`unsupportedOrMalformedCopiedBillRefuses-${name}`, async t => {
  available(); const f = await fixture(t); edit(f,sql);
  assert.throws(() => local.readPrivateReplayBills(f), error => error.message === invalid.message
    && error.cause === undefined && !error.stack.includes('SYNTHETIC_PRIVATE'));
});

test('billCountAndBoundsCannotSilentlyDropPartOfTheWorkload', async t => {
  available(); const f = await fixture(t);
  for (const expectedSales of [0,1,3,1.5,null,undefined])
    assert.throws(() => local.readPrivateReplayBills({...f,expectedSales}),invalid);
  for (const bounds of [{startAt:endAt,endAt:startAt},{startAt,endAt:startAt},
    {startAt:'2026-02-30T05:00:00.000Z',endAt}, {startAt,endAt,extra:true}])
    assert.throws(() => local.readPrivateReplayBills({...f,bounds}),invalid);
  for (const locationId of ['',1,'missing']) assert.throws(() => local.readPrivateReplayBills({...f,locationId}),invalid);
});

test('billReaderRequiresTheRecordedPrivateSelfContainedCopy', async t => {
  available(); const f = await fixture(t), journalText = readFileSync(f.journal.path,'utf8');
  const other = join(f.root,'unrecorded.db'); copyFileSync(f.database,other); chmodSync(other,0o600);
  for (const database of [other,f.sourceDatabase]) assert.throws(() => local.readPrivateReplayBills({...f,database}),invalid);
  for (const field of ['kind','state','path','ino','dev']) {
    const value = JSON.parse(journalText), ready = value.localResources.find(v => v.state === 'ready');
    ready[field] = ['ino','dev'].includes(field) ? -1 : 'wrong'; writeFileSync(f.journal.path,JSON.stringify(value));
    assert.throws(() => local.readPrivateReplayBills(f),invalid);
  }
  writeFileSync(f.journal.path,journalText);
  chmodSync(f.database,0o644); assert.throws(() => local.readPrivateReplayBills(f),invalid); chmodSync(f.database,0o600);
  renameSync(f.database,join(f.root,'retained.db')); symlinkSync(join(f.root,'retained.db'),f.database);
  assert.throws(() => local.readPrivateReplayBills(f),invalid); rmSync(f.database); renameSync(join(f.root,'retained.db'),f.database);
  linkSync(f.database,other+'-link'); assert.throws(() => local.readPrivateReplayBills(f),invalid); rmSync(other+'-link');
  edit(f,'PRAGMA journal_mode=WAL'); const entries = readdirSync(f.root).sort();
  assert.throws(() => local.readPrivateReplayBills(f),invalid); assert.deepEqual(readdirSync(f.root).sort(),entries);
});

test('largeExactStoredIntegersDoNotRoundThroughFloatingPointMoney', async t => {
  available(); const f=await fixture(t);
  edit(f,"UPDATE sale_lines SET unit_price=9007199254740991 WHERE sale_id='first'");
  assert.equal(local.readPrivateReplayBills(f).events[0].sale.lines[0].unitPrice,'90071992547409.91');
  edit(f,"UPDATE sale_lines SET unit_price=9007199254740990 WHERE sale_id='first'");
  assert.equal(local.readPrivateReplayBills(f).events[0].sale.lines[0].unitPrice,'90071992547409.90');
});

test('lineOrderComesFromNumbersAndDuplicateNumbersCannotLoseAParent', async t => {
  available(); const f=await fixture(t);
  edit(f,`INSERT INTO sale_lines(id,sale_id,line_no,name,descriptions,quantity,price_quantity,unit_price,vat_rate,line_total,option_snapshots)
    VALUES('extra-three','first',3,'Third','{"es":"Third"}',1000,1000,100,2100,100,'[]'),
    ('extra-two','first',2,'Second','{"es":"Second"}',1000,1000,100,2100,100,'[]')`);
  assert.deepEqual(local.readPrivateReplayBills(f).events[0].sale.lines.map(v=>v.name),['SYNTHETIC_PRIVATE_ITEM','Second','Third']);
  edit(f,"UPDATE sale_lines SET line_no=1 WHERE id='extra-two'");
  assert.throws(()=>local.readPrivateReplayBills(f),invalid);
});

test('busyDayEventsKeepTheLastIncludedMillisecondAndOriginalSpacing', async t => {
  available(); const f=await fixture(t);
  edit(f,"UPDATE sales SET issued_at='2026-03-29T03:59:59.999Z',issued_offset_minutes=120 WHERE id='tie'");
  const result=local.readPrivateReplayBills(f);
  assert.deepEqual(result.events.map(v=>v.at),[startAt,'2026-03-29T03:59:59.999Z']);
  assert.equal(result.events[1].sale.clock.now().offsetMinutes,120);
  assert.deepEqual(local.prepareReplayDay({bounds:f.bounds,events:result.events,expectedSales:2}).events.map(v=>v.offsetSeconds),[0,82799.999]);
});

test('changedOwnershipAndReplacementCopyCannotReadBills', async t => {
  available(); const f=await fixture(t);
  writeFileSync(join(f.root,'.cloud-cost-owner'),'0'.repeat(64));
  assert.throws(()=>local.readPrivateReplayBills(f),invalid);writeFileSync(join(f.root,'.cloud-cost-owner'),f.journal.token);
  chmodSync(f.journal.path,0o644);assert.throws(()=>local.readPrivateReplayBills(f),invalid);chmodSync(f.journal.path,0o600);
  const saved=join(f.root,'original.db');renameSync(f.database,saved);copyFileSync(saved,f.database);chmodSync(f.database,0o600);
  assert.throws(()=>local.readPrivateReplayBills(f),invalid);
});

for (const [name,sql] of [
  ['source',`WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<100000)
    INSERT INTO sales(id,node_id,issued_at,total) SELECT 'cap-'||i,'node-one','2026-03-28T05:00:00.000Z',0 FROM n`],
  ['lines',`WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<10000)
    INSERT INTO sale_lines(id,sale_id,line_no,name,descriptions,quantity,price_quantity,unit_price,vat_rate,line_total,option_snapshots)
    SELECT 'cap-'||i,'first',i+2,'Synthetic extra','{"es":"Extra"}',1000,1000,100,2100,100,'[]' FROM n`],
  ['tenders',`WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<10000)
    INSERT INTO tenders(id,sale_id,method,amount,tip_amount,settled_at) SELECT 'cap-'||i,'first','card',1,0,'2026-03-28T05:00:00.000Z' FROM n`],
]) test(`oversizedPrivateBillSelectionRefusesInsteadOfTruncating-${name}`,async t=> {
  available();const f=await fixture(t);edit(f,sql);assert.throws(()=>local.readPrivateReplayBills(f),invalid);
});

test('billReaderCannotUseForgedSourceCopyMetadataOutsideTheOwnedRoot',async t=> {
  available();const f=await fixture(t),identity=statSync(f.sourceDatabase);chmodSync(f.sourceDatabase,0o600);
  const value=JSON.parse(readFileSync(f.journal.path));
  value.localResources.push({kind:'database-copy',state:'ready',path:f.sourceDatabase,ino:identity.ino,dev:identity.dev});
  writeFileSync(f.journal.path,JSON.stringify(value));
  assert.throws(()=>local.readPrivateReplayBills({...f,database:f.sourceDatabase}),invalid);
});

test('billReaderOrdersDifferentInstantsBeforeAssigningReplayOffsets',async t=> {
  available();const f=await fixture(t);
  edit(f,"UPDATE sales SET issued_at='2026-03-28T05:00:01.000Z' WHERE id='first'; UPDATE sale_lines SET name='Earlier' WHERE sale_id='tie'");
  const result=local.readPrivateReplayBills(f);
  assert.deepEqual(result.events.map(e=>e.sale.lines[0].name),['Earlier','SYNTHETIC_PRIVATE_ITEM']);
  assert.deepEqual(local.prepareReplayDay({bounds:f.bounds,events:result.events,expectedSales:2}).events.map(e=>e.offsetSeconds),[0,1]);
});
