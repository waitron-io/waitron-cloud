import {readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gradeKey,languages,loadSet,type GradedSet} from './scorer.ts';
type Owner={pid:string;lang:string;text:string;runs:string[]};
type Run={file:string;names:Record<string,Record<string,unknown>>};
export function gradingPage(set:GradedSet,runs:Run[],template:string,round:string):{html:string;keys:Record<string,Owner>}{
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(round))throw new Error('Invalid grading round');
 if(template.split('/*DATA*/[]').length!==2||template.split('/*ROUND*/').length!==2)throw new Error('Invalid grading template');
 const owners=new Map<string,Owner>();
 for(const run of runs)for(const p of set.products){
  const got=run.names[p.id]??{},given=p.existing??{};
  if(got.placeholder===true)continue;
  for(const lang of languages){
   const value=got[lang],text=typeof value==='string'?value.trim():'';
   if(!text||Object.hasOwn(given,lang))continue;
   const key=gradeKey(p.id,lang,text);
   if(set.grades.has(key)||set.shown.has(key))continue;
   const owner=owners.get(key)??{pid:p.id,lang,text,runs:[]};
   if(!owner.runs.includes(run.file))owner.runs.push(run.file);
   owners.set(key,owner);
  }
 }
 const cell=(pid:string,lang:string)=>[...owners].filter(([,o])=>o.pid===pid&&o.lang===lang)
  .sort(([,a],[,b])=>a.text<b.text?-1:a.text>b.text?1:0).map(([k,o])=>({k,t:o.text,new:true}));
 const page=set.products.map(p=>({id:p.id,internal:p.internal,category:p.category,given:p.existing??{},
  names:{...Object.fromEntries(languages.map(lang=>[lang,cell(p.id,lang)])),fix:[]}}));
 const data=JSON.stringify(page).replaceAll('<','\\u003c');
 return {html:template.replace('/*DATA*/[]',()=>data).replace('/*ROUND*/',()=>round),keys:Object.fromEntries(owners)};
}
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function main(args:string[]){
 const usage='usage: node quality/build-grading.ts --set tuning|blind [--round <name>] <results files…>';
 const flags=new Map<string,string>(),files:string[]=[];
 for(let i=0;i<args.length;i++){
  const arg=args[i]!;
  if(arg.startsWith('--')){
   const value=args[++i];
   if(!['--set','--round'].includes(arg)||flags.has(arg)||!value||value.startsWith('--'))throw new Error(usage);
   flags.set(arg,value);
  }else files.push(arg);
 }
 const name=flags.get('--set'),round=flags.get('--round')??'r1';
 if((name!=='tuning'&&name!=='blind')||!files.length)throw new Error(usage);
 if(new Set(files.map(f=>realpathSync(f))).size!==files.length)throw new Error('Repeated result file');
 const set=loadSet(name),ids=new Set(set.products.map(p=>p.id));
 const runs:Run[]=files.map(file=>{
  const result:unknown=JSON.parse(readFileSync(file,'utf8'));
  if(!record(result)||!record(result.names)||!Object.values(result.names).every(record))throw new Error('Invalid names map');
  if(Object.hasOwn(result,'error')||(Object.hasOwn(result,'failed')&&(!Array.isArray(result.failed)||result.failed.length)))throw new Error('Failed trial');
  if(Object.hasOwn(result,'set')&&result.set!==name)throw new Error('Wrong graded set');
  const names=result.names as Run['names'];
  for(const [pid,entry] of Object.entries(names)){
   if(!ids.has(pid)||languages.some(l=>Object.hasOwn(entry,l)&&typeof entry[l]!=='string'))throw new Error('Invalid product name');
  }
  return {file:basename(file),names};
 });
 const {html,keys}=gradingPage(set,runs,readFileSync(new URL('./page.template.html',import.meta.url),'utf8'),round);
 writeFileSync(new URL(`./grading-${name}.html`,import.meta.url),html,{mode:0o600});
 writeFileSync(new URL(`./grading-${name}-keys.json`,import.meta.url),JSON.stringify(keys,null,1)+'\n',{mode:0o600});
 console.log(`${Object.keys(keys).length} new names -> quality/grading-${name}.html`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2));
