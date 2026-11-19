import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,stat,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
const roots=[];test.afterEach(async()=>Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true}))));
async function api(){return import('./bootstrap.mjs').catch(()=>({}));}
async function root(){const p=await mkdtemp(join(tmpdir(),'cloud-lan-bootstrap-'));roots.push(p);return p;}
// Removing persistence or certificate/permission validation must break these outcomes.
test('private CA and matching LAN certificate survive concurrent bootstrap and restart',async()=>{
 const {bootstrapTestCloud}=await api();assert.equal(typeof bootstrapTestCloud,'function','LAN bootstrap is missing');
 const dir=await root();const [a,b]=await Promise.all([bootstrapTestCloud(dir),bootstrapTestCloud(dir)]);assert.deepEqual(a,b);
 const ca=await readFile(join(dir,'lan/ca.pem')),leaf=await readFile(join(dir,'lan/cert.pem'));
 const cert=new X509Certificate(leaf);assert.equal(cert.checkHost('waitron.local'),'waitron.local');assert.equal(cert.checkIP('192.168.10.10'),'192.168.10.10');assert.equal(cert.checkHost('other.local'),undefined);
 assert.equal(new X509Certificate(ca).ca,true);assert.equal(cert.ca,false);
 execFileSync('openssl',['verify','-CAfile',join(dir,'lan/ca.pem'),'-verify_hostname','waitron.local',join(dir,'lan/cert.pem')]);
 const before=await readFile(join(dir,'lan/proxy.pem'));assert.deepEqual(await bootstrapTestCloud(dir),a);assert.deepEqual(await readFile(join(dir,'lan/proxy.pem')),before);
 for(const name of ['ca.pem','ca-key.pem','cert.pem','key.pem','proxy.pem','identity.json'])assert.equal((await stat(join(dir,'lan',name))).mode&0o777,0o600);
 assert.equal((await stat(join(dir,'lan'))).mode&0o777,0o700);
 assert.equal(a.origin,'https://waitron.local:3000');assert.ok(!JSON.stringify(a).includes('PRIVATE KEY'));
});
test('partial or weakened private identity is refused without regeneration',async()=>{
 const {bootstrapTestCloud}=await api();assert.equal(typeof bootstrapTestCloud,'function','LAN bootstrap is missing');
 const dir=await root();await bootstrapTestCloud(dir);const before=await readFile(join(dir,'lan/ca-key.pem'));
 await chmod(join(dir,'lan/key.pem'),0o644);await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);await chmod(join(dir,'lan/key.pem'),0o600);
 await writeFile(join(dir,'lan/cert.pem'),'broken',{mode:0o600});await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);
 assert.deepEqual(await readFile(join(dir,'lan/ca-key.pem')),before);
});
test('mismatched CA private key and proxy bundle are refused while the original identity remains recoverable',async()=>{
 const {bootstrapTestCloud}=await api();assert.equal(typeof bootstrapTestCloud,'function');const dir=await root();await bootstrapTestCloud(dir);
 const keyPath=join(dir,'lan/ca-key.pem'),originalKey=await readFile(keyPath),proxyPath=join(dir,'lan/proxy.pem'),originalProxy=await readFile(proxyPath);
 await writeFile(keyPath,await readFile(join(dir,'lan/key.pem')),{mode:0o600});await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);await writeFile(keyPath,originalKey,{mode:0o600});
 await writeFile(proxyPath,await readFile(join(dir,'lan/cert.pem')),{mode:0o600});await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);await writeFile(proxyPath,originalProxy,{mode:0o600});
 assert.equal((await bootstrapTestCloud(dir)).origin,'https://waitron.local:3000');
});
test('private directory permissions and declared certificate fingerprints are independently checked',async()=>{
 const {bootstrapTestCloud}=await api(),dir=await root();await bootstrapTestCloud(dir);const path=join(dir,'lan/identity.json'),original=await readFile(path);
 await chmod(join(dir,'lan'),0o750);await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);await chmod(join(dir,'lan'),0o700);
 for(const field of ['caSha256','certificateSha256']){const value=JSON.parse(original);value[field]='0'.repeat(64);await writeFile(path,JSON.stringify(value),{mode:0o600});await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);}
 await writeFile(path,original,{mode:0o600});assert.equal((await bootstrapTestCloud(dir)).origin,'https://waitron.local:3000');
});
test('a valid matching LAN leaf and key from another CA are refused even with matching declared bytes',async()=>{
 const {bootstrapTestCloud}=await api(),dir=await root(),other=await root();await bootstrapTestCloud(dir);await bootstrapTestCloud(other);
 const {createHash}=await import('node:crypto'),cert=await readFile(join(other,'lan/cert.pem')),key=await readFile(join(other,'lan/key.pem')),value=JSON.parse(await readFile(join(dir,'lan/identity.json'),'utf8'));
 value.certificateSha256=createHash('sha256').update(cert).digest('hex');
 for(const [name,bytes] of [['cert.pem',cert],['key.pem',key],['proxy.pem',Buffer.concat([key,cert])],['identity.json',JSON.stringify(value)]])await writeFile(join(dir,'lan',name),bytes,{mode:0o600});
 await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);
});
test('leaf expiry is refused under a later clock while the CA remains current',async t=>{
 const {bootstrapTestCloud}=await api(),dir=await root();await bootstrapTestCloud(dir);
 t.mock.timers.enable({apis:['Date'],now:Date.now()+31*86400000});await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);
});
test('an expired CA is refused even while a correctly signed longer-lived leaf remains current',async t=>{
 const {bootstrapTestCloud}=await api(),dir=await root();await bootstrapTestCloud(dir);const lan=join(dir,'lan');
 await writeFile(join(dir,'leaf.ext'),'subjectAltName=DNS:waitron.local,IP:192.168.10.10\nbasicConstraints=critical,CA:FALSE\n',{mode:0o600});
 execFileSync('openssl',['req','-new','-key',join(lan,'key.pem'),'-out',join(dir,'leaf.csr'),'-subj','/CN=waitron.local'],{stdio:'ignore'});
 execFileSync('openssl',['x509','-req','-in',join(dir,'leaf.csr'),'-CA',join(lan,'ca.pem'),'-CAkey',join(lan,'ca-key.pem'),'-set_serial','2','-days','400','-extfile',join(dir,'leaf.ext'),'-out',join(lan,'cert.pem')],{stdio:'ignore'});
 const {createHash}=await import('node:crypto'),cert=await readFile(join(lan,'cert.pem')),key=await readFile(join(lan,'key.pem')),value=JSON.parse(await readFile(join(lan,'identity.json'),'utf8'));
 value.certificateSha256=createHash('sha256').update(cert).digest('hex');await writeFile(join(lan,'identity.json'),JSON.stringify(value),{mode:0o600});await writeFile(join(lan,'proxy.pem'),Buffer.concat([key,cert]),{mode:0o600});
 t.mock.timers.enable({apis:['Date'],now:Date.now()+366*86400000});await assert.rejects(bootstrapTestCloud(dir),/test_cloud.identity_invalid/);
});

// Losing either the configured name or imported certificate must break public HTTPS.
test('configured bootstrap imports a renewable certificate while retaining its private backend CA',async t=>{
 const {bootstrapTestCloud}=await api(),dir=await root(),source=await root(),origin='https://cloud.example.test';
 const issue=(host='cloud.example.test')=>execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(source,'privkey.pem'),'-out',join(source,'fullchain.pem'),'-days','2','-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host,'-addext','basicConstraints=critical,CA:FALSE'],{stdio:'ignore'});
 issue();const proxyDirectory=await root(),options={origin,certificateSource:source,certificateDirectory:proxyDirectory};
 const value=await bootstrapTestCloud(dir,options);
 assert.equal(value.origin,origin);
 const internalCA=await readFile(join(dir,'lan/ca.pem')),internalKey=await readFile(join(dir,'lan/ca-key.pem'));
 const {createHash}=await import('node:crypto');assert.equal(value.caSha256,createHash('sha256').update(internalCA).digest('hex'));
 assert.equal(new X509Certificate(await readFile(join(dir,'lan/cert.pem'))).checkHost('waitron.local'),'waitron.local');
 const first=await readFile(join(proxyDirectory,'proxy.pem'));
 assert.deepEqual(first,Buffer.concat([await readFile(join(source,'privkey.pem')),await readFile(join(source,'fullchain.pem'))]));
 assert.equal((await stat(join(proxyDirectory,'proxy.pem'))).mode&0o777,0o600);
 await assert.rejects(stat(join(dir,'proxy.cfg')),error=>error.code==='ENOENT');
 assert.deepEqual((await readdir(join(dir,'lan'))).sort(),['ca-key.pem','ca.pem','cert.pem','identity.json','key.pem','proxy.pem']);
 issue();await bootstrapTestCloud(dir,options);
 assert.notDeepEqual(await readFile(join(proxyDirectory,'proxy.pem')),first);
 assert.deepEqual(await readFile(join(dir,'lan/ca.pem')),internalCA);assert.deepEqual(await readFile(join(dir,'lan/ca-key.pem')),internalKey);
 await assert.rejects(bootstrapTestCloud(dir,{origin:'https://other.example.test',certificateSource:source,certificateDirectory:options.certificateDirectory}),/test_cloud.identity_invalid/);
 await writeFile(join(source,'privkey.pem'),await readFile(join(dir,'lan/key.pem')));
 await assert.rejects(bootstrapTestCloud(dir,options),/test_cloud.certificate_invalid/);
 issue('other.example.test');
 await assert.rejects(bootstrapTestCloud(dir,options),/test_cloud.certificate_invalid/);
 await assert.rejects(bootstrapTestCloud(await root(),{origin}),/test_cloud.certificate_source/);
 issue();t.mock.timers.enable({apis:['Date'],now:Date.now()+3*86400000});await assert.rejects(bootstrapTestCloud(dir,options),/test_cloud.certificate_invalid/);
});

test('public-only internal leaf permits day61 renewal and retains the existing one-year CA limit',async t=>{
 const {bootstrapTestCloud}=await api(),dir=await root(),source=await root(),options={origin:'https://cloud.example.test',certificateSource:source,certificateDirectory:join(dir,'proxy-only')};
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(source,'privkey.pem'),'-out',join(source,'fullchain.pem'),'-days','90','-subj','/CN=cloud.example.test','-addext','subjectAltName=DNS:cloud.example.test','-addext','basicConstraints=critical,CA:FALSE'],{stdio:'ignore'});
 const identity=await bootstrapTestCloud(dir,options),now=Date.now();
 t.mock.timers.enable({apis:['Date'],now:now+61*86400000});assert.deepEqual(await bootstrapTestCloud(dir,options),identity);
 t.mock.timers.setTime(now+366*86400000);await assert.rejects(bootstrapTestCloud(dir,options),/test_cloud.identity_invalid/);
});

test('guest certificate renewal keeps the bundle in use unless both public names validate',async()=>{
 const {bootstrapTestCloud}=await api(),dir=await root(),source=await root(),proxy=await root(),origin='https://cloud.example.test';
 const options={origin,certificateSource:source,certificateDirectory:proxy};
 const issue=names=>execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(source,'privkey.pem'),'-out',join(source,'fullchain.pem'),'-days','2','-subj','/CN=synthetic','-addext','subjectAltName='+names.map(name=>'DNS:'+name).join(','),'-addext','basicConstraints=critical,CA:FALSE'],{stdio:'ignore'});
 issue(['cloud.example.test']);await bootstrapTestCloud(dir,options);
 const first=await readFile(join(proxy,'proxy.pem'));
 const enabled={...options,guestMenu:true};
 for(const host of ['cloud.example.test','menus.cloud.example.test']){
  issue([host]);await assert.rejects(bootstrapTestCloud(dir,enabled),/test_cloud.certificate_invalid/);
  assert.deepEqual(await readFile(join(proxy,'proxy.pem')),first);
 }
 issue(['cloud.example.test','menus.cloud.example.test']);await bootstrapTestCloud(dir,enabled);
 assert.notDeepEqual(await readFile(join(proxy,'proxy.pem')),first);
 assert.deepEqual(await readFile(join(proxy,'guest-ca.pem')),await readFile(join(dir,'lan/ca.pem')));
 assert.deepEqual((await readdir(proxy)).sort(),['guest-ca.pem','proxy.pem']);
});
