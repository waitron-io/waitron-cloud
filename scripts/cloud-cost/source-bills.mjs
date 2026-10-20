const fail = () => { throw new Error('Invalid cloud cost local run'); };
const requireThat = value => { if (!value) fail(); };
const text = value => { requireThat(typeof value === 'string' && value.length > 0 && value.length <= 65536); return value; };
function instant(value) {
  text(value);
  requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
  const time = Date.parse(value);
  requireThat(Number.isFinite(time) && new Date(time).toISOString() === value);
  return time;
}
function scaled(value, places) {
  requireThat(Number.isSafeInteger(value));
  const number = BigInt(value), unit = 10n ** BigInt(places), positive = number < 0n ? -number : number;
  return `${number < 0n ? '-' : ''}${positive / unit}.${String(positive % unit).padStart(places,'0')}`;
}
function json(value, kind) {
  text(value); const parsed = JSON.parse(value);
  requireThat(kind === 'array' ? Array.isArray(parsed) : parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  return parsed;
}
const optionalJson = (value, kind) => value === null ? null : json(value,kind);
const optionalMoney = value => value === null ? null : scaled(value,2);
function translateBill(row, lines, tenders) {
  requireThat(row.corrects_sale_id === null && lines.length > 0 && tenders.length > 0);
  const time = instant(row.issued_at), offsetMinutes = row.issued_offset_minutes;
  requireThat(Number.isInteger(offsetMinutes) && offsetMinutes >= -840 && offsetMinutes <= 840);
  const invoiceLocales = json(row.invoice_locales,'array');
  requireThat(invoiceLocales.length >= 1 && invoiceLocales.length <= 2 && invoiceLocales.every(v => typeof v === 'string')
    && invoiceLocales.includes(row.locale));
  const vatBreakdown = json(row.vat_breakdown,'array'); requireThat(vatBreakdown.length > 0);
  const byId = new Map(), numbers = new Set();
  for (const line of lines) {
    requireThat(Number.isSafeInteger(line.line_no) && line.line_no > 0 && !numbers.has(line.line_no) && !byId.has(line.id));
    requireThat(line.corrects_line_id === null);
    byId.set(line.id,line.line_no); numbers.add(line.line_no);
  }
  const mappedLines = lines.map(line => {
    requireThat(line.parent_line_id === null || (byId.has(line.parent_line_id) && line.parent_line_id !== line.id));
    const result = { lineNo:line.line_no,name:text(line.name),descriptions:json(line.descriptions,'object'),
      quantity:scaled(line.quantity,3),priceQuantity:scaled(line.price_quantity,3),unitPrice:scaled(line.unit_price,2),
      vatRate:scaled(line.vat_rate,2),lineTotal:scaled(line.line_total,2),
      parentLineNo:line.parent_line_id === null ? null : byId.get(line.parent_line_id),
      optionSnapshots:json(line.option_snapshots,'array'),unitName:optionalJson(line.unit_name,'object'),
      unitPrecision:line.unit_precision,category:line.category,variantName:line.variant_name,
      variantDescriptions:optionalJson(line.variant_descriptions,'object'),variantKitchenName:line.variant_kitchen_name,
      kitchenName:line.kitchen_name,productId:line.product_id,parentProductId:line.parent_product_id,
      menuId:line.menu_id,menuVersionId:line.menu_version_id,lineGross:optionalMoney(line.line_gross),
      listGross:optionalMoney(line.list_gross),classification:optionalJson(line.classification,'object') };
    return result;
  });
  const sale = { origin:{source:'operator_script',deviceId:null},locale:text(row.locale),invoiceLocales,
    total:scaled(row.total,2),vatBreakdown,lines:mappedLines,
    // The stored instant/offset drive a new scratch sale; no original allocation or hash is imported.
    clock:{now:() => ({instant:new Date(time),offsetMinutes,confident:true,confidence:'anchored',anchorAgeSeconds:0})},
    settlement:{kind:'immediate',tenders:tenders.map(tender => ({method:text(tender.method),amount:scaled(tender.amount,2),
      cashTendered:optionalMoney(tender.cash_tendered),tipAmount:scaled(tender.tip_amount,2),
      settledAt:new Date(instant(tender.settled_at))}))} };
  const recipient = [row.counterparty_tax_id,row.counterparty_legal_name,row.counterparty_country_code];
  if (recipient.some(v => v !== null)) {
    recipient.forEach(text);
    sale.counterparty = {taxId:recipient[0],legalName:recipient[1],countryCode:recipient[2]};
    sale.recipientAddress = text(row.counterparty_address);
  } else requireThat(row.counterparty_address === null);
  return {at:row.issued_at,sale};
}

// Only the caller with a validated private selection connection may use this reader.
export function readReplayBills(db, {locationId,bounds,expectedSales}) {
  requireThat(bounds && Object.getPrototypeOf(bounds) === Object.prototype
    && Reflect.ownKeys(bounds).length === 2 && Object.hasOwn(bounds,'startAt') && Object.hasOwn(bounds,'endAt'));
  const start = instant(bounds.startAt), end = instant(bounds.endAt); requireThat(end > start);
  requireThat(Number.isSafeInteger(expectedSales) && expectedSales > 0 && expectedSales <= 100000);
  requireThat(db.prepare('SELECT id FROM locations WHERE id=?').get(locationId));
  const rows = db.prepare(`SELECT s.* FROM sales s JOIN nodes n ON n.id=s.node_id
    WHERE n.location_id=? ORDER BY s.issued_at,s.rowid LIMIT 100001`).all(locationId);
  requireThat(rows.length <= 100000);
  const settlement = db.prepare('SELECT count(*) AS n FROM sale_settlements WHERE sale_id=?');
  const voided = db.prepare('SELECT count(*) AS n FROM sale_voids WHERE sale_id=?');
  const substituted = db.prepare('SELECT count(*) AS n FROM sale_substitutions WHERE substitution_sale_id=? OR substituted_sale_id=?');
  const lineQuery = db.prepare('SELECT * FROM sale_lines WHERE sale_id=? ORDER BY line_no LIMIT 10001');
  const tenderQuery = db.prepare('SELECT * FROM tenders WHERE sale_id=? ORDER BY settled_at,rowid LIMIT 10001');
  const events = []; let paid = 0;
  for (const row of rows) {
    requireThat(Number.isSafeInteger(row.total));
    const settlements = settlement.get(row.id).n; requireThat(settlements <= 1);
    if (row.total <= 0 || settlements === 0) continue;
    paid++;
    const at = instant(row.issued_at);
    if (at < start || at >= end) continue;
    requireThat(voided.get(row.id).n === 0 && substituted.get(row.id,row.id).n === 0);
    const lines = lineQuery.all(row.id), tenders = tenderQuery.all(row.id);
    requireThat(lines.length <= 10000);
    requireThat(tenders.length <= 10000);
    events.push(translateBill(row,lines,tenders));
  }
  requireThat(events.length === expectedSales);
  return {counts:{source:rows.length,paid,selected:events.length},events};
}
