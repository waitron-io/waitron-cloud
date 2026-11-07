import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

const cli=new URL('../src/status-page-cli.ts',import.meta.url).pathname;
const run=(args:string[])=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000});
const fixture=(fn:(root:string,input:string,output:string)=>void)=>{
 const root=mkdtempSync(join(tmpdir(),'cloud-status-page-'));
 try{const input=join(root,'input.json');writeFileSync(input,JSON.stringify({state:'no_incident',updatedAt:'2026-11-07T10:05:00Z'}));fn(root,input,join(root,'bundle'));}
 finally{rmSync(root,{recursive:true,force:true});}
};
test('CLI writes two locally linked pages that can be opened from a new folder',()=>fixture((root,input,output)=>{
 const result=run([input,output]);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.equal(result.stdout,'Wrote status page bundle\n');
 assert.deepEqual(readdirSync(output).sort(),['es','index.html']);assert.deepEqual(readdirSync(join(output,'es')),['index.html']);
 const en=readFileSync(join(output,'index.html'),'utf8'),es=readFileSync(join(output,'es/index.html'),'utf8');
 assert.match(en,/Current service health is unverified/);assert.match(es,/no está verificado/);
 assert.equal(readFileSync(input,'utf8'),JSON.stringify({state:'no_incident',updatedAt:'2026-11-07T10:05:00Z'}));
 assert.deepEqual(readdirSync(root).sort(),['bundle','input.json']);
}));
test('invalid JSON, private input fields and invalid invocation write nothing and print fixed redacted errors',()=>fixture((_root,input,output)=>{
 for(const content of ['secret-menu@example.test',JSON.stringify({state:'no_incident',updatedAt:'2026-11-07T10:05:00Z',venueName:'Private Venue'})]){
  writeFileSync(input,content);const result=run([input,output]);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'Status page generation failed; check input and use a new output directory\n');assert.equal(existsSync(output),false);
 }
 const result=run([]);assert.equal(result.status,1);assert.equal(result.stderr,'Status page generation failed; check input and use a new output directory\n');
}));
test('an existing destination, including a symlink, is preserved',()=>fixture((root,input,output)=>{
 mkdirSync(output);writeFileSync(join(output,'keep.txt'),'keep existing work');
 const alias=join(root,'alias');symlinkSync(output,alias);
 for(const target of [output,alias]){
  const result=run([input,target]);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(readFileSync(join(output,'keep.txt'),'utf8'),'keep existing work');assert.deepEqual(readdirSync(output),['keep.txt']);
 }
}));
test('creation beneath a regular file fails without replacing the parent or producing partial output',()=>fixture((root,input,_output)=>{
 const parent=join(root,'existing-file');writeFileSync(parent,'preserved');
 const result=run([input,join(parent,'bundle')]);assert.equal(result.status,1);assert.equal(result.stderr,'Status page generation failed; check input and use a new output directory\n');assert.equal(readFileSync(parent,'utf8'),'preserved');
 assert.deepEqual(readdirSync(root).sort(),['existing-file','input.json']);
}));
