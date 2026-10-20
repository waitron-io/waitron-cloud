const fail = () => { throw new Error('Invalid cloud cost local run'); };
const requireThat = value => { if (!value) fail(); };
function exact(value, keys) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype);
  const actual = Reflect.ownKeys(value);
  requireThat(actual.length === keys.length && actual.every(key => keys.includes(key)
    && Object.getOwnPropertyDescriptor(value, key).get === undefined));
}
function instant(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
  const date = new Date(value);
  requireThat(Number.isFinite(date.getTime()) && date.toISOString() === value);
  return date;
}

// Calendar functions come from the pinned Waitron runtime; dates and bounds stay private.
export function discoverReplayDay(db, { locationId, clock, calendar, expected }) {
  const keys = ['sales', 'paid', 'tradingDays', 'busiest'];
  exact(expected, keys);
  for (const key of keys) requireThat(Number.isSafeInteger(expected[key]) && expected[key] >= 0 && expected[key] <= 100000);
  exact(calendar, ['businessDayAt', 'businessDayBounds']);
  requireThat(typeof calendar.businessDayAt === 'function' && typeof calendar.businessDayBounds === 'function');
  const rows = db.prepare(`SELECT s.id,s.issued_at,s.total FROM sales s JOIN nodes n ON n.id=s.node_id
    WHERE n.location_id=? ORDER BY s.issued_at,s.rowid LIMIT 100001`).all(locationId);
  requireThat(rows.length <= 100000);
  const settlement = db.prepare('SELECT count(*) AS n FROM sale_settlements WHERE sale_id=?');
  const days = new Map(); let paid = 0;
  for (const row of rows) {
    const at = instant(row.issued_at);
    requireThat(Number.isSafeInteger(row.total));
    const settlements = settlement.get(row.id).n; requireThat(settlements <= 1);
    if (row.total <= 0 || settlements === 0) continue;
    const day = calendar.businessDayAt(clock, at);
    requireThat(typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
      && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day);
    if (!days.has(day)) {
      const bounds = calendar.businessDayBounds(clock, day);
      exact(bounds, ['startAt', 'endAt']);
      requireThat(instant(bounds.endAt) > instant(bounds.startAt));
      days.set(day, { bounds: { ...bounds }, count: 0 });
    }
    const group = days.get(day), time = at.toISOString();
    requireThat(group.bounds.startAt <= time && time < group.bounds.endAt);
    group.count++; paid++;
  }
  let best;
  for (const [day, group] of days) if (!best || group.count > best.count || (group.count === best.count && day < best.day))
    best = { day, ...group };
  const counts = { sales: rows.length, paid, tradingDays: days.size, busiest: best?.count ?? 0 };
  const discrepancies = Object.fromEntries(keys.map(key => [key, counts[key] - expected[key]]));
  const reconciled = keys.every(key => discrepancies[key] === 0);
  return { counts, discrepancies, selection: reconciled && best
    ? { day: best.day, bounds: best.bounds, expectedSales: best.count } : null };
}
