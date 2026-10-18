import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile,chmod} from 'node:fs/promises';
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
