import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,realpathSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {TranslationKind} from '../src/index.ts';
export type SetName='tuning'|'blind';
export const languages=['ca','es','en'] as const;
export interface Product {id:string;internal:string;category:string|null;existing?:Record<string,string>;kind?:TranslationKind;family?:string}
export interface GradedSet {products:Product[];grades:Map<string,'fix'|'wrong'>;shown:Set<string>}
export interface Score {names:number;fix:number;wrong:number;ungraded:number;ungradedNames:{pid:string;lang:string;text:string}[]}
const data=new URL('./data/',import.meta.url);
export function gradeKey(pid:string,lang:string,text:string){return createHash('sha1').update(`${pid}\u001f${lang}\u001f${text}`,'utf8').digest('hex').slice(0,16);}
export function loadSet(name:SetName):GradedSet{
 const products=JSON.parse(readFileSync(new URL(`${name}-products.json`,data),'utf8')) as Product[];
 const dir=new URL(`${name}-grades/`,data),grades=new Map<string,'fix'|'wrong'>();
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.json')).sort()){
  const g=JSON.parse(readFileSync(new URL(file,dir),'utf8')) as {pid:string;lang:string;text:string;verdict:'fix'|'wrong'};
  grades.set(gradeKey(g.pid,g.lang,g.text),g.verdict);
 }
 return {products,grades,shown:new Set(Object.keys(JSON.parse(readFileSync(new URL(`${name}-shown.json`,data),'utf8'))))};
}
export function gradeRun(names:Record<string,Record<string,unknown>>,set:GradedSet):Score{
 const out:Score={names:0,fix:0,wrong:0,ungraded:0,ungradedNames:[]};
 for(const p of set.products){
  const got=names[p.id]??{},given=p.existing??{};
  for(const lang of languages){
   const value=got[lang],text=typeof value==='string'?value.trim():'';
   if(!text||text===given[lang])continue;
   out.names++;
   const key=gradeKey(p.id,lang,text),verdict=set.grades.get(key);
   if(verdict)out[verdict]++;
   else if(!set.shown.has(key)){out.ungraded++;out.ungradedNames.push({pid:p.id,lang,text});}
  }
 }
 return out;
}
export function addScores(a:Score,b:Score):Score{
 return {names:a.names+b.names,fix:a.fix+b.fix,wrong:a.wrong+b.wrong,ungraded:a.ungraded+b.ungraded,ungradedNames:[...a.ungradedNames,...b.ungradedNames]};
}
const percent=(part:number,whole:number)=>whole?`${Math.round(part/whole*100)}%`:'-';
export function scoreLine(label:string,s:Score){return `| ${label} | ${s.names} | ${percent(s.fix,s.names)} | ${percent(s.wrong,s.names)} | ${percent(s.fix+s.wrong,s.names)} | ${s.ungraded} |`;}
function main(args:string[]){
 const at=args.indexOf('--set'),name=args[at+1];
 const usage='usage: node quality/scorer.ts --set tuning|blind <results files…>';
 if(at<0||(name!=='tuning'&&name!=='blind'))throw new Error(usage);
 const files=args.filter((_,i)=>i!==at&&i!==at+1);
 if(!files.length)throw new Error(usage);
 if(new Set(files.map(file=>realpathSync(file))).size!==files.length)throw new Error('Repeated result file');
 const set=loadSet(name),ids=new Set(set.products.map(p=>p.id));
 const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const inputs=files.map(file=>{
  const result:unknown=JSON.parse(readFileSync(file,'utf8'));
  if(!record(result)||!record(result.names)||!Object.values(result.names).every(record))
   throw new Error(`Invalid names map: ${file}`);
  if(Object.hasOwn(result,'error')||(Object.hasOwn(result,'failed')&&(!Array.isArray(result.failed)||result.failed.length>0)))
   throw new Error(`Failed trial: ${file}`);
  if(Object.hasOwn(result,'set')&&result.set!==name)throw new Error(`Wrong graded set: ${file}`);
  const names=result.names as Record<string,Record<string,unknown>>;
  for(const [pid,entry] of Object.entries(names)){
   if(!ids.has(pid))throw new Error(`Unknown product: ${file}: ${pid}`);
   if(languages.some(lang=>Object.hasOwn(entry,lang)&&typeof entry[lang]!=='string'))
    throw new Error(`Non-text name: ${file}: ${pid}`);
  }
  const score=gradeRun(names,set);
  if(!score.names)throw new Error(`No written names to score: ${file}`);
  let absent=0,missing=0;
  for(const p of set.products){
   if(languages.every(lang=>Object.hasOwn(p.existing??{},lang)))continue;
   const got=names[p.id];
   if(!got)absent++;
   if(got?.placeholder===true)continue;
   for(const lang of languages)if(!Object.hasOwn(p.existing??{},lang)&&!(typeof got?.[lang]==='string'&&got[lang].trim()))missing++;
  }
  return {file,score,absent,missing};
 });
 let total:Score={names:0,fix:0,wrong:0,ungraded:0,ungradedNames:[]};
 console.log('| run | names | needs work | wrong | marked | ungraded |');console.log('|---|---|---|---|---|---|');
 for(const {file,score,absent,missing} of inputs){
  if(absent||missing)console.error(`incomplete: ${basename(file)}: ${absent} products absent, ${missing} names missing`);
  total=addScores(total,score);console.log(scoreLine(basename(file),score));
 }
 console.log(scoreLine('total',total));
 for(const n of total.ungradedNames)console.log(`ungraded: ${n.pid} ${n.lang} ${n.text}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2));
