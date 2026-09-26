import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
// This child restores trusted local test archives without starting a server or trading workers.
const networkDenied=await new Promise(resolve=>{
 try{const socket=createConnection({host:'127.0.0.1',port:9});socket.once('error',e=>resolve(e.code==='ERR_ACCESS_DENIED'));socket.once('connect',()=>{socket.destroy();resolve(false);});}
 catch(e){resolve(e.code==='ERR_ACCESS_DENIED');}
});
assert(networkDenied);
let input='';for await(const chunk of process.stdin){input+=chunk;assert(Buffer.byteLength(input)<=65536);}
const request=JSON.parse(input),root=request.root;
const denied=async operation=>{try{await operation();return false;}catch(error){return error.code==='ERR_ACCESS_DENIED';}};
const hostReadDenied=await denied(()=>readFile('/etc/hosts'));
const outsideWriteDenied=await denied(()=>writeFile(join(root,'..','cloud-verify-forbidden'),'forbidden'));
let childProcessDenied=false;try{const child=spawn(process.execPath,['-e',''],{stdio:'ignore'});child.kill();}catch(error){childProcessDenied=error.code==='ERR_ACCESS_DENIED';}
assert(hostReadDenied&&outsideWriteDenied&&childProcessDenied);
const load=name=>import(pathToFileURL(join(request.checkout,'apps/server/src',name)).href);
const {validateArtifact,writeValidated}=await load('restore.ts');
const {ALL_MODULES}=await load('modules.ts');
const {parseEnvFile}=await load('env-file.ts');
const artifact=await readFile(join(root,'input.backup.enc'));
const validation={artifact,recoveryKey:request.recoveryKey,stateDir:root,stagingDir:join(root,'backup-staging'),modules:ALL_MODULES,migrationsRoot:null,environment:'preproduction'};
const checked=await validateArtifact(validation);
assert.deepEqual(checked.manifest.modules,request.modules);
assert.equal(new Date(checked.manifest.createdAt).toISOString(),new Date(request.capturedAt).toISOString());
const trading=checked.secretEntries.find(e=>e.name==='secrets/trading.env');assert(trading);
assert.equal(parseEnvFile(Buffer.from(trading.bytes).toString()).WAITRON_TILL_NODE_ID,request.sourceNodeId);
assert(!checked.secretEntries.some(e=>e.name.includes('cloud-connection')||e.name.includes('cloud-staff')));
const sideFile=join(root,'integrity.db');await writeFile(sideFile,checked.dumpEntry.bytes,{mode:0o600});
try{const db=new DatabaseSync(sideFile,{readOnly:true});try{assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(r=>r.integrity_check),['ok']);}finally{db.close();}}finally{await rm(sideFile);}
const hooks=[];await mkdir(join(root,'venue'),{mode:0o700});
await writeValidated({...checked,secretEntries:checked.secretEntries.filter(e=>e.name!=='secrets/backup.env')},{...validation,venueDir:join(root,'venue'),log:(_level,code,params)=>{if(code==='restore.hook.done')hooks.push(String(params?.module));}});
assert.deepEqual([...hooks].sort(),ALL_MODULES.filter(m=>m.backup?.restore).map(m=>m.name).sort());
const exists=async name=>{try{await stat(join(root,name));return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}};
for(const name of ['backup.env','cloud-connection.json','cloud-staff.key'])assert.equal(await exists(name),false);
console.log(JSON.stringify({networkDenied,childProcessDenied,hostReadDenied,outsideWriteDenied,integrityOk:true,hooks,cloudCredentialPresent:false,staffKeyPresent:false}));
