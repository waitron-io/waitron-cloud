import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const implementation=await import('./ci-lock.mjs').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
  return {};
});
const parseLock=implementation.parseLock??(()=>assert.fail('Resolved lock parser is missing'));
const changedImporters=implementation.changedImporters??(()=>assert.fail('Resolved lock comparison is missing'));
const fixture=()=>({
  lockfileVersion:'9.0',settings:{autoInstallPeers:true,excludeLinksFromLockfile:false},
  importers:{
    '.':{devDependencies:{compiler:{specifier:'1.0.0',version:'1.0.0'}}},
    'packages/provider':{dependencies:{alpha:{specifier:'1.0.0',version:'1.0.0'}}},
    'packages/consumer':{dependencies:{provider:{specifier:'workspace:*',version:'link:../provider'}}},
    'packages/unrelated':{dependencies:{beta:{specifier:'1.0.0',version:'1.0.0'}}},
  },
  packages:{'compiler@1.0.0':{resolution:{integrity:'sha512-Yw=='}},'alpha@1.0.0':{resolution:{integrity:'sha512-YQ=='}},'leaf@1.0.0':{resolution:{integrity:'sha512-bA=='}},'beta@1.0.0':{resolution:{integrity:'sha512-Yg=='}}},
  snapshots:{'compiler@1.0.0':{},'alpha@1.0.0':{dependencies:{leaf:'1.0.0'}},'leaf@1.0.0':{},'beta@1.0.0':{}},
});
// JSON flow values are also YAML; block form below exercises pnpm's indentation.
const encode=value=>Object.entries(value).map(([key,entry])=>`${key}: ${JSON.stringify(entry)}\n`).join('');
const parse=value=>parseLock(encode(value),'pnpm-lock.yaml');
const delta=(before,after)=>changedImporters(parse(before),parse(after));

test('resolved lock graph keeps indirect inputs and linked importer consumers',()=>{
  const lock=parse(fixture());
  assert.deepEqual(lock.closures['packages/provider'].snapshots,['alpha@1.0.0','leaf@1.0.0']);
  assert.deepEqual(lock.closures['packages/consumer'].snapshots,['alpha@1.0.0','leaf@1.0.0']);
  assert.deepEqual(lock.closures['packages/consumer'].importers,['packages/consumer','packages/provider']);
  assert.deepEqual(delta(fixture(),fixture()).importers,[]);
});

test('importer-only declarations select their linked consumers',()=>{
  const before=fixture(),after=fixture();
  after.importers['packages/provider'].dependencies.alpha.specifier='^1.0.0';
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
});

for(const [label,change]of [
  ['transitive integrity',after=>{after.packages['leaf@1.0.0'].resolution.integrity='sha512-Y2hhbmdlZA==';}],
  ['engine restriction',after=>{after.packages['leaf@1.0.0'].engines={node:'>=26'};}],
  ['platform restriction',after=>{after.packages['leaf@1.0.0'].cpu=['arm64'];after.packages['leaf@1.0.0'].os=['darwin'];}],
  ['optional snapshot marker',after=>{after.snapshots['leaf@1.0.0'].optional=true;}],
  ['peer metadata',after=>{after.packages['leaf@1.0.0'].peerDependencies={beta:'*'};after.packages['leaf@1.0.0'].peerDependenciesMeta={beta:{optional:true}};}],
  ['transitive peer list',after=>{after.snapshots['leaf@1.0.0'].transitivePeerDependencies=['beta'];}],
  ['registry tarball',after=>{after.packages['leaf@1.0.0'].resolution.tarball='https://npm.pkg.github.com/download/example/leaf/1.0.0/abcdef';}],
])test(`${label} edits without importer changes retain indirect consumers`,()=>{
  const before=fixture(),after=fixture();change(after);
  const result=delta(before,after);
  assert.deepEqual(result.importers,['packages/consumer','packages/provider']);
  assert.ok(result.reasons.every(row=>row.path==='pnpm-lock.yaml' && row.reason.includes('resolved')));
});

test('full peer contexts remain distinct while sharing unsuffixed metadata',()=>{
  const before=fixture();
  delete before.packages['alpha@1.0.0'];delete before.snapshots['alpha@1.0.0'];
  before.packages['adapter@1.0.0']={resolution:{integrity:'sha512-YQ=='},peerDependencies:{leaf:'*'}};
  before.snapshots['adapter@1.0.0(leaf@1.0.0)']={dependencies:{leaf:'1.0.0'}};
  before.snapshots['adapter@1.0.0(beta@1.0.0)']={dependencies:{beta:'1.0.0'}};
  before.importers['packages/provider'].dependencies={adapter:{specifier:'1.0.0',version:'1.0.0(leaf@1.0.0)'}};
  before.importers['packages/unrelated'].dependencies={adapter:{specifier:'1.0.0',version:'1.0.0(beta@1.0.0)'}};
  const after=structuredClone(before);
  after.snapshots['adapter@1.0.0(leaf@1.0.0)'].optional=true;
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
  assert.deepEqual(parse(after).closures['packages/provider'].snapshots,['adapter@1.0.0(leaf@1.0.0)','leaf@1.0.0']);
});

test('peer-context-only resolution changes retain former indirect inputs',()=>{
  const before=fixture();
  delete before.packages['alpha@1.0.0'];delete before.snapshots['alpha@1.0.0'];
  before.packages['adapter@1.0.0']={resolution:{integrity:'sha512-YQ=='},peerDependencies:{leaf:'*'}};
  before.snapshots['adapter@1.0.0(leaf@1.0.0)']={dependencies:{leaf:'1.0.0'}};
  before.snapshots['adapter@1.0.0(beta@1.0.0)']={dependencies:{beta:'1.0.0'}};
  before.importers['packages/provider'].dependencies={adapter:{specifier:'1.0.0',version:'1.0.0(leaf@1.0.0)'}};
  before.importers['packages/unrelated'].dependencies={adapter:{specifier:'1.0.0',version:'1.0.0(beta@1.0.0)'}};
  const after=structuredClone(before);
  after.importers['packages/provider'].dependencies.adapter.version='1.0.0(beta@1.0.0)';
  delete after.snapshots['adapter@1.0.0(leaf@1.0.0)'];delete after.snapshots['leaf@1.0.0'];delete after.packages['leaf@1.0.0'];
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
});

test('shared peer metadata changes affect every retained peer context',()=>{
  const before=fixture();
  before.snapshots['alpha@1.0.0(peer@2.0.0)']={dependencies:{leaf:'1.0.0'}};
  before.importers['packages/unrelated'].dependencies.extra={specifier:'1.0.0',version:'alpha@1.0.0(peer@2.0.0)'};
  const after=structuredClone(before);after.packages['alpha@1.0.0'].engines={node:'>=26'};
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider','packages/unrelated']);
});

test('optional edge and record removal compares both trees',()=>{
  const before=fixture();before.snapshots['alpha@1.0.0']={optionalDependencies:{leaf:'1.0.0'}};
  const after=structuredClone(before);after.snapshots['alpha@1.0.0']={};
  delete after.snapshots['leaf@1.0.0'];delete after.packages['leaf@1.0.0'];
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
});

test('deleted importer remains affected and retains its former consumer',()=>{
  const before=fixture(),after=fixture();
  delete after.importers['packages/provider'];delete after.importers['packages/consumer'].dependencies;
  delete after.snapshots['alpha@1.0.0'];delete after.snapshots['leaf@1.0.0'];
  delete after.packages['alpha@1.0.0'];delete after.packages['leaf@1.0.0'];
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
});

test('aliases and cyclic workspace links preserve real snapshot targets',()=>{
  const before=fixture();
  before.importers['packages/provider'].dependencies={alias:{specifier:'npm:alpha@1.0.0',version:'alpha@1.0.0'},consumer:{specifier:'workspace:*',version:'link:../consumer'}};
  const after=structuredClone(before);after.packages['leaf@1.0.0'].hasBin=true;
  assert.deepEqual(parse(before).closures['packages/consumer'].snapshots,['alpha@1.0.0','leaf@1.0.0']);
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
});

test('root compiler graph is separate from runtime importer graphs',()=>{
  const before=fixture(),after=fixture();after.packages['compiler@1.0.0'].hasBin=true;
  assert.deepEqual(delta(before,after).importers,['.']);
});

test('lock parsing ignores map order and whitespace without losing scalar types',()=>{
  const original=fixture(),reordered=Object.fromEntries(Object.entries(original).reverse());
  reordered.importers=Object.fromEntries(Object.entries(original.importers).reverse());
  assert.deepEqual(delta(original,reordered).importers,[]);
  assert.deepEqual(changedImporters(parseLock('\n# comment\n'+encode(original)),parse(original)).importers,[]);
});

for(const [label,change,pattern]of [
  ['version',value=>{value.lockfileVersion='8.0';},/version/i],
  ['settings',value=>{value.settings.autoInstallPeers=false;},/settings/i],
  ['unknown settings',value=>{value.settings.injectWorkspacePackages=true;},/settings/i],
  ['unknown root field',value=>{value.overrides={alpha:'1.0.0'};},/overrides/],
  ['unknown importer field',value=>{value.importers['packages/provider'].patchedDependencies={};},/patchedDependencies/],
  ['unknown record field',value=>{value.packages['alpha@1.0.0'].mystery=true;},/mystery/],
  ['unknown snapshot field',value=>{value.snapshots['alpha@1.0.0'].mystery=true;},/mystery/],
  ['missing snapshot',value=>{delete value.snapshots['leaf@1.0.0'];},/leaf/],
  ['missing metadata',value=>{delete value.packages['leaf@1.0.0'];},/leaf/],
  ['missing workspace link',value=>{value.importers['packages/consumer'].dependencies.provider.version='link:../gone';},/gone/],
  ['outside workspace link',value=>{value.importers['packages/consumer'].dependencies.provider.version='link:../../../outside';},/link|outside/],
  ['unknown dependency protocol',value=>{value.importers['packages/provider'].dependencies.alpha.version='file:../vendor';},/file:/],
  ['orphan snapshot',value=>{value.packages['orphan@1.0.0']={resolution:{integrity:'sha512-ZA=='}};value.snapshots['orphan@1.0.0']={};},/orphan/],
  ['unreferenced peer snapshot',value=>{value.snapshots['alpha@1.0.0(peer@2.0.0)']={dependencies:{leaf:'1.0.0'}};},/orphan snapshot/],
  ['orphan metadata',value=>{value.packages['orphan@1.0.0']={resolution:{integrity:'sha512-ZA=='}};},/orphan/],
  ['non-map dependencies',value=>{value.snapshots['alpha@1.0.0'].dependencies=[];},/dependencies/],
  ['non-string version',value=>{value.importers['packages/provider'].dependencies.alpha.version=1;},/version/],
  ['non-boolean optional',value=>{value.snapshots['leaf@1.0.0'].optional='true';},/optional/],
  ['unknown resolution field',value=>{value.packages['leaf@1.0.0'].resolution.mystery=true;},/mystery/],
  ['unsupported tarball protocol',value=>{value.packages['leaf@1.0.0'].resolution.tarball='file:///tmp/a.tgz';},/tarball/],
])test(`lock input refuses ${label} by path and reason`,()=>{
  const value=fixture();change(value);
  assert.throws(()=>parse(value),error=>error.message.includes('pnpm-lock.yaml') && pattern.test(error.message));
});

for(const [source,pattern]of [
  ["lockfileVersion: '9.0'\nlockfileVersion: '9.0'\n",/duplicate/i],
  ['settings: {autoInstallPeers: true, autoInstallPeers: false}\n',/duplicate/i],
  ['settings:\n   autoInstallPeers: true\n',/indent/i],
  ['settings:\n\tautoInstallPeers: true\n',/tab|indent/i],
  ['settings: &policy {autoInstallPeers: true}\n',/unsupported/i],
  ['settings: !map {}\n',/unsupported/i],
  ['settings: {<<: *policy}\n',/unsupported|merge/i],
  ['settings: |\n  text\n',/unsupported/i],
  ['settings: {} ignored\n',/trailing|unsupported/i],
  ['settings: {autoInstallPeers: true\n',/unterminated|unsupported/i],
  ['settings: {autoInstallPeers: true,,}\n',/unsupported|key/i],
  ['settings: {autoInstallPeers: true} # accepted comment\nimporters: {}\n',/version/i],
])test(`bounded YAML rejects unsupported or partial input: ${source}`,()=>{
  assert.throws(()=>parseLock(source,'pnpm-lock.yaml'),error=>error.message.includes('pnpm-lock.yaml') && pattern.test(error.message));
});

test('bounded YAML rejects oversized inputs and excessive nesting',()=>{
  assert.throws(()=>parseLock(' '.repeat(2*1024*1024+1)),/size/i);
  assert.throws(()=>parseLock('settings: '+ '['.repeat(40)+'true'+']'.repeat(40)+'\n'),/depth/i);
});

for(const context of ['()','(peer)','(peer@1.0)','(peer@)'])test(`resolved graph rejects malformed peer identity ${context}`,()=>{
  const value=fixture(),snapshot=value.snapshots['alpha@1.0.0'];
  delete value.snapshots['alpha@1.0.0'];value.snapshots['alpha@1.0.0'+context]=snapshot;
  value.importers['packages/provider'].dependencies.alpha.version='1.0.0'+context;
  assert.throws(()=>parse(value),/pnpm-lock.yaml:.*(?:peer|version)/i);
});

test('current lock matches independently recorded importer closure counts',()=>{
  const lock=parseLock(readFileSync(new URL('../pnpm-lock.yaml',import.meta.url),'utf8'));
  assert.equal(Object.keys(lock.packages).length,215);
  assert.equal(Object.keys(lock.snapshots).length,215);
  assert.deepEqual(Object.fromEntries(Object.entries(lock.closures).map(([id,closure])=>[id,closure.snapshots.length])),{
    '.':23,'apps/portal':194,'packages/account-http':126,'packages/backups':83,
    'packages/fiscal-allocation':66,'packages/identity':20,'packages/operations':17,
    'packages/registration':57,'packages/remote-access':88,'packages/ui-smoke':36,
  });
});

test('resolved dependency upgrade retains consumers of removed snapshots',()=>{
  const before=fixture(),after=fixture();
  after.importers['packages/provider'].dependencies.alpha={specifier:'2.0.0',version:'2.0.0'};
  delete after.packages['alpha@1.0.0'];delete after.snapshots['alpha@1.0.0'];
  after.packages['alpha@2.0.0']={resolution:{integrity:'sha512-dXBncmFkZWQ='}};
  after.snapshots['alpha@2.0.0']={dependencies:{leaf:'1.0.0'}};
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
});

test('indirect graph cycles are finite and retain all resolved inputs',()=>{
  const before=fixture();before.snapshots['leaf@1.0.0'].dependencies={alpha:'1.0.0'};
  const after=structuredClone(before);after.packages['leaf@1.0.0'].hasBin=true;
  assert.deepEqual(delta(before,after).importers,['packages/consumer','packages/provider']);
});

test('lock graph and nested input records cannot change after parsing',()=>{
  const lock=parse(fixture());
  assert.throws(()=>{lock.packages['leaf@1.0.0'].resolution.integrity='changed';},TypeError);
  assert.throws(()=>{lock.closures['packages/provider'].snapshots.pop();},TypeError);
});

test('an otherwise valid lock cannot hide trailing input after a complete flow value', () => {
  const source = encode(fixture()).replace(/\n$/, ' ignored\n');
  assert.throws(() => parseLock(source), /pnpm-lock.yaml: Trailing unsupported input ignored/);
});

test('non-ASCII blank characters remain part of a plain YAML scalar', () => {
  const before = fixture(), after = fixture();
  after.importers['packages/provider'].dependencies.alpha.specifier = '1.0.0\u00a0';
  const block = encode(after).replace('"specifier":"1.0.0 "', '"specifier": 1.0.0 ');
  assert.deepEqual(changedImporters(parse(before), parseLock(block)).importers, ['packages/consumer', 'packages/provider']);
  for (const tail of [' ', ' ', ' ']) {
    const source = encode(before).replace('"integrity":"sha512-YQ=="', `"integrity": sha512-YQ==${tail}`);
    assert.throws(() => parseLock(source), /Invalid integrity/);
  }
  const line = encode(before).replace('"integrity":"sha512-YQ=="', '"integrity": sha512-YQ== ');
  assert.throws(() => parseLock(line), /Invalid integrity/);
  const leading = encode(before).replace('"integrity":"sha512-YQ=="', '"integrity":  sha512-YQ==');
  assert.throws(() => parseLock(leading), /Invalid integrity/);
  const blockRecord = `packages:
  compiler@1.0.0:
    resolution: {integrity: sha512-Yw==}
  alpha@1.0.0:
    resolution:
      integrity: sha512-YQ== 
  leaf@1.0.0:
    resolution: {integrity: sha512-bA==}
  beta@1.0.0:
    resolution: {integrity: sha512-Yg==}`;
  assert.throws(() => parseLock(encode(before).replace(/^packages:.*$/m, blockRecord)), /Invalid integrity/);
});

test('plain block and flow keys require YAML separation before a nonempty value', () => {
  const source = encode(fixture());
  assert.throws(() => parseLock(source.replace('lockfileVersion: ', 'lockfileVersion:')), /separation/);
  const settings = 'settings: {autoInstallPeers:true, excludeLinksFromLockfile: false}';
  assert.throws(() => parseLock(source.replace(/^settings:.*$/m, settings)), /separation/);
});

test('importer optional dependencies retain all consumers even when another importer keeps the record reachable', () => {
  const before = fixture();
  before.importers['packages/provider'].optionalDependencies = {beta: {specifier: '1.0.0', version: '1.0.0'}};
  const after = structuredClone(before);
  after.packages['beta@1.0.0'].hasBin = true;
  assert.deepEqual(delta(before, after).importers, ['packages/consumer', 'packages/provider', 'packages/unrelated']);
});

test('indented YAML nesting is bounded independently of flow nesting', () => {
  const source = Array.from({length: 36}, (_, index) => '  '.repeat(index) + 'nested:').join('\n') + '\n' + '  '.repeat(36) + 'value: true\n';
  assert.throws(() => parseLock(source), /depth exceeds 32/);
});

test('dense linked importer graphs stop at the visit budget', () => {
  const value = fixture();
  value.importers = {'.': {}}; value.packages = {}; value.snapshots = {};
  for (let index = 0; index < 80; index++) {
    const dependencies = Object.fromEntries(Array.from({length: 80}, (_, other) => [`member${other}`, {specifier: 'workspace:*', version: `link:../member${other}`} ]));
    value.importers[`packages/member${index}`] = {dependencies};
  }
  assert.throws(() => parse(value), /Resolved graph size exceeds 500000/);
});

test('long linked importer identities cannot cause unbounded fingerprint expansion', () => {
  const value = fixture();
  value.importers = {'.': {}}; value.packages = {}; value.snapshots = {};
  const ids = Array.from({length: 400}, (_, index) => `member${index}-` + 'x'.repeat(200));
  for (let index = 0; index < ids.length; index++) value.importers[`packages/${ids[index]}`] = {
    dependencies: {next: {specifier: 'workspace:*', version: `link:../${ids[(index + 1) % ids.length]}`}},
  };
  assert.throws(() => parse(value), /fingerprint input size exceeds 32 MiB/);
});
