import { randomUUID } from 'node:crypto';
import { assertStorageClientBinding, classifyStorageOperation } from './meter.mjs';

const fail = () => { throw Error('Invalid cloud cost storage lifetimes'); };
const requireThat = value => { if (!value) fail(); };
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = s => typeof s === 'string' && s.length > 0;
const identity = (key, version) => JSON.stringify([key, version]);
const safeKey = key => text(key) && Buffer.byteLength(key) <= 1024 && !key.startsWith('/')
  && !/[\\\0]/.test(key) && !key.split('/').some(part => part === '.' || part === '..');

// Use exclusively owned, initially empty buckets. Provider IDs and keys stay in these private maps.
export async function openStorageLifetimes({ clients, sdk, meter, bucket, versioned, objectClass, allowBulkDeletes = false }) {
  const versions = new Map(), uploads = new Map();
  let busy = false, invalid = false, verified = false, endpoint;
  const poison = () => { invalid = true; meter.invalidate(); fail(); };
  const object = (row, action, bytes = 0) => meter.observeObject({ token: row.token, action, class: objectClass, bytes });
  const operation = async action => {
    try {
      requireThat(!invalid && !busy); busy = true;
      return await action();
    } catch { poison(); }
    finally { busy = false; }
  };
  try {
    requireThat(text(bucket) && typeof versioned === 'boolean' && typeof allowBulkDeletes === 'boolean'
      && ['stream', 'snapshot', 'daily-archive', 'monthly-archive', 'protected', 'scratch'].includes(objectClass));
    requireThat(['observer', 'workload', 'cleanup'].every(phase => typeof clients[phase]?.send === 'function'));
    const endpoints = ['observer', 'workload', 'cleanup'].map(phase => assertStorageClientBinding(clients[phase], meter, phase));
    requireThat(new Set(endpoints).size === 1); endpoint = endpoints[0];
    requireThat(['GetBucketVersioningCommand', 'ListObjectsV2Command', 'ListObjectVersionsCommand',
      'ListMultipartUploadsCommand', 'ListPartsCommand'].every(name => typeof sdk[name] === 'function'));
  } catch { poison(); }
  const rowsFor = key => [...versions.values()].filter(v => v.key === key);
  const retire = key => {
    for (const row of rowsFor(key)) if (row.latest) {
      if (!row.marker) object(row, 'noncurrent');
      row.latest = false;
    }
  };
  const newVersion = (key, versionId, bytes, marker = false, existing) => {
    requireThat(versioned ? text(versionId) && versionId !== 'null' : versionId === undefined || versionId === 'null');
    const id = identity(key, versioned ? versionId : null);
    requireThat(!versioned || !versions.has(id));
    if (versioned) retire(key);
    else if (versions.has(id)) { object(versions.get(id), 'delete'); versions.delete(id); }
    const row = { token: existing?.token ?? randomUUID(), key, versionId: versioned ? versionId : null, bytes, latest: true, marker };
    object(row, existing ? 'multipart-complete' : marker ? 'marker' : 'create', bytes);
    versions.set(id, row);
  };
  const bodySize = input => {
    requireThat(typeof input.Body === 'string' || input.Body instanceof Uint8Array);
    const bytes = Buffer.byteLength(input.Body);
    requireThat(input.ContentLength === undefined || input.ContentLength === bytes);
    return bytes;
  };
  const deleteVersion = (key, versionId) => {
    const id = identity(key, versioned ? versionId : null), row = versions.get(id);
    if (row) {
      object(row, 'delete'); versions.delete(id);
      if (row.latest && versioned) {
        const previous = rowsFor(key).at(-1);
        if (previous) { previous.latest = true; if (!previous.marker) object(previous, 'current'); }
      }
    }
  };
  const send = (command, { phase = 'workload' } = {}) => operation(async () => {
    requireThat(['workload', 'cleanup'].includes(phase));
    requireThat(assertStorageClientBinding(clients[phase], meter, phase) === endpoint);
    const name = command?.constructor?.name, input = command?.input;
    if (name === 'DeleteObjectsCommand') {
      requireThat(allowBulkDeletes && input?.Bucket === bucket && input.Key === undefined && input.VersionId === undefined);
      const selection = input.Delete;
      requireThat(selection && Object.keys(selection).every(k => ['Objects', 'Quiet'].includes(k))
        && (selection.Quiet === undefined || selection.Quiet === false)
        && Array.isArray(selection.Objects) && selection.Objects.length > 0 && selection.Objects.length <= 1000);
      const requested = new Map(), byKey = new Map();
      for (const item of selection.Objects) {
        requireThat(item && Object.keys(item).every(k => ['Key', 'VersionId'].includes(k))
          && safeKey(item.Key));
        requireThat(item.VersionId === undefined || versioned && versions.has(identity(item.Key, item.VersionId)));
        const id = identity(item.Key, item.VersionId);
        requireThat(!requested.has(id)); requested.set(id, { Key: item.Key, VersionId: item.VersionId });
        const prior = byKey.get(item.Key) ?? [];
        // A marker creation and version removal for one key have no defined order within a batch.
        requireThat(prior.length === 0 || item.VersionId !== undefined && prior.every(v => v !== undefined));
        prior.push(item.VersionId); byKey.set(item.Key, prior);
      }
      verified = false;
      const result = await clients[phase].send(command);
      requireThat(result.$metadata?.attempts === 1 && result.$metadata.httpStatusCode === 200);
      requireThat((result.Deleted === undefined || Array.isArray(result.Deleted)) && (result.Errors === undefined || Array.isArray(result.Errors)));
      const found = new Set(), changes = [];
      for (const [entries, failed] of [[result.Deleted ?? [], false], [result.Errors ?? [], true]]) for (const entry of entries) {
        let returnedVersion = entry.VersionId;
        // S3 may identify an explicitly removed marker only through DeleteMarkerVersionId.
        if (!failed && versioned && returnedVersion === undefined && entry.DeleteMarker === true
          && versions.get(identity(entry.Key, entry.DeleteMarkerVersionId))?.marker)
          returnedVersion = entry.DeleteMarkerVersionId;
        const id = identity(entry.Key, returnedVersion), item = requested.get(id);
        requireThat(item && !found.has(id)); found.add(id);
        if (failed) { requireThat(text(entry.Code)); continue; }
        if (versioned && item.VersionId === undefined) {
          requireThat(entry.DeleteMarker === true && text(entry.DeleteMarkerVersionId) && entry.DeleteMarkerVersionId !== 'null');
          changes.push(() => newVersion(item.Key, entry.DeleteMarkerVersionId, Buffer.byteLength(item.Key), true));
        } else {
          requireThat(versioned || entry.DeleteMarker !== true && entry.DeleteMarkerVersionId === undefined);
          if (versioned) {
            const stored = versions.get(identity(item.Key, item.VersionId));
            requireThat((entry.DeleteMarker === undefined || entry.DeleteMarker === stored.marker)
              && (entry.DeleteMarkerVersionId === undefined || entry.DeleteMarkerVersionId === item.VersionId));
          }
          changes.push(() => deleteVersion(item.Key, item.VersionId));
        }
      }
      // HTTP 200 can include object failures; every selection needs one explicit outcome.
      requireThat(found.size === requested.size);
      for (const change of changes) change();
      return result;
    }
    requireThat(input && input.Bucket === bucket && safeKey(input.Key));
    requireThat(['PutObjectCommand', 'DeleteObjectCommand', 'CreateMultipartUploadCommand', 'UploadPartCommand',
      'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand'].includes(name));
    let bytes = 0, upload, selected;
    if (name === 'PutObjectCommand' || name === 'UploadPartCommand') bytes = bodySize(input);
    if (name !== 'DeleteObjectCommand') requireThat(input.VersionId === undefined);
    if (['UploadPartCommand', 'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand'].includes(name)) {
      upload = uploads.get(identity(input.Key, input.UploadId)); requireThat(upload);
    }
    if (name === 'UploadPartCommand') requireThat(Number.isInteger(input.PartNumber) && input.PartNumber >= 1 && input.PartNumber <= 10000);
    if (name === 'CompleteMultipartUploadCommand') {
      selected = input.MultipartUpload?.Parts;
      requireThat(Array.isArray(selected) && selected.length > 0);
      let previous = 0;
      for (const part of selected) {
        const stored = upload.parts.get(part.PartNumber);
        requireThat(stored && part.PartNumber > previous && stored.etag === part.ETag);
        previous = part.PartNumber; bytes += stored.bytes;
      }
      requireThat(count(bytes));
    }
    if (name === 'DeleteObjectCommand' && input.VersionId !== undefined)
      requireThat(versioned && versions.has(identity(input.Key, input.VersionId)));
    verified = false;
    const result = await clients[phase].send(command);
    // A retry after a lost committed reply can create an extra version that a success result hides.
    requireThat(result.$metadata?.attempts === 1 && result.$metadata.httpStatusCode >= 200 && result.$metadata.httpStatusCode < 300);
    if (name === 'PutObjectCommand') newVersion(input.Key, result.VersionId, bytes);
    else if (name === 'CreateMultipartUploadCommand') {
      requireThat(text(result.UploadId) && !uploads.has(identity(input.Key, result.UploadId)));
      const row = { token: randomUUID(), key: input.Key, uploadId: result.UploadId, parts: new Map() };
      object(row, 'multipart-create'); uploads.set(identity(input.Key, result.UploadId), row);
    } else if (name === 'UploadPartCommand') {
      requireThat(text(result.ETag));
      upload.parts.set(input.PartNumber, { bytes, etag: result.ETag });
      object(upload, 'multipart-resize', [...upload.parts.values()].reduce((n, p) => n + p.bytes, 0));
    } else if (name === 'CompleteMultipartUploadCommand') {
      object(upload, 'multipart-resize', bytes);
      newVersion(input.Key, result.VersionId, bytes, false, upload);
      uploads.delete(identity(input.Key, input.UploadId));
    } else if (name === 'AbortMultipartUploadCommand') {
      object(upload, 'multipart-abort'); uploads.delete(identity(input.Key, input.UploadId));
    } else if (versioned && input.VersionId === undefined) {
      requireThat(result.DeleteMarker === true);
      // S3 bills delete-marker storage using the UTF-8 key length (AWS DeleteMarker guide).
      newVersion(input.Key, result.VersionId, Buffer.byteLength(input.Key), true);
    } else {
      const id = identity(input.Key, versioned ? input.VersionId : null), row = versions.get(id);
      if (row) {
        object(row, 'delete'); versions.delete(id);
        if (row.latest && versioned) {
          const previous = rowsFor(input.Key).at(-1);
          if (previous) { previous.latest = true; if (!previous.marker) object(previous, 'current'); }
        }
      }
    }
    return result;
  });
  const inspect = (name, input) => {
    requireThat(assertStorageClientBinding(clients.observer, meter, 'observer') === endpoint);
    return clients.observer.send(new sdk[name]({ Bucket: bucket, ...input }));
  };
  const pages = async (name, key, markerNames, input = {}) => {
    const rows = [], seen = new Set(); let markers = {};
    for (let n = 0; n < 1000; n++) {
      const page = await inspect(name, { ...input, ...markers });
      requireThat(page.IsTruncated === true || page.IsTruncated === false);
      for (const field of key) { requireThat(page[field] === undefined || Array.isArray(page[field])); rows.push(...(page[field] ?? []).map(row => ({ ...row, kind: field }))); }
      if (!page.IsTruncated) return rows;
      markers = Object.fromEntries(markerNames.map(([request, response]) => [request, page[response]]));
      requireThat(Object.values(markers).some(text));
      const id = JSON.stringify(markers); requireThat(!seen.has(id)); seen.add(id);
    }
    fail();
  };
  const verify = () => operation(async () => {
    verified = false;
    const configuration = await inspect('GetBucketVersioningCommand', {});
    requireThat(versioned ? configuration.Status === 'Enabled' : configuration.Status === undefined);
    const observed = versioned
      ? await pages('ListObjectVersionsCommand', ['Versions', 'DeleteMarkers'], [['KeyMarker', 'NextKeyMarker'], ['VersionIdMarker', 'NextVersionIdMarker']])
      : await pages('ListObjectsV2Command', ['Contents'], [['ContinuationToken', 'NextContinuationToken']]);
    const found = new Set();
    for (const entry of observed) {
      requireThat(text(entry.Key) && (!versioned || text(entry.VersionId)));
      const id = identity(entry.Key, versioned ? entry.VersionId : null), row = versions.get(id);
      requireThat(row && !found.has(id)); found.add(id);
      requireThat(versioned ? entry.IsLatest === row.latest : row.latest);
      requireThat((entry.kind === 'DeleteMarkers') === row.marker);
      if (!row.marker) requireThat(count(entry.Size) && entry.Size === row.bytes);
    }
    requireThat(found.size === versions.size);
    const observedUploads = await pages('ListMultipartUploadsCommand', ['Uploads'], [['KeyMarker', 'NextKeyMarker'], ['UploadIdMarker', 'NextUploadIdMarker']]);
    const foundUploads = new Set();
    for (const entry of observedUploads) {
      requireThat(text(entry.Key) && text(entry.UploadId));
      const id = identity(entry.Key, entry.UploadId), row = uploads.get(id);
      requireThat(row && !foundUploads.has(id)); foundUploads.add(id);
      const parts = await pages('ListPartsCommand', ['Parts'], [['PartNumberMarker', 'NextPartNumberMarker']], { Key: entry.Key, UploadId: entry.UploadId });
      const foundParts = new Set();
      for (const part of parts) {
        const stored = row.parts.get(part.PartNumber);
        requireThat(stored && !foundParts.has(part.PartNumber) && stored.bytes === part.Size && stored.etag === part.ETag);
        foundParts.add(part.PartNumber);
      }
      requireThat(foundParts.size === row.parts.size);
    }
    requireThat(foundUploads.size === uploads.size);
    verified = true;
  });
  await verify();
  return { send, verify, snapshot: () => {
    // A stale checkpoint is recoverable by verification; an ambiguous mutation permanently poisons evidence.
    requireThat(!invalid && !busy && verified);
    return meter.snapshot();
  } };
}

// Owned, initially empty unversioned buckets only. No deletion or size-changing replacement is admitted.
// A failed reply can follow a commit; bound its first possible write until an independent inventory.
export async function openLitestreamLifetimes({ client, sdk, meter, bucket, clock }) {
  const rows = new Map(), pending = new Set();
  let invalid = false, verifying = false, verified = false, last = -Infinity, endpoint;
  const poison = () => { invalid = true; meter?.invalidate(); fail(); };
  const guarded = fn => (...args) => {
    try { requireThat(!invalid); return fn(...args); } catch { poison(); }
  };
  const now = () => {
    const time = clock(); requireThat(Number.isFinite(time) && time >= 0 && time >= last);
    last = time; return time;
  };
  let start;
  try {
    requireThat(typeof clock === 'function' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
      && typeof meter?.invalidate === 'function');
    endpoint = assertStorageClientBinding(client, meter, 'observer');
    requireThat(['GetBucketVersioningCommand', 'ListObjectsV2Command', 'ListMultipartUploadsCommand']
      .every(name => typeof sdk[name] === 'function'));
    start = now();
  } catch { poison(); }
  const inspect = async (name, input = {}) => {
    requireThat(assertStorageClientBinding(client, meter, 'observer') === endpoint);
    const result = await client.send(new sdk[name]({ Bucket: bucket, ...input }));
    requireThat(result.$metadata?.httpStatusCode === 200 && result.$metadata.attempts === 1);
    return result;
  };
  const begin = guarded(({ method, path, headers }) => {
    requireThat(!verifying && pending.size < 100000);
    const operation = classifyStorageOperation({ method, path });
    requireThat(['put', 'get', 'head', 'list'].includes(operation));
    const rawPath = path.split('?')[0], segments = rawPath.slice(1).split('/');
    requireThat(segments[0] === bucket && !/%2f|%5c/i.test(rawPath));
    const key = decodeURIComponent(segments.slice(1).join('/'));
    requireThat(!key.split('/').some(segment => segment === '.' || segment === '..'));
    let row, bytes;
    if (operation === 'put') {
      requireThat(key.length > 0 && Buffer.byteLength(key) <= 1024
        && !Object.hasOwn(headers, 'x-amz-copy-source') && !Object.hasOwn(headers, 'content-encoding')
        && /^(0|[1-9]\d*)$/.test(headers['content-length']));
      bytes = Number(headers['content-length']); requireThat(count(bytes));
      row = rows.get(key);
      requireThat(!row || row.bytes === bytes && !row.pending);
      const time = now();
      if (!row) { requireThat(rows.size < 100000); row = { bytes, from: time, by: null }; rows.set(key, row); }
      row.pending = true; verified = false;
    } else now();
    const token = {}; pending.add(token);
    return guarded(({ statusCode, bytesOut, interrupted = false }) => {
      requireThat(pending.has(token) && !interrupted && Number.isInteger(statusCode) && statusCode >= 200 && statusCode <= 599);
      const time = now();
      if (row) {
        requireThat(bytesOut === bytes);
        if (statusCode < 300) row.by ??= time;
        row.pending = false;
      }
      pending.delete(token);
    });
  });
  const verify = async () => {
    try {
      requireThat(!invalid && !verifying && pending.size === 0); verifying = true; verified = false; now();
      const versioning = await inspect('GetBucketVersioningCommand');
      requireThat(versioning.Status === undefined);
      const found = new Set(), tokens = new Set(); let continuation;
      for (let pageNumber = 0; ; pageNumber++) {
        requireThat(pageNumber < 1000);
        const page = await inspect('ListObjectsV2Command', continuation ? { ContinuationToken: continuation } : {});
        requireThat(typeof page.IsTruncated === 'boolean' && (page.Contents === undefined || Array.isArray(page.Contents)));
        for (const entry of page.Contents ?? []) {
          const row = rows.get(entry.Key);
          requireThat(row && !found.has(entry.Key) && count(entry.Size) && row.bytes === entry.Size);
          found.add(entry.Key);
        }
        if (!page.IsTruncated) break;
        continuation = page.NextContinuationToken;
        requireThat(text(continuation) && !tokens.has(continuation)); tokens.add(continuation);
      }
      const uploads = await inspect('ListMultipartUploadsCommand');
      requireThat(uploads.IsTruncated === false && (uploads.Uploads === undefined || Array.isArray(uploads.Uploads) && uploads.Uploads.length === 0));
      const time = now();
      for (const [key, row] of rows) {
        if (found.has(key)) row.by ??= time;
        else { requireThat(row.by === null); rows.delete(key); }
      }
      verified = true;
    } catch { poison(); }
    finally { verifying = false; }
  };
  const snapshot = () => {
    requireThat(!invalid && !verifying && verified && pending.size === 0);
    return guarded(() => {
      const time = now(); let bytes = 0, low = 0, high = 0;
      for (const row of rows.values()) {
        requireThat(row.by !== null); bytes += row.bytes;
        low += row.bytes * (time - row.by); high += row.bytes * (time - row.from);
      }
      requireThat(count(bytes) && Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low);
      return { status: 'measured', scope: 'unversioned-put-only', windowSeconds: time - start,
        objects: { class: 'stream', bytes, currentVersions: rows.size, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
        byteSeconds: { low, high } };
    })();
  };
  await verify();
  return { begin, verify, snapshot };
}

// Owned, initially empty unversioned buckets only. Commit times are bounded by request and reply;
// an ambiguous reply stays unresolved until inventory or an identical successful retry bounds it.
export async function openLitestreamHistories({ client, sdk, meter, bucket, clock }) {
  const rows = new Map(), pending = new Set();
  let invalid = false, verifying = false, verified = false, last = -Infinity, endpoint, start;
  let retiredLow = 0, retiredHigh = 0;
  const poison = () => { invalid = true; meter?.invalidate(); fail(); };
  const guarded = fn => (...args) => {
    try { requireThat(!invalid); return fn(...args); } catch { poison(); }
  };
  const now = () => {
    const time = clock(); requireThat(Number.isFinite(time) && time >= 0 && time >= last);
    last = time; return time;
  };
  try {
    requireThat(typeof clock === 'function' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
      && typeof meter?.invalidate === 'function');
    endpoint = assertStorageClientBinding(client, meter, 'observer');
    requireThat(['GetBucketVersioningCommand', 'ListObjectsV2Command', 'ListMultipartUploadsCommand']
      .every(name => typeof sdk[name] === 'function'));
    start = now();
  } catch { poison(); }
  const inspect = async (name, input = {}) => {
    requireThat(assertStorageClientBinding(client, meter, 'observer') === endpoint);
    const result = await client.send(new sdk[name]({ Bucket: bucket, ...input }));
    requireThat(result.$metadata?.httpStatusCode === 200 && result.$metadata.attempts === 1);
    return result;
  };
  const transition = (row, mutation, by) => {
    if (row.current && !(mutation.method === 'PUT' && row.current.bytes === mutation.bytes)) {
      retiredLow += row.current.bytes * Math.max(0, mutation.from - row.current.by);
      retiredHigh += row.current.bytes * (by - row.current.from);
      row.current = null;
    }
    if (mutation.method === 'PUT' && !row.current) row.current = { bytes: mutation.bytes, from: mutation.from, by };
    row.uncertain = null;
  };
  const begin = guarded(({ method, path, headers }) => {
    requireThat(!verifying && pending.size < 100000);
    const operation = classifyStorageOperation({ method, path });
    requireThat(['put', 'delete', 'get', 'head', 'list'].includes(operation));
    const rawPath = path.split('?')[0], segments = rawPath.slice(1).split('/');
    requireThat(segments[0] === bucket && !/%2f|%5c/i.test(rawPath));
    const key = decodeURIComponent(segments.slice(1).join('/'));
    requireThat(!key.includes('\0') && !key.split('/').some(s => s === '.' || s === '..'));
    const url = new URL(path, 'http://local');
    requireThat(!url.searchParams.has('versionId'));
    const time = now();
    let row, mutation;
    if (operation === 'put' || operation === 'delete') {
      // The classifier validates SDK operation hints; version-specific mutations are refused above.
      requireThat(key.length > 0 && Buffer.byteLength(key) <= 1024
        && headers && !Object.hasOwn(headers, 'x-amz-copy-source') && !Object.hasOwn(headers, 'content-encoding'));
      requireThat(operation === 'put' ? /^(0|[1-9]\d*)$/.test(headers['content-length'])
        : headers['content-length'] === undefined || headers['content-length'] === '0');
      const bytes = operation === 'put' ? Number(headers['content-length']) : 0;
      requireThat(count(bytes));
      row = rows.get(key);
      if (!row) { requireThat(rows.size < 100000); row = { current: null, uncertain: null, active: false }; rows.set(key, row); }
      requireThat(!row.active && (!row.uncertain || row.uncertain.method === method && row.uncertain.bytes === bytes));
      mutation = { method, bytes, from: row.uncertain?.from ?? time };
      row.active = true; verified = false;
    }
    const token = {}; pending.add(token);
    return guarded(({ statusCode, bytesOut, interrupted = false }) => {
      requireThat(pending.has(token) && !interrupted && Number.isInteger(statusCode) && statusCode >= 200 && statusCode <= 599);
      const time = now();
      if (mutation) {
        requireThat(bytesOut === mutation.bytes);
        if (statusCode < 300) transition(row, mutation, time);
        else if (mutation.method === 'PUT' ? row.current?.bytes !== mutation.bytes : row.current !== null) row.uncertain = mutation;
        row.active = false;
      }
      pending.delete(token);
    });
  });
  const verify = async () => {
    try {
      requireThat(!invalid && !verifying && pending.size === 0); verifying = true; verified = false; now();
      requireThat((await inspect('GetBucketVersioningCommand')).Status === undefined);
      const found = new Map(), tokens = new Set(); let continuation;
      for (let n = 0; ; n++) {
        requireThat(n < 1000);
        const page = await inspect('ListObjectsV2Command', continuation ? { ContinuationToken: continuation } : {});
        requireThat(typeof page.IsTruncated === 'boolean' && (page.Contents === undefined || Array.isArray(page.Contents)));
        for (const entry of page.Contents ?? []) {
          requireThat(rows.has(entry.Key) && !found.has(entry.Key) && count(entry.Size));
          found.set(entry.Key, entry.Size);
        }
        if (!page.IsTruncated) break;
        continuation = page.NextContinuationToken;
        requireThat(text(continuation) && !tokens.has(continuation)); tokens.add(continuation);
      }
      const uploads = await inspect('ListMultipartUploadsCommand');
      requireThat(uploads.IsTruncated === false && (uploads.Uploads === undefined || Array.isArray(uploads.Uploads) && uploads.Uploads.length === 0));
      const time = now();
      for (const [key, row] of rows) {
        const bytes = found.get(key), uncertain = row.uncertain;
        if (uncertain) {
          if (uncertain.method === 'PUT' ? bytes === uncertain.bytes : bytes === undefined) transition(row, uncertain, time);
          else {
            requireThat(row.current ? bytes === row.current.bytes : bytes === undefined);
            row.uncertain = null;
          }
        }
        requireThat(row.current ? bytes === row.current.bytes : bytes === undefined);
      }
      verified = true;
    } catch { poison(); }
    finally { verifying = false; }
  };
  const snapshot = () => {
    requireThat(!invalid && !verifying && verified && pending.size === 0);
    return guarded(() => {
      const time = now(); let bytes = 0, objects = 0, low = retiredLow, high = retiredHigh;
      for (const row of rows.values()) if (row.current) {
        requireThat(!row.uncertain && !row.active);
        bytes += row.current.bytes; objects++;
        low += row.current.bytes * (time - row.current.by); high += row.current.bytes * (time - row.current.from);
      }
      requireThat(count(bytes) && Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low);
      return { status: 'measured', scope: 'unversioned-object-history', windowSeconds: time - start,
        objects: { class: 'stream', bytes, currentVersions: objects, noncurrentVersions: 0, deleteMarkers: 0, unfinishedMultipart: 0 },
        byteSeconds: { low, high } };
    })();
  };
  await verify();
  return { begin, verify, snapshot };
}
