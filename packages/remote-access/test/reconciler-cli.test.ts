import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test} from 'node:test';
import {crypto as acmeCrypto} from 'acme-client';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {verifyManifest} from '../src/manifest.ts';

let db:Awaited<ReturnType<typeof database>>,root:string,databaseUrl:string,subnet=50;
const peerKey=()=>randomBytes(32).toString('base64');
before(async()=>{db=await database();root=await mkdtemp(join(tmpdir(),'cloud-reconciler-cli-'));const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+db.schema);databaseUrl=url.toString();});
after(async()=>{await db?.close();await rm(root,{recursive:true,force:true});});

async function fixture(){
 const store=new RemoteAccessStore(db.pool),cellId=randomUUID(),signing=generateKeyPairSync('ed25519'),output=join(root,`${cellId}.json`),signingKeyFile=join(root,`${cellId}.key`),accountKeyFile=join(root,'account.key'),dnsModule=join(root,'dns.mjs');
 await store.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:`cell-${cellId}.example.test`,subnet:++subnet,publicKey:peerKey(),endpoint:`gateway-${cellId}.example.test:51820`});
 await writeFile(signingKeyFile,signing.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});await writeFile(accountKeyFile,await acmeCrypto.createPrivateKey(),{mode:0o600});
 await writeFile(dnsModule,"export default {present:async()=>{},remove:async()=>{}};\n",{mode:0o600});
 const configFile=join(root,`${cellId}.config.json`);await writeFile(configFile,JSON.stringify({routes:[{cellId,output,signingKeyFile}],certificates:[],acme:{directoryUrl:'https://acme.example.test/directory',email:'local@example.test',accountKeyFile,dnsModule}}),{mode:0o600});
 return {cellId,signing,output,configFile};
}
function run(...args:string[]){return spawnSync(process.execPath,['src/reconciler-cli.ts',...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,DATABASE_URL:databaseUrl}});}

test('trusted CLI arguments, once and status are strict and redact configuration failures',async()=>{
 const missing=run();assert.equal(missing.status,1);assert.equal(missing.stdout,'');assert.equal(missing.stderr,'Remote configuration reconciler failed; check its trusted configuration and database migrations\n');
 const value=await fixture(),once=run(value.configFile,'--once');assert.equal(once.status,0,once.stderr);assert.equal(JSON.parse(once.stdout).enabled,1);
 const envelope=JSON.parse(await readFile(value.output,'utf8'));assert.equal(verifyManifest(envelope,value.signing.publicKey,value.cellId).routes.length,0);
 const status=run(value.configFile,'--status');assert.equal(status.status,0,status.stderr);assert.deepEqual(JSON.parse(status.stdout),{enabled:1,due:0,running:0,failed:0,oldestDueAt:null});
 const extra=run(value.configFile,'--bad');assert.equal(extra.status,1);assert.equal(extra.stderr,'Remote configuration reconciler failed; check its trusted configuration and database migrations\n');
});

test('a missing exact route mapping fails only that target with a redacted code',async()=>{
 const configured=await fixture(),store=new RemoteAccessStore(db.pool),unmapped=randomUUID();
 await store.createCell({id:unmapped,country:'ES',provider:'aws',environment:'test',suffix:`cell-${unmapped}.example.test`,subnet:++subnet,publicKey:peerKey(),endpoint:`gateway-${unmapped}.example.test:51820`});
 const results=[run(configured.configFile,'--once'),run(configured.configFile,'--once')];for(const result of results)assert.equal(result.status,0,result.stderr);
 const row=(await db.pool.query("SELECT status,last_error FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[unmapped])).rows[0];assert.deepEqual(row,{status:'pending',last_error:'reconcile_failed'});
 assert.doesNotMatch(results.map(result=>result.stdout+result.stderr).join(''),/mapping|ENOENT|private|\/Users\//);
});

test('continuous mode exits cleanly on SIGTERM',async()=>{
 const value=await fixture(),child=spawn(process.execPath,['src/reconciler-cli.ts',value.configFile],{cwd:new URL('..',import.meta.url),env:{...process.env,DATABASE_URL:databaseUrl},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
 let ready=false;for(let attempt=0;attempt<50;attempt++){if((await db.pool.query("SELECT 1 FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[value.cellId])).rowCount){ready=true;break;}if(child.exitCode!==null)break;await delay(100);}
 assert.equal(ready,true,output);child.kill('SIGTERM');const code=await new Promise(resolve=>child.once('exit',resolve));assert.equal(code,0,output);
});

test('database staff mode is explicit and cannot coexist with a staff file mapping',async()=>{
 const value=await fixture(),config=JSON.parse(await readFile(value.configFile,'utf8'));
 for(const staffExchange of ['yes',1,null]){await writeFile(value.configFile,JSON.stringify({...config,staffExchange}));assert.equal(run(value.configFile,'--status').status,1);}
 await writeFile(value.configFile,JSON.stringify({...config,staffExchange:true}));assert.equal(run(value.configFile,'--status').status,0);
 await writeFile(value.configFile,JSON.stringify({...config,staffExchange:true,certificates:[{installationId:randomUUID(),kind:'staff',csrFile:join(root,'staff.csr'),output:join(root,'staff.crt')}]}));assert.equal(run(value.configFile,'--status').status,1);
});
