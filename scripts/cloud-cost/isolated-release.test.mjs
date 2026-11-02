import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {runIsolatedReplay} from './isolated-replay.mjs';

test('isolatedReplayRefusesOtherReleasesAndChangedInputsBeforeAnyCommand',async t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'isolated-release-')));
 const source=join(parent,'source'),root=join(parent,'owned'),bin=join(parent,'bin');
 for(const path of [source,root,bin])mkdirSync(path,{mode:0o700});
 const previousPath=process.env.PATH;
 t.after(()=>{process.env.PATH=previousPath;rmSync(parent,{recursive:true,force:true});});
 const marker=join(parent,'external-command');
 writeFileSync(join(bin,'docker'),'#!/bin/sh\nprintf touched > "'+marker+'"\nexit 19\n',{mode:0o700});
 process.env.PATH=bin+':'+previousPath;
 const token=randomBytes(32).toString('hex'),journal={token,path:join(root,'journal.json')},codeRoot=join(root,'code');
 mkdirSync(join(codeRoot,'assets'),{recursive:true,mode:0o700});
 writeFileSync(join(root,'.cloud-cost-owner'),token,{mode:0o600});
 writeFileSync(journal.path,JSON.stringify({schemaVersion:1,source,root,ownershipToken:token}),{mode:0o600});
 const runtime='export const generated=true;',font=readFileSync(new URL('./fixtures/replay-font/invoice-noto-sans.ttf',import.meta.url));
 const valid={schemaVersion:1,revision:'b1b0f10952a59eb59f7358bd681a3cdc94d9b61c',sha256:createHash('sha256').update(runtime).digest('hex')};
 const database=join(source,'venue.db');writeFileSync(database,'generated input, never opened');
 const f={source,root,journal,database,codeRoot,image:'sha256:'+'a'.repeat(64),locationId:'synthetic',windowSeconds:120,replayWindowSeconds:10,
  expected:{sales:4,paid:4,tradingDays:2,busiest:3},originalInventory:{timeZone:'Europe/Madrid',days:2,busiest:3},
  cadence:{mode:'accelerated',factor:100},initial:{},
  config:{localEndpoints:{s3:'http://s3:8333',postgres:'postgresql://fixture:fixture@postgres:5432/fixture',smtp:'smtp://mailpit:1025',fiscal:'http://fiscal:8080',gateway:'https://gateway:443'},
   senders:{fiscal:'disabled',mail:'capture',acme:'disabled',dns:'disabled'}}};
 const before=readFileSync(journal.path,'utf8');
 for(const fault of ['fbadd15785464e59747e697c11048bfbc6e4938f','99c265981ba98f1afd0e5fc822624a9a91822ad2','a'.repeat(40),'bundle','font']){
  writeFileSync(join(codeRoot,'runtime.mjs'),fault==='bundle'?'changed':runtime);
  writeFileSync(join(codeRoot,'assets/invoice-noto-sans.ttf'),fault==='font'?'changed':font);
  writeFileSync(join(codeRoot,'runtime-manifest.json'),JSON.stringify(fault.length===40?{...valid,revision:fault}:valid));
  await assert.rejects(runIsolatedReplay(f),{message:'Invalid isolated cloud cost replay'});
  assert.equal(existsSync(marker),false,'refuse '+fault+' before dispatch');
  assert.equal(readFileSync(journal.path,'utf8'),before);
 }
 writeFileSync(join(codeRoot,'assets/invoice-noto-sans.ttf'),font);
 await assert.rejects(runIsolatedReplay(f),{message:'Invalid isolated cloud cost replay'});
 assert.equal(readFileSync(marker,'utf8'),'touched','the valid release reaches only the controlled command stub');
 assert.equal(readFileSync(journal.path,'utf8'),before);
});
