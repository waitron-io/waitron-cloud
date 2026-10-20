// Public pinned code and generated databases only. Never configure this fixture with a real venue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { preparePrivateCopy,readPrivateReplayBills,prepareReplayDay,replayScheduledSales } from '../local.mjs';
import { openReplay } from '../waitron-adapter.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG,'utf8'));
const config = { localEndpoints:{s3:'http://s3:8333',postgres:'postgresql://fixture:fixture@postgres:5432/fixture',
  smtp:'smtp://mailpit:1025',fiscal:'http://fiscal:8080',gateway:'https://gateway:443'},
  senders:{fiscal:'disabled',mail:'capture',acme:'disabled',dns:'disabled'} };
const initial = { taxpayer:{country:'ES',taxId:'12345678Z',legalName:'Synthetic SL',taxpayerDomicile:'Synthetic issuer street'},
  location:{name:'Synthetic venue',invoiceLocales:['es'],operationDescription:'Servicio',timeZone:'Europe/Madrid',dayCutover:'06:00:00'},
  nodeName:'Synthetic node',seriesCode:'R',fullSeriesCode:'F',idSistemaInformatico:'WR' };
function sale(at,n) {
  return {origin:{source:'operator_script',deviceId:null},locale:'es',invoiceLocales:['es','en'],total:'12.10',
    vatBreakdown:[{rate:'21.00',base:'10.00',tax:'2.10'}],
    lines:[{lineNo:1,name:`Synthetic item ${n}`,descriptions:{es:'Artículo',en:'Item'},quantity:'0.005',priceQuantity:'0.250',
      unitPrice:'10.00',vatRate:'21.00',lineTotal:'10.00',lineGross:'12.10',listGross:'13.00',
      unitName:{es:'kg'},unitPrecision:3,category:'Synthetic food',variantName:'Large',variantDescriptions:{es:'Grande',en:'Large'},
      kitchenName:'Dish',variantKitchenName:'L',productId:'synthetic-product',parentProductId:'synthetic-parent',
      menuId:'synthetic-menu',menuVersionId:'synthetic-version'}],
    clock:{now:()=>({instant:new Date(at),offsetMinutes:60,confident:true,confidence:'anchored',anchorAgeSeconds:0})},
    settlement:{kind:'immediate',tenders:[{method:'cash',amount:'6.00',cashTendered:'10.00',tipAmount:'0.50',settledAt:new Date(at)},
      {method:'card',amount:'7.10',tipAmount:'0.50',settledAt:new Date(at)}]} };
}
async function setup(t) {
  const parent = mkdtempSync(join(fixture.stateParent,'copied-bills-')); chmodSync(parent,0o700);
  const source = join(parent,'source'),root = join(parent,'owned'),stateRoot = join(parent,'target');
  for (const path of [source,root,stateRoot]) mkdirSync(path,{mode:0o700});
  let sourceReplay,targetReplay,copy;
  t.after(async()=> {try {await sourceReplay?.close();await targetReplay?.close();await copy?.close();}
    finally {rmSync(parent,{recursive:true,force:true});} });
  sourceReplay = await openReplay({codeRoot:fixture.codeRoot,stateRoot:source,config,initial});
  const times = ['2026-03-28T04:59:59.999Z','2026-03-28T05:00:00.000Z','2026-03-28T05:00:01.000Z','2026-03-29T04:00:00.000Z'];
  for (let n=0;n<times.length;n++) {
    const input = sale(times[n],n);
    if (n===2) {input.counterparty={taxId:'12345678Z',legalName:'Synthetic SL',countryCode:'ES'};input.recipientAddress='Synthetic street';}
    await sourceReplay.recordSale(input);
  }
  await sourceReplay.close();
  const sourceDatabase = join(source,'venue/venue.db'), db = new DatabaseSync(sourceDatabase,{readOnly:true});
  let locationId;
  try {locationId=db.prepare('SELECT id FROM locations').get().id;} finally {db.close();}
  const token = randomBytes(32).toString('hex'),path=join(root,'journal.json');
  writeFileSync(join(root,'.cloud-cost-owner'),token,{mode:0o600});
  writeFileSync(path,JSON.stringify({schemaVersion:1,source,root,ownershipToken:token}),{mode:0o600});
  const args = {source,root,journal:{path,token}};
  copy = await preparePrivateCopy({...args,database:sourceDatabase});
  targetReplay = await openReplay({codeRoot:fixture.codeRoot,stateRoot,config,initial});
  return {...args,database:copy.database,sourceDatabase,locationId,targetReplay,stateRoot,
    bounds:{startAt:times[1],endAt:times[3]},expectedSales:2};
}
const rows = (db,sql) => db.prepare(sql).all().map(row=>({...row}));

// Dropped snapshots, wrong scales or copied source identities change the durable new sale.
test('copiedBillsRoundTripThroughRealMigrationsWriterAndFreshFiscalChain',async t=> {
  const f = await setup(t),result = readPrivateReplayBills(f);
  assert.deepEqual(result.counts,{source:4,paid:4,selected:2});
  const prepared=prepareReplayDay({bounds:f.bounds,events:result.events,expectedSales:2});
  const summary=await replayScheduledSales({...prepared,cadence:{mode:'accelerated',factor:1000},windowSeconds:10,
    recordSale:value=>f.targetReplay.recordSale(value)});
  assert.deepEqual(summary.counts,{expected:2,attempted:2,successful:2,failed:0});
  assert.equal(JSON.stringify(summary).includes('Synthetic'),false);
  assert.equal(JSON.stringify(summary).includes('2026-'),false);
  assert.deepEqual(await f.targetReplay.verify(),{ok:true,issues:0});
  const db=new DatabaseSync(join(f.stateRoot,'venue/venue.db'),{readOnly:true});
  try {
    assert.deepEqual(rows(db,`SELECT issued_at,issued_offset_minutes,total,vat_breakdown,invoice_number,counterparty_tax_id,
      counterparty_address FROM sales ORDER BY issued_at`),[
      {issued_at:'2026-03-28T05:00:00.000Z',issued_offset_minutes:60,total:1210,
        vat_breakdown:'[{"rate":"21.00","base":"10.00","tax":"2.10"}]',invoice_number:1,counterparty_tax_id:null,counterparty_address:null},
      {issued_at:'2026-03-28T05:00:01.000Z',issued_offset_minutes:60,total:1210,
        vat_breakdown:'[{"rate":"21.00","base":"10.00","tax":"2.10"}]',invoice_number:1,counterparty_tax_id:'12345678Z',counterparty_address:'Synthetic street'},
    ]);
    assert.deepEqual(rows(db,`SELECT name,quantity,price_quantity,unit_price,vat_rate,line_total,line_gross,list_gross,
      unit_name,unit_precision,variant_name,variant_descriptions,category,product_id,parent_product_id,menu_id,menu_version_id FROM sale_lines ORDER BY rowid`),
      [1,2].map(n=>({name:`Synthetic item ${n}`,quantity:5,price_quantity:250,unit_price:1000,vat_rate:2100,line_total:1000,
        line_gross:1210,list_gross:1300,unit_name:'{"es":"kg"}',unit_precision:3,variant_name:'Large',
        variant_descriptions:'{"es":"Grande","en":"Large"}',category:'Synthetic food',product_id:'synthetic-product',
        parent_product_id:'synthetic-parent',menu_id:'synthetic-menu',menu_version_id:'synthetic-version'})));
    assert.deepEqual(rows(db,'SELECT method,amount,cash_tendered,tip_amount FROM tenders ORDER BY rowid'),[
      {method:'cash',amount:600,cash_tendered:1000,tip_amount:50},{method:'card',amount:710,cash_tendered:null,tip_amount:50},
      {method:'cash',amount:600,cash_tendered:1000,tip_amount:50},{method:'card',amount:710,cash_tendered:null,tip_amount:50},
    ]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sale_settlements').get().n,2);
    const source = new DatabaseSync(f.database,{readOnly:true});
    try {assert.equal(db.prepare('SELECT node_id FROM sales LIMIT 1').get().node_id === source.prepare('SELECT node_id FROM sales LIMIT 1').get().node_id,false);}
    finally {source.close();}
  } finally {db.close();}
});

test('copiedBadPaymentStillUsesRealWriterRollbackAndStopsRemainingSales',async t=> {
  const f=await setup(t), result=readPrivateReplayBills(f);
  result.events[0].sale.settlement.tenders[0].amount='5.00';
  const prepared=prepareReplayDay({bounds:f.bounds,events:result.events,expectedSales:2});
  await assert.rejects(replayScheduledSales({...prepared,cadence:{mode:'accelerated',factor:1000},windowSeconds:10,
    recordSale:value=>f.targetReplay.recordSale(value)}),/Invalid cloud cost replay cadence/);
  assert.deepEqual(f.targetReplay.counts(),{attempted:1,successful:0,failed:1});
  const target=new DatabaseSync(join(f.stateRoot,'venue/venue.db'),{readOnly:true});
  try {
    assert.equal(target.prepare('SELECT count(*) AS n FROM sales').get().n,0);
    assert.equal(target.prepare('SELECT count(*) AS n FROM tenders').get().n,0);
    assert.equal(target.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n,0);
    assert.deepEqual(rows(target,"SELECT code,next_number FROM invoice_series ORDER BY code"),[{code:'F',next_number:1},{code:'R',next_number:1}]);
  } finally {target.close();}
});
