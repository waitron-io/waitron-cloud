import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {test} from 'node:test';
import {addScores,gradeKey,gradeRun,loadSet,scoreLine,type GradedSet,type Score} from './scorer.ts';
const shownFile=(name:'tuning'|'blind')=>JSON.parse(readFileSync(new URL(`./data/${name}-shown.json`,import.meta.url),'utf8')) as Record<string,{pid:string;lang:string;text:string}>;
test('the copied grades all decode to their own file names',()=>{
 for(const name of ['tuning','blind'] as const){
  const dir=new URL(`./data/${name}-grades/`,import.meta.url);
  for(const file of readdirSync(dir)){const g=JSON.parse(readFileSync(new URL(file,dir),'utf8'));assert.equal(gradeKey(g.pid,g.lang,g.text)+'.json',file);}
 }
});
test('the sets have the sizes the trial graded',()=>{
 const tuning=loadSet('tuning'),blind=loadSet('blind');
 assert.deepEqual([tuning.products.length,tuning.grades.size,tuning.shown.size],[32,110,347]);
 assert.deepEqual([blind.products.length,blind.grades.size,blind.shown.size],[30,31,153]);
});
test("grade_run's own case: marks count by verdict and a kept given name is skipped",()=>{
 const set:GradedSet={products:[{id:'p01',internal:'X',category:'X'},{id:'p27',internal:'Y',category:'X',existing:{en:'Given'}}],
  grades:new Map([[gradeKey('p01','en','C'),'wrong'],[gradeKey('p27','es','E'),'fix']]),
  shown:new Set(['A','B','C','D','E'].map((t,i)=>gradeKey(i<3?'p01':'p27',['ca','es','en','ca','es'][i]!,t)))};
 const got=gradeRun({p01:{ca:'A',es:'B',en:'C'},p27:{ca:'D',es:'E',en:'Given'}},set);
 assert.deepEqual([got.names,got.fix,got.wrong,got.ungraded],[5,1,1,0]);
});
test('a name never shown is ungraded, not accepted',()=>{
 const set=loadSet('blind'),p=set.products[0]!;
 const got=gradeRun({[p.id]:{ca:'A name nobody has seen',es:'',en:''}},set);
 assert.deepEqual([got.names,got.fix,got.wrong,got.ungraded],[1,0,0,1]);
 assert.deepEqual(got.ungradedNames,[{pid:p.id,lang:'ca',text:'A name nobody has seen'}]);
});
test('a shown and unmarked name is accepted, and a marked one counts by its verdict',()=>{
 const set=loadSet('tuning'),given=(pid:string,lang:string)=>set.products.find(p=>p.id===pid)?.existing?.[lang];
 const entries=Object.entries(shownFile('tuning')).filter(([,v])=>v.lang!=='fix'&&v.text!==given(v.pid,v.lang));
 const [markedKey,marked]=entries.find(([k])=>set.grades.has(k))!;
 const [,accepted]=entries.find(([k,v])=>!set.grades.has(k)&&(v.pid!==marked.pid||v.lang!==marked.lang))!;
 const names:Record<string,Record<string,string>>={};
 for(const v of [marked,accepted])(names[v.pid]??={})[v.lang]=v.text;
 const got=gradeRun(names,set),verdict=set.grades.get(markedKey)!;
 assert.deepEqual([got.names,got.ungraded,got[verdict],got.fix+got.wrong],[2,0,1,1]);
});
test("rescoring the trial's fourth prompt with the Luna review gives grade_run's counts",()=>{
 // Counts from the original: grade_run over the same three files for each set, run with python3 -I on 2026-10-14.
 for(const [name,expected] of [['tuning',{names:252,fix:6,wrong:10}],['blind',{names:243,fix:5,wrong:6}]] as const){
  const set=loadSet(name),dir=new URL(`./data/trial-results/${name}/`,import.meta.url);
  let total:Score={names:0,fix:0,wrong:0,ungraded:0,ungradedNames:[]};
  for(const file of readdirSync(dir).sort())total=addScores(total,gradeRun(JSON.parse(readFileSync(new URL(file,dir),'utf8')).names,set));
  assert.deepEqual([total.names,total.fix,total.wrong,total.ungraded],[expected.names,expected.fix,expected.wrong,0]);
 }
});
test('a score line shows the shares the spec reports',()=>{
 assert.equal(scoreLine('total',{names:252,fix:6,wrong:10,ungraded:0,ungradedNames:[]}),'| total | 252 | 2% | 4% | 6% | 0 |');
 assert.equal(scoreLine('total',{names:243,fix:5,wrong:6,ungraded:0,ungradedNames:[]}),'| total | 243 | 2% | 2% | 5% | 0 |');
});
