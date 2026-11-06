import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const module = await import('./bootstrap.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const input = () => ({
  scope: { account: '462991287391', region: 'eu-south-2', stackId: 'arn:aws:cloudformation:eu-south-2:462991287391:stack/d570-proof/11111111-1111-4111-8111-111111111111' },
  reservation: { uuid: '22222222-2222-4222-8222-222222222222', head: 'a'.repeat(40), tree: 'b'.repeat(40), startedAt: '2026-11-06T12:00:00Z', expiry: '2026-11-06T14:15:00Z' },
});
function render(value = input()) {
  assert.equal(typeof module.renderDeadlineBootstrap, 'function', 'fixed-deadline bootstrap is missing');
  return module.renderDeadlineBootstrap(value);
}

// Only OS paths and executable boundaries are projected; the emitted shell logic runs unchanged.
function guest(t) {
  const root = mkdtempSync(join(tmpdir(), 'd570-deadline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['etc/systemd/system', 'var/lib', 'proc/sys/kernel/random', 'bin', 'run']) mkdirSync(join(root, path), { recursive: true });
  const clock = { now: 1793966460, uptime: 60 }; // 2026-11-06 12:01 UTC; boot at original start.
  writeFileSync(join(root, 'proc/sys/kernel/random/boot_id'), '33333333-3333-4333-8333-333333333333\n');
  const log = join(root, 'calls'), settings = join(root, 'settings.json');
  function configure(change = {}) {
    Object.assign(clock, change);
    writeFileSync(settings, JSON.stringify(clock));
    writeFileSync(join(root, 'proc/uptime'), `${clock.uptime}.00 0.00\n`);
  }
  configure();
  const shim = `#!${process.execPath}\nimport fs from 'node:fs';\nconst root=${JSON.stringify(root)}, s=JSON.parse(fs.readFileSync(${JSON.stringify(settings)}));const [op,...args]=process.argv.slice(2);\nif(op==='id') { console.log(s.uid??0); process.exit(0); }\nif(op==='date') { console.log(s.now);if(s.stallAfterDate)fs.writeFileSync(root+'/proc/uptime',String(s.uptime+s.stallAfterDate)+'.00 0.00\\n'); process.exit(0); }\nif(op==='rm'){if(s.failCleanup)process.exit(1);fs.rmSync(args.at(-1),{recursive:true,force:true});process.exit(0);}\nif(op==='systemctl') {\n fs.appendFileSync(${JSON.stringify(log)},args.join(' ')+'\\n');\n if(s.fail && args.includes(s.fail))process.exit(1);\n if(args[0]==='is-active')process.exit(fs.existsSync(root+'/armed')?0:1);\n if(args[0]==='is-enabled'){if(!args.includes('--quiet'))console.log(s.enabledState??'enabled');if(s.advanceOnEnabled){s.now+=s.advanceOnEnabled;fs.writeFileSync(${JSON.stringify(settings)},JSON.stringify(s));}process.exit(fs.existsSync(root+'/enabled')?0:1);}\n if(args[0]==='enable')fs.writeFileSync(root+'/enabled','yes');\n if(args[0]==='start') {if(s.signalOnStart)process.kill(Number(process.env.D570_TEST_SHELL_PID),s.signalOnStart);fs.writeFileSync(root+'/armed','yes');if(s.advanceOnStart){s.now+=s.advanceOnStart;fs.writeFileSync(${JSON.stringify(settings)},JSON.stringify(s));}}\n process.exit(0);\n}\nif(op==='timeout') { const {spawnSync}=await import('node:child_process');const r=spawnSync(args[1],args.slice(2),{stdio:'inherit'});process.exit(r.status??1); }\nprocess.exit(2);\n`;
  writeFileSync(join(root, 'bin/shim.mjs'), shim, { mode: 0o755 });
  function run(value = input()) {
    let source = render(value);
    const paths = ['/etc/systemd/system', '/var/lib/d570-deadline', '/proc/sys/kernel/random/boot_id', '/proc/uptime', '/run/d570-deadline.', '/run/systemd/system', '/run/systemd', '/usr/local/lib/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system'];
    const pattern = new RegExp(paths.map(path => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    source = source.replace(pattern, path => join(root, path));
    for (const executable of ['systemctl', 'date', 'id', 'timeout']) source = source.replaceAll(`/usr/bin/${executable}`, `${join(root, 'bin/shim.mjs')} ${executable}`);
    source = source.replace('rm -rf -- \"$work\"', `${join(root, 'bin/shim.mjs')} rm -rf -- \"$work\"`);
    source = 'export D570_TEST_SHELL_PID=$$\n' + (clock.closedStderr ? 'exec 2>&-\n' : '') + source;
    const result = spawnSync('bash', ['-c', source], { encoding: 'utf8', timeout: 15000, env: { ...process.env, TMPDIR: root, ...(clock.poisonedPath ? { PATH: join(root,'bin')+':'+process.env.PATH } : {}) } });
    assert.ifError(result.error); return result;
  }
  return { root, configure, run, calls: () => existsSync(log) ? readFileSync(log, 'utf8') : '', read: path => readFileSync(join(root, path), 'utf8') };
}

test('installs a fixed UTC and boot-relative deadline before reporting ready', t => {
  const g = guest(t), result = g.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^D570_DEADLINE_READY 22222222-2222-4222-8222-222222222222 1793974500 33333333-3333-4333-8333-333333333333\n$/);
  const timer = g.read('etc/systemd/system/d570-deadline.timer');
  assert.match(timer, /^OnCalendar=2026-11-06 14:15:00 UTC$/m);
  assert.match(timer, /^OnBootSec=8098s$/m);
  assert.match(timer, /^AccuracySec=1us$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^RandomizedDelaySec=0$/m);
  const reboot=g.read('etc/systemd/system/d570-reboot.service');
  for(const expected of ['DefaultDependencies=no','After=local-fs.target','OnFailure=poweroff.target','[Install]\nWantedBy=multi-user.target']) assert.ok(reboot.includes(expected));
  assert.match(g.read('etc/systemd/system/d570-deadline.service'), /^OnFailure=poweroff.target$/m);
  assert.match(timer, /^Unit=d570-deadline.service$/m);
  assert.ok(g.read('etc/systemd/system/d570-deadline.service').includes(`ExecStart=${join(g.root, 'bin/shim.mjs')} systemctl --no-block poweroff\n`));
  assert.match(g.read('etc/systemd/system/d570-reboot.service'), /^Before=cloud-init-local.service cloud-init.service multi-user.target$/m);
  assert.equal(g.calls(), 'daemon-reload\nenable d570-reboot.service\nstart d570-deadline.timer\nis-active --quiet d570-deadline.timer\nis-enabled d570-reboot.service\n');
});

test('exact retry retains the original timer without restarting or rewriting it', t => {
  const g = guest(t); assert.equal(g.run().status, 0);
  const original = g.read('etc/systemd/system/d570-deadline.timer');
  g.configure({ now: 1793966520, uptime: 120 });
  assert.equal(g.run().status, 0);
  assert.equal(g.read('etc/systemd/system/d570-deadline.timer'), original);
  assert.equal(g.calls(), 'daemon-reload\nenable d570-reboot.service\nstart d570-deadline.timer\nis-active --quiet d570-deadline.timer\nis-enabled d570-reboot.service\nis-active --quiet d570-deadline.timer\nis-enabled d570-reboot.service\n');
});

for (const [label, change] of [
  ['expired deadline', { now: 1793974500 }], ['clock before original start', { now: 1793966399 }],
  ['unprivileged installation', { uid: 1000 }], ['timer start failure', { fail: 'start' }],
  ['daemon reload failure', { fail: 'daemon-reload' }], ['reboot guard enable failure', { fail: 'enable' }],
  ['timer not active', { fail: 'is-active' }], ['reboot guard not enabled', { fail: 'is-enabled' }],
  ['deadline elapses while arming', { advanceOnStart: 8040 }],
]) test(`${label} withholds ready and requests poweroff`, t => {
  const g = guest(t); g.configure(change); const result = g.run();
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /D570_DEADLINE_READY/);
  assert.match(g.calls(), /--no-block poweroff\n/);
});

for (const [label, edit] of [
  ['new boot', g => writeFileSync(join(g.root, 'proc/sys/kernel/random/boot_id'), '44444444-4444-4444-8444-444444444444\n')],
  ['missing ready record', g => rmSync(join(g.root, 'var/lib/d570-deadline/ready'))],
  ['backward clock', g => g.configure({ now: 1793966459 })],
  ['expired monotonic time despite backward wall clock', g => g.configure({ now: 1793966460, uptime: 8098 })],
]) test(`retry after ${label} cannot extend the original deadline`, t => {
  const g = guest(t); assert.equal(g.run().status, 0); edit(g);
  const result = g.run(); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /D570_DEADLINE_READY/);
  assert.match(g.calls(), /--no-block poweroff\n/);
});

test('a changed reservation cannot replace a previously armed deadline', t => {
  const g = guest(t); assert.equal(g.run().status, 0);
  const value = input(); value.reservation.expiry = '2026-11-06T14:14:00Z';
  assert.notEqual(g.run(value).status, 0);
  assert.match(g.calls(), /--no-block poweroff\n/);
});

for (const [label, edit] of [
  ['production account', x => x.scope.account = '949687825720'], ['wrong region', x => x.scope.region = 'eu-west-1'],
  ['foreign stack', x => x.scope.stackId = 'arn:aws:cloudformation:eu-south-2:949687825720:stack/d570-proof/11111111-1111-4111-8111-111111111111'],
  ['shell injection', x => x.reservation.uuid = "'; touch /tmp/foreign; #"],
  ['missing head', x => delete x.reservation.head], ['invalid tree', x => x.reservation.tree = 'head'],
  ['impossible date', x => x.reservation.startedAt = '2026-02-30T12:00:00Z'],
  ['fractional expiry', x => x.reservation.expiry = '2026-11-06T14:15:00.001Z'],
  ['too long', x => x.reservation.expiry = '2026-11-06T14:15:01Z'],
  ['empty lifetime', x => x.reservation.expiry = x.reservation.startedAt],
  ['authority expired', x => { x.reservation.startedAt = '2027-02-28T23:58:00Z'; x.reservation.expiry = '2027-03-01T00:01:00Z'; }],
]) test(`bootstrap renderer refuses ${label} before emitting executable launch data`, () => {
  const value = input(); edit(value); assert.throws(() => render(value), /refused/i);
});

test('rendered launch data fits the EC2 raw limit and parses as Bash', () => {
  const data = render(); assert.ok(Buffer.byteLength(data) < 16 * 1024);
  assert.equal(spawnSync('bash', ['-n'], { input: data }).status, 0);
});

for (const [label, edit] of [
  ['damaged timer', g => writeFileSync(join(g.root, 'etc/systemd/system/d570-deadline.timer'), 'broken')],
  ['damaged clock', g => writeFileSync(join(g.root, 'var/lib/d570-deadline/clock'), 'invalid\n')],
  ['damaged ready record', g => writeFileSync(join(g.root, 'var/lib/d570-deadline/ready'), 'invalid\n')],
  ['lost identity', g => rmSync(join(g.root, 'var/lib/d570-deadline/identity'))],
]) test(`retry with ${label} refuses without replacing protection`, t => {
  const g = guest(t); assert.equal(g.run().status, 0); edit(g);
  const result = g.run(); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(g.calls(), /--no-block poweroff\n/);
  assert.equal(g.calls().split('\n').filter(line => line === 'start d570-deadline.timer').length, 1);
});

test('pre-existing system unit is preserved and installation refuses', t => {
  const g = guest(t); const path = join(g.root, 'etc/systemd/system/d570-deadline.service');
  writeFileSync(path, 'foreign unit\n');
  assert.notEqual(g.run().status, 0);
  assert.equal(readFileSync(path, 'utf8'), 'foreign unit\n');
  assert.match(g.calls(), /--no-block poweroff\n/);
});

test('clock rollback while arming refuses a ready record', t => {
  const g = guest(t); g.configure({ advanceOnStart: -1 });
  assert.notEqual(g.run().status, 0);
  assert.equal(existsSync(join(g.root, 'var/lib/d570-deadline/ready')), false);
});


test('expiry during the last systemd observation withholds the ready record', t => {
  const g = guest(t); g.configure({ advanceOnEnabled: 8040 });
  const result = g.run(); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(g.root, 'var/lib/d570-deadline/ready')), false);
  assert.match(g.calls(), /--no-block poweroff\n/);
});

for (const unit of ['d570-deadline.service', 'd570-reboot.service']) test(`${unit} requests poweroff rather than stop`, t => {
  const g = guest(t); assert.equal(g.run().status, 0);
  const command = g.read('etc/systemd/system/' + unit).split('\n').find(line => line.startsWith('ExecStart=')).slice(10);
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.match(g.calls(), /--no-block poweroff\n$/);
});


test('an impossible original date cannot normalize into a short allowed lifetime', () => {
  const value = input(); value.reservation.startedAt = '2026-02-30T12:00:00Z'; value.reservation.expiry = '2026-03-02T12:01:00Z';
  assert.throws(() => render(value), /refused/i);
});

test('invalid boot identity refuses before installing units', t => {
  const g = guest(t); writeFileSync(join(g.root, 'proc/sys/kernel/random/boot_id'), 'invalid\n');
  assert.notEqual(g.run().status, 0);
  assert.equal(existsSync(join(g.root, 'etc/systemd/system/d570-deadline.timer')), false);
  assert.match(g.calls(), /--no-block poweroff\n/);
});


test('temporary-file cleanup failure cannot suppress the poweroff request', t => {
  const g = guest(t); g.configure({ fail: 'start', failCleanup: true });
  const result = g.run(); assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /D570_DEADLINE_READY/);
  assert.match(g.calls(), /--no-block poweroff\n/);
});


for (const [signal, code] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) test(`${signal} during arming exits unsuccessfully and requests poweroff`, t => {
  const g = guest(t); g.configure({ signalOnStart: signal }); const result = g.run();
  assert.equal(result.status, code); assert.doesNotMatch(result.stdout, /D570_DEADLINE_READY/);
  assert.match(g.calls(), /--no-block poweroff\n/);
});

test('closed diagnostic output cannot suppress poweroff', t => {
  const g = guest(t); g.configure({ fail: 'start', closedStderr: true }); const result = g.run();
  assert.notEqual(result.status, 0); assert.match(g.calls(), /--no-block poweroff\n/);
  assert.equal(readdirSync(join(g.root,'run')).length,0);
});

for (const content of ['1793966460 99999\n', '1793966400 8098\n', '1793966460 8098\nextra\n', '1793966460 18446744073709561616\n']) test(`well-formed changed clock ${JSON.stringify(content)} refuses`, t => {
  const g = guest(t); assert.equal(g.run().status, 0);
  writeFileSync(join(g.root, 'var/lib/d570-deadline/clock'), content);
  g.configure(content.startsWith('1793966400') ? { now: 1793966401, uptime: 100 } : { now: 1793966461, uptime: content.includes('extra') ? 100 : 9000 });
  assert.notEqual(g.run().status, 0); assert.match(g.calls(), /--no-block poweroff\n/);
});

test('cleanup failure keeps every temporary work file inside its isolated guest root', t => {
  const g = guest(t); g.configure({ fail: 'start', failCleanup: true }); assert.notEqual(g.run().status, 0);
  assert.equal(readdirSync(join(g.root, 'run')).filter(name => name.startsWith('d570-deadline.')).length, 1);
});

for (const retry of [false,true]) test(`foreign drop-in ${retry ? 'on retry' : 'before installation'} refuses`, t => {
  const g = guest(t); if(retry) assert.equal(g.run().status,0);
  const dir=join(g.root,'etc/systemd/system/d570-deadline.timer.d');mkdirSync(dir);writeFileSync(join(dir,'late.conf'),'[Timer]\nOnBootSec=999999s\n');
  assert.notEqual(g.run().status,0);assert.match(g.calls(),/--no-block poweroff\n/);assert.equal(readFileSync(join(dir,'late.conf'),'utf8'),'[Timer]\nOnBootSec=999999s\n');
});

test('a stall between time observations cannot lengthen the boot-relative deadline', t => {
  const g=guest(t);g.configure({stallAfterDate:5});assert.equal(g.run().status,0);
  assert.match(g.read('etc/systemd/system/d570-deadline.timer'),/^OnBootSec=8098s$/m);
});

for(const [name,change] of [['head',v=>v.reservation.head='c'.repeat(40)],['tree',v=>v.reservation.tree='c'.repeat(40)],['stack',v=>v.scope.stackId=v.scope.stackId.replace('d570-proof','d570-other')],['run',v=>v.reservation.uuid='44444444-4444-4444-8444-444444444444']])test(`retry must retain original ${name}`,t=>{
 const g=guest(t);assert.equal(g.run().status,0);const v=input();change(v);assert.notEqual(g.run(v).status,0);assert.match(g.calls(),/--no-block poweroff\n/);
});

for(const state of ['static','indirect','enabled-runtime','linked','disabled'])test(`${state} is not persistent reboot enablement`,t=>{
 const g=guest(t);g.configure({enabledState:state});const result=g.run();assert.notEqual(result.status,0);assert.match(g.calls(),/--no-block poweroff\n/);
});

test('a valid-looking oversized identity cannot emit EC2 launch data beyond the raw limit',()=>{
 const v=input();v.scope.stackId=v.scope.stackId.replace('d570-proof','d570-'+'x'.repeat(16384));assert.throws(()=>render(v),/refused/i);
});


for(const unit of ['d570-deadline.service','d570-reboot.service'])test(`retry detects corruption in ${unit}`,t=>{
 const g=guest(t);assert.equal(g.run().status,0);writeFileSync(join(g.root,'etc/systemd/system',unit),'corrupt\n');assert.notEqual(g.run().status,0);assert.match(g.calls(),/--no-block poweroff\n/);
});

for(const unit of ['d570-deadline.timer','d570-reboot.service'])test(`foreign dangling ${unit} is retained`,t=>{
 const g=guest(t),path=join(g.root,'etc/systemd/system',unit);symlinkSync('missing-unit',path);assert.notEqual(g.run().status,0);assert.ok(statSync(join(g.root,'etc/systemd/system')).isDirectory());assert.match(g.calls(),/--no-block poweroff\n/);
});

for(const path of ['run/systemd/system','usr/lib/systemd/system','lib/systemd/system'])test(`foreign ${path} drop-in refuses`,t=>{
 const g=guest(t),dir=join(g.root,path,'d570-reboot.service.d');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'late.conf'),'[Service]\nExecStart=\n');assert.notEqual(g.run().status,0);assert.match(g.calls(),/--no-block poweroff\n/);
});

test('saved deadline metadata is private to root',t=>{
 const g=guest(t);assert.equal(g.run().status,0);for(const path of ['var/lib/d570-deadline','var/lib/d570-deadline/identity','var/lib/d570-deadline/clock','var/lib/d570-deadline/units','var/lib/d570-deadline/ready'])assert.equal(statSync(join(g.root,path)).mode&0o077,0,path);
});

for(const [name,edit]of [['zero head',v=>v.reservation.head='0'.repeat(40)],['non-v4 run',v=>v.reservation.uuid='22222222-2222-1222-8222-222222222222'],['unreserved stack name',v=>v.scope.stackId=v.scope.stackId.replace('d570-proof','foreign')]])test(`renderer refuses ${name}`,()=>{const v=input();edit(v);assert.throws(()=>render(v),/refused/i);});

for(const directory of ['service.d','timer.d','d570-.service.d','d570-.timer.d'])test(`foreign shared ${directory} override refuses`,t=>{
 const g=guest(t),dir=join(g.root,'etc/systemd/system',directory);mkdirSync(dir);writeFileSync(join(dir,'late.conf'),'[Unit]\nDescription=foreign\n');assert.notEqual(g.run().status,0);assert.match(g.calls(),/--no-block poweroff\n/);
});

for(const directory of ['etc/systemd/system.control','run/systemd/generator.early'])test(`foreign higher-priority ${directory} unit refuses`,t=>{
 const g=guest(t),dir=join(g.root,directory);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'d570-deadline.timer'),'[Timer]\nOnBootSec=999999s\n');assert.notEqual(g.run().status,0);assert.match(g.calls(),/--no-block poweroff\n/);
});


test('an inherited command path cannot substitute the installation tools',t=>{
 const g=guest(t);writeFileSync(join(g.root,'bin/mkdir'),'#!/bin/sh\nexit 91\n',{mode:0o755});g.configure({poisonedPath:true});assert.equal(g.run().status,0);
});
