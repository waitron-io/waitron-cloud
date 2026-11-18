import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {FileReconcilerArtifacts} from '../src/reconciler-files.ts';

test('public key and CSR stay private while the same venue certificate reaches every cell',async t=>{
 const root=await mkdtemp(join(tmpdir(),'public-files-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const keyDirectory=join(root,'keys'),cells=[randomUUID(),randomUUID()],installationId=randomUUID(),venueId=randomUUID();
 const routes=await Promise.all(cells.map(async cellId=>{const publicCertificates=join(root,cellId);await mkdir(publicCertificates);return {cellId,output:join(root,cellId+'.json'),publicCertificates};}));
 const files=new FileReconcilerArtifacts({keyDirectory,routes}),copy={pem:'private key and chain',csr:'request'};
 assert.equal(await files.readPublicCertificate(installationId),undefined);
 await files.publishPublicCertificate(installationId,venueId,cells,copy);
 assert.deepEqual(await files.readPublicCertificate(installationId),copy);
 for(const file of [join(keyDirectory,installationId+'.public.pem'),join(keyDirectory,installationId+'.public.csr'),...routes.map(r=>join(r.publicCertificates,venueId+'.pem'))])assert.equal((await stat(file)).mode&0o777,0o600);
 for(const route of routes){assert.equal(await readFile(join(route.publicCertificates,venueId+'.pem'),'utf8'),copy.pem);assert.deepEqual(await readdir(route.publicCertificates),[venueId+'.pem']);}
 const replacement=randomUUID();await files.publishPublicCertificate(replacement,venueId,cells,{pem:'replacement key and chain',csr:'replacement request'});
 for(const route of routes){assert.deepEqual(await readdir(route.publicCertificates),[venueId+'.pem']);assert.equal(await readFile(join(route.publicCertificates,venueId+'.pem'),'utf8'),'replacement key and chain');}
});

test('an unmapped cell receives no file while the private copy and mapped delivery survive',async t=>{
 const root=await mkdtemp(join(tmpdir(),'public-files-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const cellId=randomUUID(),missing=randomUUID(),installationId=randomUUID(),venueId=randomUUID(),publicCertificates=join(root,'public'),keyDirectory=join(root,'keys');await mkdir(publicCertificates);
 const files=new FileReconcilerArtifacts({keyDirectory,routes:[{cellId,output:join(root,'routes.json'),publicCertificates}]}),copy={pem:'issued key and chain',csr:'request'};
 assert.deepEqual(await files.publishPublicCertificate(installationId,venueId,[cellId,missing],copy),{copied:[cellId],complete:false});
 assert.deepEqual(await files.readPublicCertificate(installationId),copy);assert.equal(await readFile(join(publicCertificates,venueId+'.pem'),'utf8'),copy.pem);await assert.rejects(stat(join(root,missing)),{code:'ENOENT'});
});
