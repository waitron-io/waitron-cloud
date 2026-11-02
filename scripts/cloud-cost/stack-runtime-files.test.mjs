import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepareIsolatedStack,startIsolatedStack} from './local.mjs';

test('the copied stack adapter imports every required release dependency before services start',async t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'stack-runtime-files-')));
 const source=join(parent,'source'),root=join(parent,'owned'),bin=join(parent,'bin');
 for(const path of [source,root,bin])mkdirSync(path,{mode:0o700});
 const codeRoot=join(root,'code'),stateRoot=join(root,'state');
 mkdirSync(codeRoot,{mode:0o700});mkdirSync(stateRoot,{mode:0o700});
 const token=randomBytes(32).toString('hex'),journal={token,path:join(root,'journal.json')};
 writeFileSync(join(root,'.cloud-cost-owner'),token,{mode:0o600});
 writeFileSync(journal.path,JSON.stringify({schemaVersion:1,source,root,ownershipToken:token}),{mode:0o600});
 writeFileSync(join(stateRoot,'replay-config.json'),JSON.stringify({initial:{},config:{
  localEndpoints:{s3:'http://s3:8333',postgres:'postgresql://fixture:fixture@postgres:5432/postgres',
   smtp:'smtp://mailpit:1025',fiscal:'http://fiscal:8080',gateway:'https://gateway:8443'},
  senders:{fiscal:'disabled',mail:'capture',acme:'disabled',dns:'disabled'},
 }}),{mode:0o600});
 // Refuse the first Docker command after actual file packaging and certificate generation.
 writeFileSync(join(bin,'docker'),'#!/bin/sh\nexit 19\n',{mode:0o700});
 const previousPath=process.env.PATH;process.env.PATH=bin+':'+previousPath;
 t.after(()=>{process.env.PATH=previousPath;rmSync(parent,{recursive:true,force:true});});
 const args={source,root,codeRoot,stateRoot,journal,image:'sha256:'+'a'.repeat(64)};
 const prepared=prepareIsolatedStack(args);
 await assert.rejects(startIsolatedStack({...args,prepared}),error=>error.diagnostic?.stage==='preexisting-resources');
 const script=`const adapter=await import(${JSON.stringify(pathToFileURL(join(codeRoot,'cost-waitron-adapter.mjs')).href)});
 if(typeof adapter.openReplay!=='function')throw Error('missing copied adapter');console.log('copied adapter ready');`;
 const imported=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10000});
 assert.equal(imported.status,0,imported.stderr);
 assert.equal(imported.stdout.trim(),'copied adapter ready');
});
