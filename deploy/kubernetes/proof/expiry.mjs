const ACCOUNT = '462991287391';
const REGION = 'eu-south-2';
const RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return NaN;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) return NaN;
  return millis;
}

function ownership(resource, stackId, kind) {
  if (!Array.isArray(resource?.Tags)) throw new Error('Invalid resource inventory');
  const entries = resource.Tags.map(tag => [tag.Key, tag.Value]);
  const tags = Object.fromEntries(entries);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Ambiguous ownership tags');
  if (tags.Proof !== 'D570' || tags.Stack !== stackId) return null;
  if (!RUN.test(tags.Run)) throw new Error('Invalid run ownership');
  const id = resource[kind === 'instance' ? 'InstanceId' : 'VolumeId'];
  if (!(kind === 'instance' ? /^i-[0-9a-f]{17}$/ : /^vol-[0-9a-f]{17}$/).test(id)) throw new Error('Invalid resource identity');
  if (kind === 'instance' && !['pending', 'running', 'stopping', 'stopped', 'shutting-down', 'terminated'].includes(resource.State?.Name)) throw new Error('Invalid instance inventory');
  if (kind === 'volume' && (!Array.isArray(resource.Attachments) || !['creating', 'available', 'in-use', 'deleting', 'deleted', 'error'].includes(resource.State))) throw new Error('Invalid volume inventory');
  return { id, expiry: timestamp(tags.ExpiresAt) };
}

async function inventory(aws, operation, stackId) {
  const resources = [], tokens = new Set(), ids = new Set();
  let next;
  for (let page = 0; page < 20; page++) {
    const result = await aws.call('ec2', operation, {
      Filters: [{ Name: 'tag:Proof', Values: ['D570'] }, { Name: 'tag:Stack', Values: [stackId] }],
      MaxResults: 100, ...(next ? { NextToken: next } : {}),
    });
    let rows;
    if (operation === 'DescribeInstances') {
      if (!Array.isArray(result?.Reservations) || result.Reservations.some(row => !Array.isArray(row.Instances))) throw new Error('Invalid instance inventory');
      rows = result.Reservations.flatMap(row => row.Instances);
    } else rows = result?.Volumes;
    if (!Array.isArray(rows) || rows.length > 100) throw new Error('Invalid resource inventory');
    for (const row of rows) {
      const id = row?.InstanceId ?? row?.VolumeId;
      if (typeof id !== 'string' || ids.has(id)) throw new Error('Duplicate or invalid inventory identity');
      ids.add(id);
      resources.push(row);
    }
    next = result.NextToken;
    if (next === undefined) return resources;
    if (typeof next !== 'string' || !next || next.length > 4096 || tokens.has(next)) throw new Error('Invalid inventory pagination');
    tokens.add(next);
  }
  throw new Error('Inventory pagination limit exceeded');
}

// A heartbeat means this bounded sweep completed, not that EC2 finished cleanup.
export async function sweepExpired({ aws, account, region, stackId, bucket, now = Date.now }) {
  if (account !== ACCOUNT || region !== REGION || typeof stackId !== 'string'
    || !/^arn:aws:cloudformation:eu-south-2:462991287391:stack\/[A-Za-z][A-Za-z0-9-]*\/[0-9a-f-]{36}$/.test(stackId)
    || typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid expiry scope');
  const started = now();
  if (!Number.isSafeInteger(started) || started <= 0 || !Number.isFinite(new Date(started).getTime())) throw new Error('Invalid expiry clock');
  const instances = await inventory(aws, 'DescribeInstances', stackId);
  const volumes = await inventory(aws, 'DescribeVolumes', stackId);
  // Validate the entire snapshot before the first destructive request.
  const ownedInstances = instances.map(resource => ({ resource, owned: ownership(resource, stackId, 'instance') }));
  const ownedVolumes = volumes.map(resource => ({ resource, owned: ownership(resource, stackId, 'volume') }));
  const terminationRequested = [], volumeDeletionRequested = [];
  for (const { resource, owned } of ownedInstances) {
    if (!owned || resource.State.Name === 'terminated' || owned.expiry > started) continue;
    const result = await aws.call('ec2', 'TerminateInstances', { InstanceIds: [owned.id] });
    if (!Array.isArray(result?.TerminatingInstances) || result.TerminatingInstances.length !== 1
      || result.TerminatingInstances[0].InstanceId !== owned.id
      || !['shutting-down', 'terminated'].includes(result.TerminatingInstances[0].CurrentState?.Name)) throw new Error('Unconfirmed termination request');
    terminationRequested.push(owned.id);
  }
  for (const { resource, owned } of ownedVolumes) {
    if (!owned || owned.expiry > started || resource.State !== 'available' || resource.Attachments.length !== 0) continue;
    await aws.call('ec2', 'DeleteVolume', { VolumeId: owned.id });
    volumeDeletionRequested.push(owned.id);
  }
  const completed = now();
  if (!Number.isSafeInteger(completed) || completed < started || completed - started > 120_000) throw new Error('Invalid expiry clock or sweep deadline');
  const health = { schema: 'd570-sweep-v1', account, region, stackId, startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(), terminationRequested, volumeDeletionRequested };
  await aws.call('s3', 'PutObject', { Bucket: bucket, Key: 'd570/health/reaper.json', Body: JSON.stringify(health), ContentType: 'application/json', ServerSideEncryption: 'AES256' });
  return health;
}
