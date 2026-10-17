import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as grading from './build-grading.ts';
import {gradeKey,type GradedSet} from './scorer.ts';

test('grading shows only fresh missing names, once, sorted with run provenance',()=>{
 assert.equal(typeof grading.gradingPage,'function','gradingPage must exist');
 const set:GradedSet={products:[{id:'p01',internal:'COFFEE',category:'Drinks',existing:{en:'Given'}}],
  grades:new Map([[gradeKey('p01','ca','Marked'),'fix']]),shown:new Set([gradeKey('p01','es','Seen')])};
 const fresh='New </script> $& name';
 const {html,keys}=grading.gradingPage(set,[
  {file:'a.json',names:{p01:{ca:'Marked',es:'Seen',en:'Changed given'}}},
  {file:'b.json',names:{p01:{ca:fresh,es:'Zulu'}}},
  {file:'c.json',names:{p01:{ca:'  '+fresh+'  ',es:'Alpha'}}},
 ],'<script>const PRODUCTS = /*DATA*/[];const DONE = "done-/*ROUND*/";</script>','r2');
 const page=JSON.parse(/const PRODUCTS = (.*?);const DONE/s.exec(html)![1]!);
 assert.deepEqual(page,[{id:'p01',internal:'COFFEE',category:'Drinks',given:{en:'Given'},names:{
  ca:[{k:gradeKey('p01','ca',fresh),t:fresh,new:true}],
  es:[{k:gradeKey('p01','es','Alpha'),t:'Alpha',new:true},{k:gradeKey('p01','es','Zulu'),t:'Zulu',new:true}],en:[],fix:[],
 }}]);
 assert.deepEqual(keys[gradeKey('p01','ca',fresh)],{pid:'p01',lang:'ca',text:fresh,runs:['b.json','c.json']});
 assert.equal(html.includes('</script> $&'),false);assert.ok(html.includes('const DONE = "done-r2"'));
});
test('placeholder output has no names to grade and malformed round/template cannot inject script',()=>{
 assert.equal(typeof grading.gradingPage,'function','gradingPage must exist');
 const set:GradedSet={products:[{id:'p',internal:'SPECIAL',category:null}],grades:new Map(),shown:new Set()};
 const template='const PRODUCTS = /*DATA*/[]; const DONE = "done-/*ROUND*/";';
 assert.deepEqual(grading.gradingPage(set,[{file:'x',names:{p:{placeholder:true,ca:'Invented'}}}],template,'r1').keys,{});
 assert.throws(()=>grading.gradingPage(set,[],template,'r1";alert(1);//'),/round/);
 assert.throws(()=>grading.gradingPage(set,[],'no data marker','r1'),/template/);
});

test('the command refuses failed, wrong-set, malformed and repeated files before replacing a page',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {fileURLToPath}=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'translation-grading-cli-'));
 const cli=fileURLToPath(new URL('./build-grading.ts',import.meta.url));
 const page=new URL('./grading-blind.html',import.meta.url),keys=new URL('./grading-blind-keys.json',import.meta.url);
 const beforePage=existsSync(page)?readFileSync(page):undefined,beforeKeys=existsSync(keys)?readFileSync(keys):undefined;
 try{
  const file=join(dir,'run.json');writeFileSync(file,JSON.stringify({set:'blind',failed:[],names:{f01:{ca:'Fresh name'}}}));
  const run=(args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:tmpdir(),encoding:'utf8'});
  const good=run(['--set','blind','--round','r2',file]);
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/1 new names/);
  const html=readFileSync(page,'utf8'),shown=JSON.parse(readFileSync(keys,'utf8'));
  assert.deepEqual(shown,{[gradeKey('f01','ca','Fresh name')]:{pid:'f01',lang:'ca',text:'Fresh name',runs:['run.json']}});
  for(const result of [{names:null},{names:[]},{names:'invalid'},{error:'failed',names:{}},{failed:['f01'],names:{}},{set:'tuning',names:{}},{names:{f01:null}},{names:{f01:{ca:4}}},{names:{unknown:{ca:'Name'}}}]){
   writeFileSync(file,JSON.stringify(result));
   assert.notEqual(run(['--set','blind',file]).status,0,JSON.stringify(result));
   assert.equal(readFileSync(page,'utf8'),html);assert.deepEqual(JSON.parse(readFileSync(keys,'utf8')),shown);
  }
  for(const args of [[],['--set','blind'],['--set','blind',file,file],['--set','blind','--round','r1','--round','r2',file],['--set','blind','--round','bad"round',file]])assert.notEqual(run(args).status,0);
 }finally{
  if(beforePage)writeFileSync(page,beforePage);else rmSync(page,{force:true});
  if(beforeKeys)writeFileSync(keys,beforeKeys);else rmSync(keys,{force:true});
  rmSync(dir,{recursive:true,force:true});
 }
});
