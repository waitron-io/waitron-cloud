import { deletionXml, deletionFields } from './s3-deletion.mjs';
import { assertStorageClientBinding, classifyStorageOperation } from './meter.mjs';

const fail = () => { throw Error('Invalid cloud cost storage lifetimes'); };
const need = value => { if (!value) fail(); };
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = s => typeof s === 'string' && s.length > 0 && s.length <= 1024 && !/[\x00-\x1f\x7f]/.test(s);
const identity = (key, version) => JSON.stringify([key, version]);

// Versioning retains a failed write's possible extra version until an independent inventory resolves it.
// Payloads and provider identities stay private; only counts and conservative storage bounds are returned.
export async function openLitestreamVersionHistories({ client, sdk, meter, bucket, clock, allowBulkDeletes = false }) {
  const rows = new Map(), unresolved = [], pending = new Set(), activeKeys = new Set();
  let invalid = false, verifying = false, verified = false, last = -Infinity, sequence = 0, endpoint, start;
  let retiredLow = 0, retiredHigh = 0;
  const poison = () => { invalid = true; try { meter?.invalidate?.(); } finally { fail(); } };
  const guarded = fn => (...args) => { try { need(!invalid); return fn(...args); } catch { poison(); } };
  const now = () => {
    const time = clock(); need(Number.isFinite(time) && time >= 0 && time >= last); last = time; return time;
  };
  try {
    need(typeof clock === 'function' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) && typeof meter?.invalidate === 'function');
    endpoint = assertStorageClientBinding(client, meter, 'observer');
    need(['GetBucketVersioningCommand', 'ListObjectVersionsCommand', 'ListMultipartUploadsCommand'].every(name => typeof sdk[name] === 'function'));
    start = now();
  } catch { poison(); }
  const inspect = async (name, input = {}) => {
    need(assertStorageClientBinding(client, meter, 'observer') === endpoint);
    const result = await client.send(new sdk[name]({ Bucket: bucket, ...input }));
    need(result.$metadata?.httpStatusCode === 200 && result.$metadata.attempts === 1); return result;
  };
  const retire = (row, by) => {
    if (row.deleted) return;
    retiredLow += row.bytes * Math.max(0, row.removing - row.by);
    retiredHigh += row.bytes * (by - row.from);
    row.deleted = true; row.removing = null;
  };
  const beginBatch = ({ headers, body }) => {
    need(allowBulkDeletes === true && headers && !Object.hasOwn(headers, 'content-encoding')
      && !Object.hasOwn(headers, 'x-amz-copy-source') && Buffer.isBuffer(body)
      && String(body.length) === headers['content-length']);
    const entries = deletionXml(body, 'Delete'), selected = new Map(), time = now();
    for (const entry of entries) {
      if (entry.name === 'Quiet') { need(entry.children.length === 0 && entry.value === 'false' && !selected.has(null)); selected.set(null, null); continue; }
      need(entry.name === 'Object'); const fields = deletionFields(entry, ['Key', 'VersionId']);
      const key = fields.Key, version = fields.VersionId ?? null;
      need(text(key) && Buffer.byteLength(key) <= 1024 && !/[\\\x00]/.test(key) && !key.split('/').some(s => s === '.' || s === '..')
        && !selected.has(key) && !activeKeys.has(key));
      const row = version === null ? null : rows.get(identity(key, version));
      need(version === null || text(version) && version !== 'null' && row && !row.deleted);
      selected.set(key, { key, version, row, marker: true, bytes: version === null ? Buffer.byteLength(key) : 0,
        from: time, order: ++sequence });
    }
    selected.delete(null); need(selected.size > 0 && selected.size <= 1000 && sequence <= 100000);
    for (const mutation of selected.values()) { activeKeys.add(mutation.key); if (mutation.row) mutation.row.removing ??= time; }
    verified = false;
    const token = {}; pending.add(token);
    return guarded(({ statusCode, bytesOut, interrupted = false, responseBody }) => {
      need(pending.has(token) && !interrupted && Number.isInteger(statusCode) && statusCode >= 200 && statusCode <= 599 && bytesOut === body.length);
      const time = now(), results = new Map();
      if (statusCode < 300) {
        need(statusCode === 200);
        for (const entry of deletionXml(responseBody, 'DeleteResult')) {
          need(entry.name === 'Deleted' || entry.name === 'Error');
          const fields = deletionFields(entry, entry.name === 'Error' ? ['Key', 'VersionId', 'Code', 'Message']
            : ['Key', 'VersionId', 'DeleteMarker', 'DeleteMarkerVersionId']);
          const mutation = selected.get(fields.Key);
          need(mutation && !results.has(fields.Key));
          if (entry.name === 'Error') need(text(fields.Code) && (fields.VersionId ?? null) === mutation.version);
          else if (mutation.row) {
            need((fields.VersionId === mutation.version || mutation.row.marker && fields.VersionId === undefined && fields.DeleteMarkerVersionId === mutation.version)
              && (fields.DeleteMarker === undefined || fields.DeleteMarker === String(mutation.row.marker))
              && (fields.DeleteMarkerVersionId === undefined || mutation.row.marker && fields.DeleteMarkerVersionId === mutation.version));
          } else need(fields.VersionId === undefined && fields.DeleteMarker === 'true' && text(fields.DeleteMarkerVersionId)
            && fields.DeleteMarkerVersionId !== 'null' && !rows.has(identity(mutation.key, fields.DeleteMarkerVersionId)));
          results.set(fields.Key, { fields, failed: entry.name === 'Error' });
        }
        need(results.size === selected.size);
      }
      for (const mutation of selected.values()) {
        const result = results.get(mutation.key);
        if (!result || result.failed) { if (!mutation.row) unresolved.push(mutation); }
        else if (mutation.row) retire(mutation.row, time);
        else {
          need(rows.size < 100000);
          const version = result.fields.DeleteMarkerVersionId;
          rows.set(identity(mutation.key, version), { ...mutation, version, by: time, orders: [mutation.order],
            latest: false, deleted: false, removing: null });
        }
        activeKeys.delete(mutation.key);
      }
      pending.delete(token);
    });
  };
  const begin = guarded(({ method, path, headers, body }) => {
    need(!verifying && pending.size < 100000 && sequence < 100000);
    const operation = classifyStorageOperation({ method, path, allowBulkDeletes });
    if (operation === 'delete-many') {
      need(path.split('?')[0].replace(/\/$/, '') === '/' + bucket);
      return beginBatch({ headers, body });
    }
    need(['put', 'delete', 'get', 'head', 'list'].includes(operation));
    const raw = path.split('?')[0], segments = raw.slice(1).split('/');
    need(segments[0] === bucket && !/%2f|%5c/i.test(raw));
    const key = decodeURIComponent(segments.slice(1).join('/'));
    need(!/[\\\x00]/.test(key) && !key.split('/').some(s => s === '.' || s === '..'));
    const query = new URL(path, 'http://local').searchParams, version = query.get('versionId');
    const time = now(); let mutation;
    if (operation === 'put' || operation === 'delete') {
      need(!activeKeys.has(key)); activeKeys.add(key);
      need(key.length > 0 && Buffer.byteLength(key) <= 1024 && headers
        && !Object.hasOwn(headers, 'x-amz-copy-source') && !Object.hasOwn(headers, 'content-encoding'));
      need(operation === 'put' ? version === null && /^(0|[1-9]\d*)$/.test(headers['content-length'])
        : headers['content-length'] === undefined || headers['content-length'] === '0');
      const bytes = operation === 'put' ? Number(headers['content-length']) : version === null ? Buffer.byteLength(key) : 0;
      need(count(bytes));
      const row = version === null ? null : rows.get(identity(key, version));
      need(version === null || operation === 'delete' && row);
      mutation = { key, bytes, marker: operation === 'delete', row, from: time, order: ++sequence };
      if (row && !row.deleted) row.removing ??= time;
      verified = false;
    }
    const token = {}; pending.add(token);
    return guarded(({ statusCode, bytesOut, interrupted = false, responseHeaders }) => {
      need(pending.has(token) && !interrupted && Number.isInteger(statusCode) && statusCode >= 200 && statusCode <= 599);
      const time = now();
      if (mutation) {
        need(bytesOut === (operation === 'put' ? mutation.bytes : 0));
        if (statusCode < 300) {
          need(responseHeaders && typeof responseHeaders === 'object');
          const returned = responseHeaders['x-amz-version-id'], marker = responseHeaders['x-amz-delete-marker'];
          if (mutation.row) {
            need((returned === undefined || returned === version) && (marker === undefined || marker === String(mutation.row.marker)));
            retire(mutation.row, time);
          } else {
            need(text(returned) && returned !== 'null' && !rows.has(identity(key, returned))
              && (mutation.marker ? marker === 'true' : marker === undefined || marker === 'false'));
            need(rows.size < 100000);
            rows.set(identity(key, returned), { key, version: returned, bytes: mutation.bytes, marker: mutation.marker,
              from: mutation.from, by: time, orders: [mutation.order], latest: false, deleted: false, removing: null });
          }
        } else if (!mutation.row) unresolved.push(mutation);
        activeKeys.delete(key);
      }
      pending.delete(token);
    });
  });
  const verify = async () => {
    try {
      need(!invalid && !verifying && pending.size === 0); verifying = true; verified = false; now();
      need((await inspect('GetBucketVersioningCommand')).Status === 'Enabled');
      const found = new Map(), tokens = new Set(); let markers = {};
      for (let n = 0; ; n++) {
        need(n < 1000);
        const page = await inspect('ListObjectVersionsCommand', markers);
        need(typeof page.IsTruncated === 'boolean');
        for (const [field, marker] of [['Versions', false], ['DeleteMarkers', true]]) {
          need(page[field] === undefined || Array.isArray(page[field]));
          for (const entry of page[field] ?? []) {
            need(text(entry.Key) && text(entry.VersionId) && entry.VersionId !== 'null' && typeof entry.IsLatest === 'boolean');
            const id = identity(entry.Key, entry.VersionId), bytes = marker ? Buffer.byteLength(entry.Key) : entry.Size;
            need(!found.has(id) && found.size < 100000 && count(bytes));
            found.set(id, { key: entry.Key, version: entry.VersionId, bytes, marker, latest: entry.IsLatest });
          }
        }
        if (!page.IsTruncated) break;
        need(text(page.NextKeyMarker) && text(page.NextVersionIdMarker));
        markers = { KeyMarker: page.NextKeyMarker, VersionIdMarker: page.NextVersionIdMarker };
        const id = JSON.stringify(markers); need(!tokens.has(id)); tokens.add(id);
      }
      const uploads = await inspect('ListMultipartUploadsCommand');
      need(uploads.IsTruncated === false && (uploads.Uploads === undefined || Array.isArray(uploads.Uploads) && uploads.Uploads.length === 0));
      const time = now(), groups = new Map(), used = new Map(), orders = new Map();
      const group = row => JSON.stringify([row.key, row.bytes, row.marker]);
      for (const mutation of unresolved) {
        const id = group(mutation); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(mutation);
      }
      for (const [id, candidates] of groups) orders.set(id, candidates.map(c => c.order));
      for (const [id, observed] of found) {
        let row = rows.get(id);
        if (!row) {
          const g = group(observed), candidates = groups.get(g), selected = (used.get(g) ?? 0) + 1;
          need(candidates && selected <= candidates.length && rows.size < 100000); used.set(g, selected);
          row = { ...observed, from: candidates[0].from, by: time,
            orders: orders.get(g), deleted: false, removing: null };
          rows.set(id, row);
        }
        need(!row.deleted && row.bytes === observed.bytes && row.marker === observed.marker);
        row.latest = observed.latest;
      }
      const byKey = new Map();
      for (const [id, row] of rows) {
        if (row.deleted) { need(!found.has(id)); continue; }
        if (!found.has(id)) { need(row.removing !== null); retire(row, time); continue; }
        row.removing = null;
        if (!byKey.has(row.key)) byKey.set(row.key, []); byKey.get(row.key).push(row);
      }
      for (const versions of byKey.values()) {
        const latest = versions.filter(r => r.latest); need(latest.length === 1);
        const latestOrder = latest[0].orders.at(-1), assignments = new Map();
        for (const row of versions) if (row !== latest[0]) assignments.set(row.orders, (assignments.get(row.orders) ?? 0) + 1);
        // Each still-retained version needs a distinct earlier request, including versions with lost replies.
        for (const [candidates, required] of assignments) need(candidates.filter(order => order < latestOrder).length >= required);
      }
      unresolved.length = 0; verified = true;
    } catch { poison(); }
    finally { verifying = false; }
  };
  const snapshot = () => {
    need(!invalid && !verifying && verified && pending.size === 0);
    return guarded(() => {
      const time = now(), objects = { class: 'stream', bytes: 0, currentVersions: 0, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 };
      let low = retiredLow, high = retiredHigh;
      for (const row of rows.values()) if (!row.deleted) {
        need(row.removing === null); objects.bytes += row.bytes;
        objects[row.marker ? 'deleteMarkers' : row.latest ? 'currentVersions' : 'noncurrentVersions']++;
        low += row.bytes * (time - row.by); high += row.bytes * (time - row.from);
      }
      need(count(objects.bytes) && Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low);
      return { status: 'measured', scope: 'versioned-object-history', windowSeconds: time - start, objects, byteSeconds: { low, high } };
    })();
  };
  await verify(); return { begin, verify, snapshot };
}
