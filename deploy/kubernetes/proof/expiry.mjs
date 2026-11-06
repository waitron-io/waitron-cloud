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
  const id = resource[kind === 'instance' ? 'InstanceId' : 'VolumeId'];
  if (!(kind === 'instance' ? /^i-[0-9a-f]{17}$/ : /^vol-[0-9a-f]{17}$/).test(id)) throw new Error('Invalid resource identity');
  if (kind === 'instance' && !['pending', 'running', 'stopping', 'stopped', 'shutting-down', 'terminated'].includes(resource.State?.Name)) throw new Error('Invalid instance inventory');
  if (kind === 'volume' && (!Array.isArray(resource.Attachments) || !['creating', 'available', 'in-use', 'deleting', 'deleted', 'error'].includes(resource.State))) throw new Error('Invalid volume inventory');
  return { id, expiry: timestamp(tags.ExpiresAt), expiryTag: tags.ExpiresAt, run: tags.Run, validRun: RUN.test(tags.Run) };
}

async function checkTerminationVolumes(aws, resource, owned, stackId) {
  const mappings = resource.BlockDeviceMappings;
  if (!Array.isArray(mappings) || !mappings.length || mappings.length > 64
    || typeof resource.RootDeviceName !== 'string' || !resource.RootDeviceName
    || mappings.some(m => typeof m?.DeviceName !== 'string' || !m.DeviceName
      || !/^vol-[0-9a-f]{17}$/.test(m.Ebs?.VolumeId) || typeof m.Ebs?.DeleteOnTermination !== 'boolean')
    || new Set(mappings.map(m => m.DeviceName)).size !== mappings.length
    || new Set(mappings.map(m => m.Ebs.VolumeId)).size !== mappings.length
    || !mappings.some(m => m.DeviceName === resource.RootDeviceName && m.Ebs.DeleteOnTermination)) throw new Error(`Invalid termination disk mapping: ${owned.id}`);
  const deleted = mappings.filter(m => m.Ebs.DeleteOnTermination);
  const result = await aws.call('ec2', 'DescribeVolumes', { VolumeIds: deleted.map(m => m.Ebs.VolumeId) });
  if (!Array.isArray(result?.Volumes) || result.Volumes.length !== deleted.length || result.NextToken !== undefined) throw new Error('Invalid termination disk inventory');
  // EC2 can delete disks on termination without a DeleteVolume request from this sweep.
  for (const mapping of deleted) {
    const volume = result.Volumes.find(v => v.VolumeId === mapping.Ebs.VolumeId);
    const disk = ownership(volume, stackId, 'volume');
    if (!disk || disk.run !== owned.run || disk.expiryTag !== owned.expiryTag) throw new Error('Uncertain termination disk ownership or expiry');
    if (volume.State !== 'in-use' || volume.Attachments.length !== 1
      || volume.Attachments[0]?.InstanceId !== owned.id || volume.Attachments[0]?.Device !== mapping.DeviceName
      || volume.Attachments[0]?.State !== 'attached') throw new Error('Uncertain termination disk attachment');
  }
}

function serviceTime(value) {
  if (typeof value === 'string') return timestamp(value);
  try { return Date.prototype.getTime.call(value); } catch { return NaN; }
}

function cleanupTime(resource, owned, kind, started, accessExpiry) {
  let origin;
  if (kind === 'instance') {
    // LaunchTime changes on restart; the primary interface retains the original launch time.
    const primary = Array.isArray(resource.NetworkInterfaces) ? resource.NetworkInterfaces.filter(nic =>
      nic?.Attachment?.DeviceIndex === 0 && (nic.Attachment.NetworkCardIndex ?? 0) === 0) : [];
    origin = primary.length === 1 ? serviceTime(primary[0].Attachment.AttachTime) : NaN;
    const latest = serviceTime(resource.LaunchTime);
    if (!Number.isFinite(latest) || latest < origin || latest > started) origin = NaN;
  } else origin = serviceTime(resource.CreateTime);
  if (!Number.isFinite(origin) || origin <= 0 || origin > started) {
    return { due: kind === 'instance', error: new Error(`Invalid ${kind} origin: ${owned.id}`) };
  }
  if (owned.expiry < origin) {
    return { due: kind === 'instance', error: new Error(`Contradictory ${kind} lifetime: ${owned.id}`) };
  }
  // An invalid tag grants no grace; independent service times bound even a valid future tag.
  if (owned.expiry > Math.min(origin + 135 * 60_000, accessExpiry)) {
    return { due: true, error: new Error(`Excessive ${kind} lifetime: ${owned.id}`) };
  }
  return { due: !(owned.expiry > started) };
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
export async function sweepExpired({ aws, account, region, stackId, bucket, accessExpiry, now = Date.now }) {
  if (account !== ACCOUNT || region !== REGION || typeof stackId !== 'string'
    || !/^arn:aws:cloudformation:eu-south-2:462991287391:stack\/[A-Za-z][A-Za-z0-9-]*\/[0-9a-f-]{36}$/.test(stackId)
    || typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    || !Number.isFinite(timestamp(accessExpiry)) || timestamp(accessExpiry) <= 0) throw new Error('Invalid expiry scope');
  const started = now();
  if (!Number.isSafeInteger(started) || started <= 0 || !Number.isFinite(new Date(started).getTime())) throw new Error('Invalid expiry clock');
  const instances = await inventory(aws, 'DescribeInstances', stackId);
  const volumes = await inventory(aws, 'DescribeVolumes', stackId);
  // A resource may be created while its inventory request is in flight.
  const observed = now();
  if (!Number.isSafeInteger(observed) || !Number.isFinite(new Date(observed).getTime())
    || observed < started || observed - started > 120_000) throw new Error('Invalid expiry clock or sweep deadline');
  // Structural ambiguity in either inventory blocks every destructive request.
  const ownedInstances = instances.map(resource => ({ resource, owned: ownership(resource, stackId, 'instance') }));
  const ownedVolumes = volumes.map(resource => ({ resource, owned: ownership(resource, stackId, 'volume') }));
  const terminationRequested = [], volumeDeletionRequested = [], failures = [];
  const due = (resource, owned, kind) => {
    if (!owned) return false;
    if (!owned.validRun) { failures.push(new Error(`Invalid run ownership: ${owned.id}`)); return false; }
    if (kind === 'instance' && resource.State.Name === 'terminated') return false;
    const timing = cleanupTime(resource, owned, kind, observed, timestamp(accessExpiry));
    if (timing.error) failures.push(timing.error);
    return timing.due;
  };
  for (const { resource, owned } of ownedInstances) {
    if (!due(resource, owned, 'instance')) continue;
    try {
      await checkTerminationVolumes(aws, resource, owned, stackId);
      const result = await aws.call('ec2', 'TerminateInstances', { InstanceIds: [owned.id] });
      if (!Array.isArray(result?.TerminatingInstances) || result.TerminatingInstances.length !== 1
        || result.TerminatingInstances[0].InstanceId !== owned.id
        || !['shutting-down', 'terminated'].includes(result.TerminatingInstances[0].CurrentState?.Name)) throw new Error('Unconfirmed termination request');
      terminationRequested.push(owned.id);
    } catch (error) { failures.push(error); }
  }
  for (const { resource, owned } of ownedVolumes) {
    if (!due(resource, owned, 'volume') || resource.State !== 'available' || resource.Attachments.length !== 0) continue;
    try {
      await aws.call('ec2', 'DeleteVolume', { VolumeId: owned.id });
      volumeDeletionRequested.push(owned.id);
    } catch (error) { failures.push(error); }
  }
  // Independent owned cleanup continues after a refusal, but partial cleanup earns no heartbeat.
  if (failures.length) throw failures[0];
  const completed = now();
  if (!Number.isSafeInteger(completed) || completed < observed || completed - started > 120_000) throw new Error('Invalid expiry clock or sweep deadline');
  const health = { schema: 'd570-sweep-v1', account, region, stackId, startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(), terminationRequested, volumeDeletionRequested };
  await aws.call('s3', 'PutObject', { Bucket: bucket, Key: 'd570/health/reaper.json', Body: JSON.stringify(health), ContentType: 'application/json', ServerSideEncryption: 'AES256' });
  return health;
}
