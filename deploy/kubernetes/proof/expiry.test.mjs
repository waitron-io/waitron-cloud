import assert from 'node:assert/strict';
import test from 'node:test';

const module = await import('./expiry.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const now = '2026-11-05T20:00:00.000Z';
const stackId = 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570/00000000-0000-4000-8000-000000000000';
const run = '11111111-1111-4111-8111-111111111111';
const tags = (extra = {}) => Object.entries({ Proof: 'D570', Stack: stackId, Run: run, ExpiresAt: '2026-11-05T19:59:59Z', ...extra }).map(([Key, Value]) => ({ Key, Value }));
const origin = '2026-11-05T19:00:00Z';
const instance = (extra = {}) => ({ LaunchTime: origin, NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: origin } }], InstanceId: 'i-0123456789abcdef0', State: { Name: 'running' }, Tags: tags(), ...extra });
const volume = (extra = {}) => ({ CreateTime: origin, VolumeId: 'vol-0123456789abcdef0', State: 'available', Attachments: [], Tags: tags(), ...extra });
function fixture({ instances = [], volumes = [], fail, pages, volumePages, respond } = {}) {
  const calls = [];
  const aws = {
    async call(service, operation, input) {
      calls.push({ service, operation, input: structuredClone(input) });
      const response = respond?.(operation, input);
      if (response !== undefined) return response;
      if (operation === fail) throw new Error('synthetic AWS unavailable');
      if (operation === 'DescribeInstances') return pages?.(input) ?? { Reservations: [{ Instances: structuredClone(instances) }] };
      if (operation === 'DescribeVolumes') return volumePages?.(input) ?? { Volumes: structuredClone(volumes) };
      if (operation === 'TerminateInstances') return { TerminatingInstances: input.InstanceIds.map(InstanceId => ({ InstanceId, CurrentState: { Name: 'shutting-down' } })) };
      if (operation === 'DeleteVolume' || operation === 'PutObject') return {};
      throw new Error(`Unexpected ${service}.${operation}`);
    },
  };
  return { calls, options: { aws, account: '462991287391', region: 'eu-south-2', stackId, bucket: 'd570-synthetic', accessExpiry: '2027-02-28T23:59:00Z', now: () => Date.parse(now) } };
}
async function sweep(options) {
  assert.equal(typeof module.sweepExpired, 'function', 'bounded expiry sweeper is missing');
  return module.sweepExpired(options);
}
const mutations = f => f.calls.filter(c => !c.operation.startsWith('Describe'));

test('expiry sweep terminates expired owned instances and records accepted requests', async () => {
  const f = fixture({ instances: [instance()] });
  const result = await sweep(f.options);
  assert.deepEqual(result.terminationRequested, ['i-0123456789abcdef0']);
  assert.deepEqual(mutations(f).map(c => c.operation), ['TerminateInstances', 'PutObject']);
  assert.deepEqual(f.calls.find(c => c.operation === 'TerminateInstances').input, { InstanceIds: ['i-0123456789abcdef0'] });
  const health = f.calls.at(-1).input;
  assert.equal(health.Key, 'd570/health/reaper.json');
  assert.equal(health.Bucket, 'd570-synthetic');
  assert.equal(health.ServerSideEncryption, 'AES256');
  assert.deepEqual(JSON.parse(health.Body), result);
  assert.equal(result.stackId, stackId);
  assert.equal(result.completedAt, now);
});

test('future, terminated and foreign resources survive unchanged', async () => {
  for (const other of [
    instance({ Tags: tags({ ExpiresAt: '2026-11-05T20:01:00Z' }) }),
    instance({ State: { Name: 'terminated' } }),
    instance({ Tags: tags({ Proof: 'OTHER' }) }),
    instance({ Tags: tags({ Stack: `${stackId}-foreign` }) }),
  ]) {
    const f = fixture({ instances: [other] });
    const result = await sweep(f.options);
    assert.deepEqual(result.terminationRequested, []);
    assert.deepEqual(mutations(f).map(c => c.operation), ['PutObject']);
  }
});

test('owned missing, impossible and malformed expiry dates terminate rather than gaining time', async () => {
  for (const expiry of ['', 'yesterday', '2026-02-30T20:00:00Z', '2027-02-30T20:00:00Z', '2026-11-05', '2026-11-05T20:00:00Z']) {
    const f = fixture({ instances: [instance({ Tags: tags({ ExpiresAt: expiry }) })] });
    assert.deepEqual((await sweep(f.options)).terminationRequested, ['i-0123456789abcdef0'], expiry);
  }
  const f = fixture({ instances: [instance({ Tags: tags().filter(t => t.Key !== 'ExpiresAt') })] });
  assert.equal((await sweep(f.options)).terminationRequested.length, 1);
});

test('only unattached expired run-owned volumes are deleted', async () => {
  const f = fixture({ volumes: [volume()] });
  assert.deepEqual((await sweep(f.options)).volumeDeletionRequested, ['vol-0123456789abcdef0']);
  assert.deepEqual(mutations(f).map(c => c.operation), ['DeleteVolume', 'PutObject']);
  for (const other of [
    volume({ Attachments: [{ InstanceId: 'i-0123456789abcdef0', State: 'attached' }] }),
    volume({ State: 'in-use' }), volume({ Tags: tags({ ExpiresAt: '2026-11-05T20:01:00Z' }) }),
    volume({ Tags: tags({ Proof: 'OTHER' }) }), volume({ Tags: tags({ Stack: `${stackId}-foreign` }) }),
  ]) {
    const otherFixture = fixture({ volumes: [other] });
    assert.deepEqual((await sweep(otherFixture.options)).volumeDeletionRequested, []);
    assert.deepEqual(mutations(otherFixture).map(c => c.operation), ['PutObject']);
  }
});

test('malformed owned identity or run ownership withholds healthy sweep and performs no deletion', async () => {
  for (const broken of [
    { instances: [instance({ InstanceId: 'i-foreign; command' })] },
    { instances: [instance({ Tags: tags({ Run: '' }) })] },
    { instances: [instance({ Tags: tags({ Run: '11111111-1111-1111-1111-111111111111' }) })] },
    { instances: [instance({ Tags: [...tags(), { Key: 'Stack', Value: 'foreign' }] })] },
    { volumes: [volume({ VolumeId: 'vol-wrong' })] },
    { volumes: [volume({ Attachments: undefined })] },
    { volumes: [volume({ Tags: tags({ Run: 'unknown' }) })] },
  ]) {
    const f = fixture(broken);
    await assert.rejects(sweep(f.options), /ownership|identity|inventory/);
    assert.deepEqual(mutations(f), []);
  }
});

test('wrong account, region, stack or clock cannot make any AWS call', async () => {
  for (const override of [
    { account: '949687825720' }, { region: 'eu-west-1' }, { stackId: stackId.replace('462991287391', '949687825720') },
    { stackId: stackId.replace('eu-south-2', 'eu-west-1') }, { stackId: '' }, { now: () => NaN },
    { bucket: '' }, { now: () => 0 }, { now: () => -1 }, { now: () => 1.5 }, { now: () => 9e15 },
  ]) {
    const f = fixture({ instances: [instance()] });
    await assert.rejects(sweep({ ...f.options, ...override }), /scope|clock/);
    assert.deepEqual(f.calls, []);
  }
});

test('any read, termination or deletion failure withholds healthy heartbeat', async () => {
  for (const fail of ['DescribeInstances', 'DescribeVolumes', 'TerminateInstances', 'DeleteVolume', 'PutObject']) {
    const f = fixture({ fail, instances: [instance()], volumes: [volume()] });
    await assert.rejects(sweep(f.options), /AWS unavailable/);
    if (fail !== 'PutObject') assert.equal(f.calls.some(c => c.operation === 'PutObject'), false, fail);
  }
});

test('pagination includes lost-response orphans and refuses repeated tokens or oversized inventories', async () => {
  const f = fixture({ pages: input => input.NextToken
    ? { Reservations: [{ Instances: [instance()] }] }
    : { Reservations: [], NextToken: 'page2' } });
  assert.equal((await sweep(f.options)).terminationRequested.length, 1);
  const reads = f.calls.filter(c => c.operation === 'DescribeInstances');
  assert.deepEqual(reads[0].input.Filters, [{ Name: 'tag:Proof', Values: ['D570'] }, { Name: 'tag:Stack', Values: [stackId] }]);
  assert.equal(reads[0].input.MaxResults, 100);
  assert.equal(reads[1].input.NextToken, 'page2');
  for (const pages of [
    () => ({ Reservations: [], NextToken: 'forever' }),
    input => ({ Reservations: [], NextToken: `${input.NextToken ?? ''}x` }),
    () => ({ Reservations: [{ Instances: Array.from({ length: 101 }, () => instance()) }] }),
    () => ({ Reservations: [{ Instances: Array.from({ length: 101 }, (_, index) => instance({ InstanceId: `i-${index.toString(16).padStart(17, '0')}` })) }] }),
    () => ({}),
    () => ({ Reservations: [{ Instances: [instance(), instance()] }] }),
  ]) {
    const broken = fixture({ pages });
    await assert.rejects(sweep(broken.options), /inventory|pagination/);
    assert.deepEqual(mutations(broken), []);
    assert.ok(broken.calls.length <= 20);
  }
});

test('a malformed volume run stays untouched without starving an independently owned instance', async () => {
  const f = fixture({ instances: [instance()], volumes: [volume({ Tags: tags({ Run: 'unknown' }) })] });
  await assert.rejects(sweep(f.options), /ownership/);
  assert.deepEqual(mutations(f), [{ service: 'ec2', operation: 'TerminateInstances', input: { InstanceIds: ['i-0123456789abcdef0'] } }]);
});

test('unconfirmed termination responses withhold health while independent volume cleanup continues', async () => {
  for (const response of [{}, { TerminatingInstances: [] }, { TerminatingInstances: [{ InstanceId: 'i-0123456789abcdef0', CurrentState: { Name: 'terminated' } }, { InstanceId: 'i-fffffffffffffffff', CurrentState: { Name: 'terminated' } }] }, { TerminatingInstances: [{ InstanceId: 'i-fffffffffffffffff', CurrentState: { Name: 'terminated' } }] }, { TerminatingInstances: [{ InstanceId: 'i-0123456789abcdef0', CurrentState: { Name: 'running' } }] }]) {
    const f = fixture({ instances: [instance()], volumes: [volume()], respond: operation => operation === 'TerminateInstances' ? response : undefined });
    await assert.rejects(sweep(f.options), /Unconfirmed termination/);
    assert.deepEqual(mutations(f).map(c => c.operation), ['TerminateInstances', 'DeleteVolume']);
  }
});

test('volume pagination is complete and malformed pages never publish a healthy sweep', async () => {
  const f = fixture({ volumePages: input => input.NextToken ? { Volumes: [volume()] } : { Volumes: [], NextToken: 'next' } });
  assert.equal((await sweep(f.options)).volumeDeletionRequested.length, 1);
  for (const volumePages of [() => ({}), () => ({ Volumes: [], NextToken: '' }), () => ({ Volumes: [volume(), volume()] }), () => ({ Volumes: [], NextToken: 'loop' })]) {
    const bad = fixture({ volumePages });
    await assert.rejects(sweep(bad.options), /inventory|pagination/);
    assert.deepEqual(mutations(bad), []);
  }
});

test('a backwards, invalid or overlong sweep clock withholds healthy heartbeat', async () => {
  for (const end of [NaN, Date.parse(now) - 1, Date.parse(now) + 120001]) {
    const f = fixture();
    let reads = 0;
    await assert.rejects(sweep({ ...f.options, now: () => reads++ === 0 ? Date.parse(now) : end }), /clock|deadline/);
    assert.deepEqual(mutations(f), []);
  }
});

test('each inventory sends both server ownership filters and rejects tokens before the page limit', async () => {
  const f = fixture();
  await sweep(f.options);
  for (const operation of ['DescribeInstances', 'DescribeVolumes']) {
    assert.deepEqual(f.calls.find(c => c.operation === operation).input.Filters, [{ Name: 'tag:Proof', Values: ['D570'] }, { Name: 'tag:Stack', Values: [stackId] }]);
  }
  const repeated = fixture({ pages: () => ({ Reservations: [], NextToken: 'same' }) });
  await assert.rejects(sweep(repeated.options), /pagination/);
  assert.equal(repeated.calls.length, 2);
  const long = fixture({ pages: () => ({ Reservations: [], NextToken: 'x'.repeat(4097) }) });
  await assert.rejects(sweep(long.options), /pagination/);
  assert.equal(long.calls.length, 1);
});

test('unknown instance and volume states withhold every mutation', async () => {
  for (const broken of [{ instances: [instance({ State: { Name: 'unknown' } })] }, { volumes: [volume({ State: 'unknown' })] }]) {
    const f = fixture(broken);
    await assert.rejects(sweep(f.options), /inventory/);
    assert.deepEqual(mutations(f), []);
  }
});

test('a failed termination still attempts later eligible instances and volumes without publishing health', async () => {
  const failure = new Error('first termination refused');
  const f = fixture({
    instances: [instance(), instance({ InstanceId: 'i-11111111111111111' }),
      instance({ InstanceId: 'i-22222222222222222', Tags: tags({ Proof: 'OTHER' }) }),
      instance({ InstanceId: 'i-33333333333333333', Tags: tags({ ExpiresAt: '2026-11-05T20:01:00Z' }) }),
      instance({ InstanceId: 'i-44444444444444444', State: { Name: 'terminated' } })],
    volumes: [volume(), volume({ VolumeId: 'vol-11111111111111111', Tags: tags({ Stack: `${stackId}-foreign` }) }),
      volume({ VolumeId: 'vol-22222222222222222', Attachments: [{ InstanceId: 'i-0123456789abcdef0', State: 'attached' }] }),
      volume({ VolumeId: 'vol-33333333333333333', Tags: tags({ ExpiresAt: '2026-11-05T20:01:00Z' }) }),
      volume({ VolumeId: 'vol-44444444444444444', State: 'in-use' })],
    respond(operation, input) {
      if (operation === 'TerminateInstances' && input.InstanceIds[0] === 'i-0123456789abcdef0') throw failure;
    },
  });
  await assert.rejects(sweep(f.options), error => error === failure);
  assert.deepEqual(mutations(f), [
    { service: 'ec2', operation: 'TerminateInstances', input: { InstanceIds: ['i-0123456789abcdef0'] } },
    { service: 'ec2', operation: 'TerminateInstances', input: { InstanceIds: ['i-11111111111111111'] } },
    { service: 'ec2', operation: 'DeleteVolume', input: { VolumeId: 'vol-0123456789abcdef0' } },
  ]);
});

test('a failed volume deletion still attempts the next eligible volume and retains the first failure', async () => {
  const failure = new Error('first volume refused');
  const f = fixture({ volumes: [volume(), volume({ VolumeId: 'vol-11111111111111111' })],
    respond(operation, input) {
      if (operation === 'DeleteVolume' && input.VolumeId === 'vol-0123456789abcdef0') throw failure;
    },
  });
  await assert.rejects(sweep(f.options), error => error === failure);
  assert.deepEqual(mutations(f), [
    { service: 'ec2', operation: 'DeleteVolume', input: { VolumeId: 'vol-0123456789abcdef0' } },
    { service: 'ec2', operation: 'DeleteVolume', input: { VolumeId: 'vol-11111111111111111' } },
  ]);
});

test('multiple cleanup failures cannot erase the first failure or stop subsequent cleanup', async () => {
  const first = new Error('termination refused'), second = new Error('volume refused');
  const f = fixture({ instances: [instance()], volumes: [volume(), volume({ VolumeId: 'vol-11111111111111111' })],
    respond(operation, input) {
      if (operation === 'TerminateInstances') throw first;
      if (operation === 'DeleteVolume' && input.VolumeId === 'vol-0123456789abcdef0') throw second;
    },
  });
  await assert.rejects(sweep(f.options), error => error === first);
  assert.deepEqual(mutations(f).map(c => [c.operation, c.input]), [
    ['TerminateInstances', { InstanceIds: ['i-0123456789abcdef0'] }],
    ['DeleteVolume', { VolumeId: 'vol-0123456789abcdef0' }],
    ['DeleteVolume', { VolumeId: 'vol-11111111111111111' }],
  ]);
});

test('a falsy cleanup rejection still withholds health after later cleanup attempts', async () => {
  const f = fixture({ instances: [instance()], volumes: [volume()],
    respond(operation) { if (operation === 'TerminateInstances') throw undefined; },
  });
  await assert.rejects(sweep(f.options), error => error === undefined);
  assert.deepEqual(mutations(f).map(c => c.operation), ['TerminateInstances', 'DeleteVolume']);
});

test('malformed run rows do not starve later owned cleanup or earn a healthy heartbeat', async () => {
  for (const State of [{ Name: 'running' }, { Name: 'terminated' }]) {
    const f = fixture({ instances: [instance({ State, Tags: tags({ Run: 'unknown' }) }), instance({ InstanceId: 'i-11111111111111111' })],
      volumes: [volume({ Tags: tags({ Run: '' }) }), volume({ VolumeId: 'vol-11111111111111111' }), volume({ VolumeId: 'vol-22222222222222222', Tags: tags({ Proof: 'OTHER' }) })] });
    await assert.rejects(sweep(f.options), /ownership/);
    assert.deepEqual(mutations(f), [
      { service: 'ec2', operation: 'TerminateInstances', input: { InstanceIds: ['i-11111111111111111'] } },
      { service: 'ec2', operation: 'DeleteVolume', input: { VolumeId: 'vol-11111111111111111' } },
    ]);
  }
});

test('structural inventory ambiguity still stops every mutation across otherwise eligible rows', async () => {
  for (const bad of [volume({ Tags: [...tags(), { Key: 'Stack', Value: 'other' }] }), volume({ Attachments: null }), volume({ VolumeId: 'vol-unsafe' })]) {
    const f = fixture({ instances: [instance()], volumes: [bad] });
    await assert.rejects(sweep(f.options), /ownership|inventory|identity/);
    assert.deepEqual(mutations(f), []);
  }
});

test('future expiry beyond the original 135-minute window cannot extend either resource lifetime', async () => {
  const started = '2026-11-05T17:00:00Z';
  const f = fixture({ instances: [instance({ LaunchTime: started, NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: started } }], Tags: tags({ ExpiresAt: '2026-11-05T20:01:00Z' }) })],
    volumes: [volume({ CreateTime: started, Tags: tags({ ExpiresAt: '2026-11-05T20:01:00Z' }) })] });
  await assert.rejects(sweep(f.options), /lifetime/);
  assert.deepEqual(mutations(f), [
    { service: 'ec2', operation: 'TerminateInstances', input: { InstanceIds: ['i-0123456789abcdef0'] } },
    { service: 'ec2', operation: 'DeleteVolume', input: { VolumeId: 'vol-0123456789abcdef0' } },
  ]);
});

test('a restart cannot replace the primary interface origin with the latest LaunchTime', async () => {
  const f = fixture({ instances: [instance({ LaunchTime: new Date('2026-11-05T19:59:00Z'),
    NetworkInterfaces: [{ Attachment: { DeviceIndex: 1, AttachTime: new Date('2026-11-05T19:59:00Z') } }, { Attachment: { DeviceIndex: 0, AttachTime: new Date('2026-11-05T17:00:00Z') } }],
    Tags: tags({ ExpiresAt: '2026-11-05T20:01:00Z' }) })] });
  await assert.rejects(sweep(f.options), /lifetime/);
  assert.deepEqual(mutations(f).map(c => c.operation), ['TerminateInstances']);
});

test('the exact original lifetime boundary survives before expiry and cleans both resources at expiry', async () => {
  for (const atBoundary of [false, true]) {
    const began = new Date('2026-11-05T17:45:00Z');
    const f = fixture({ instances: [instance({ LaunchTime: began, NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: began } }], Tags: tags({ ExpiresAt: '2026-11-05T20:00:00Z' }) })],
      volumes: [volume({ CreateTime: began, Tags: tags({ ExpiresAt: '2026-11-05T20:00:00Z' }) })] });
    const result = await sweep({ ...f.options, now: () => Date.parse(atBoundary ? now : '2026-11-05T19:59:59.999Z') });
    assert.deepEqual(result.terminationRequested, atBoundary ? ['i-0123456789abcdef0'] : []);
    assert.deepEqual(result.volumeDeletionRequested, atBoundary ? ['vol-0123456789abcdef0'] : []);
    assert.equal(mutations(f).at(-1).operation, 'PutObject');
  }
});

test('absolute access expiry caps a shorter lifetime and cleanup remains possible at that deadline', async () => {
  const began = '2027-02-28T23:00:00Z';
  for (const expiry of ['2027-02-28T23:59:00Z', '2027-02-28T23:59:00.001Z']) {
    const f = fixture({ instances: [instance({ LaunchTime: began, NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: began } }], Tags: tags({ ExpiresAt: expiry }) })],
      volumes: [volume({ CreateTime: began, Tags: tags({ ExpiresAt: expiry }) })] });
    const options = { ...f.options, now: () => Date.parse('2027-02-28T23:59:00Z') };
    if (expiry.endsWith('.001Z')) {
      await assert.rejects(sweep(options), /lifetime/);
      assert.deepEqual(mutations(f).map(c => c.operation), ['TerminateInstances', 'DeleteVolume']);
    } else {
      const result = await sweep(options);
      assert.equal(result.terminationRequested.length, 1);
      assert.equal(result.volumeDeletionRequested.length, 1);
    }
  }
});

test('missing or contradictory instance origin triggers owned termination and withholds health', async () => {
  for (const extra of [
    { NetworkInterfaces: undefined }, { NetworkInterfaces: [] },
    { NetworkInterfaces: [{ Attachment: { DeviceIndex: 1, AttachTime: origin } }] },
    { NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: origin } }, { Attachment: { DeviceIndex: 0, AttachTime: origin } }] },
    { NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: 'tomorrow' } }] },
    { LaunchTime: undefined }, { LaunchTime: new Date(NaN) }, { LaunchTime: '2026-11-05T18:59:59Z' },
    { LaunchTime: '2026-11-05T20:00:00.001Z' },
    { LaunchTime: '2026-11-05T20:02:00Z', NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, AttachTime: '2026-11-05T20:01:00Z' } }] },
  ]) {
    const f = fixture({ instances: [instance(extra)], volumes: [volume()] });
    await assert.rejects(sweep(f.options), /origin/);
    assert.deepEqual(mutations(f).map(c => c.operation), ['TerminateInstances', 'DeleteVolume']);
  }
});

test('missing, future or contradictory volume time never authorizes deletion or health but siblings still clean', async () => {
  for (const extra of [{ CreateTime: undefined }, { CreateTime: new Date(NaN) }, { CreateTime: 'tomorrow' },
    { CreateTime: '2026-11-05T20:00:00.001Z' }, { CreateTime: '2026-11-05T19:59:59.001Z' }]) {
    const f = fixture({ instances: [instance()], volumes: [volume(extra), volume({ VolumeId: 'vol-11111111111111111' })] });
    await assert.rejects(sweep(f.options), /origin|lifetime/);
    assert.deepEqual(mutations(f), [
      { service: 'ec2', operation: 'TerminateInstances', input: { InstanceIds: ['i-0123456789abcdef0'] } },
      { service: 'ec2', operation: 'DeleteVolume', input: { VolumeId: 'vol-11111111111111111' } },
    ]);
  }
});

test('missing or invalid approved access expiry refuses before making an AWS call', async () => {
  for (const accessExpiry of [undefined, '', 'tomorrow', '2027-02-30T00:00:00Z', 1790000000000]) {
    const f = fixture({ instances: [instance()], volumes: [volume()] });
    await assert.rejects(sweep({ ...f.options, accessExpiry }), /scope|expiry/);
    assert.deepEqual(f.calls, []);
  }
});
