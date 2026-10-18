import { randomUUID } from 'node:crypto';
import { assertStorageClientBinding } from './meter.mjs';

const fail = () => { throw Error('Invalid cloud cost storage lifetimes'); };
const requireThat = value => { if (!value) fail(); };
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = s => typeof s === 'string' && s.length > 0;
const identity = (key, version) => JSON.stringify([key, version]);

// Use exclusively owned, initially empty buckets. Provider IDs and keys stay in these private maps.
export async function openStorageLifetimes({ clients, sdk, meter, bucket, versioned, objectClass }) {
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
    requireThat(text(bucket) && typeof versioned === 'boolean'
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
  const send = (command, { phase = 'workload' } = {}) => operation(async () => {
    requireThat(['workload', 'cleanup'].includes(phase));
    requireThat(assertStorageClientBinding(clients[phase], meter, phase) === endpoint);
    const name = command?.constructor?.name, input = command?.input;
    requireThat(input && input.Bucket === bucket && text(input.Key) && Buffer.byteLength(input.Key) <= 1024);
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
