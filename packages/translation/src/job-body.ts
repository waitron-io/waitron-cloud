import {TranslationError,type TranslationErrorCode} from './errors.ts';
function fail(code:TranslationErrorCode):never{throw new TranslationError(code);}
import {maxJobItems} from './submit-proof.ts';
export const translationKinds=['product','variant','option_list','option_label','extra_list','menu','section','included_menu','unit'] as const;
export type TranslationKind=typeof translationKinds[number];
export interface JobItem {ref:string;kind:TranslationKind;family:string;category:string|null;staffName:string;existing:Record<string,string>;missing:string[]}
export interface HouseStyleName {kind:TranslationKind;staffName:string;names:Record<string,string>}
export interface ParsedJob {country:string;languages:{default:string;enabled:string[]};items:JobItem[];houseStyle:HouseStyleName[]}
const languageNames=new Intl.DisplayNames(['en'],{type:'language'}),regionNames=new Intl.DisplayNames(['en'],{type:'region'});
const categorised:readonly TranslationKind[]=['product','variant'];
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function bounded(value:unknown,max:number):value is string{return typeof value==='string'&&value.length>=1&&value.length<=max;}
function region(value:unknown):value is string{return typeof value==='string'&&/^[A-Z]{2}$/.test(value)&&value!=='ZZ'&&regionNames.of(value)!==value;}
function language(value:unknown):value is string{
 if(typeof value!=='string'||value==='und'||!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value))return false;
 try{return languageNames.of(value)!==value;}catch{return false;}
}
function kind(value:unknown):TranslationKind{if(!(translationKinds as readonly unknown[]).includes(value))fail('invalid_request');return value as TranslationKind;}
function names(value:unknown,enabled:ReadonlySet<string>):Record<string,string>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_request');
 const out:Record<string,string>={};
 for(const [lang,text] of Object.entries(value)){if(!enabled.has(lang)||!bounded(text,500))fail('invalid_request');out[lang]=text;}
 return out;
}
function item(raw:unknown,enabled:ReadonlySet<string>):JobItem{
 if(!exact(raw,['ref','kind','family','category','staffName','existing','missing'])||!bounded(raw.ref,128)||!bounded(raw.family,128)
  ||!bounded(raw.staffName,500)||!Array.isArray(raw.missing))fail('invalid_request');
 const itemKind=kind(raw.kind),category=raw.category;
 if(category!==null&&!(categorised.includes(itemKind)&&bounded(category,500)))fail('invalid_request');
 const existing=names(raw.existing,enabled),missing:unknown[]=raw.missing;
 if(!missing.every(l=>typeof l==='string'&&enabled.has(l)&&!(l in existing))||new Set(missing).size!==missing.length)fail('invalid_request');
 return {ref:raw.ref,kind:itemKind,family:raw.family,category:category as string|null,staffName:raw.staffName,existing,missing:missing as string[]};
}
export function parseJob(text:string):ParsedJob{
 let value:unknown;try{value=JSON.parse(text);}catch{return fail('invalid_request');}
 if(!exact(value,['version','country','languages','items','houseStyle'])||value.version!==1||!region(value.country))fail('invalid_request');
 const langs=value.languages;
 if(!exact(langs,['default','enabled'])||!Array.isArray(langs.enabled)||langs.enabled.length<1||langs.enabled.length>20
  ||!langs.enabled.every(language)||new Set(langs.enabled).size!==langs.enabled.length||typeof langs.default!=='string'||!langs.enabled.includes(langs.default))fail('invalid_request');
 const enabled=new Set<string>(langs.enabled as string[]);
 if(!Array.isArray(value.items))fail('invalid_request');
 if(value.items.length>maxJobItems)fail('job_too_large');
 if(value.items.length<1)fail('invalid_request');
 const items=value.items.map((raw:unknown)=>item(raw,enabled));
 if(new Set(items.map(i=>i.ref)).size!==items.length||!items.some(i=>i.missing.length))fail('invalid_request');
 for(const head of items)if(!head.missing.length&&(head.ref!==head.family||!items.some(member=>member!==head&&member.family===head.ref&&member.missing.length)))fail('invalid_request');
 if(!Array.isArray(value.houseStyle)||value.houseStyle.length>300)fail('invalid_request');
 const houseStyle=value.houseStyle.map((raw:unknown):HouseStyleName=>{
  if(!exact(raw,['kind','staffName','names'])||!bounded(raw.staffName,500))fail('invalid_request');
  return {kind:kind(raw.kind),staffName:raw.staffName,names:names(raw.names,enabled)};
 });
 return {country:value.country,languages:{default:langs.default,enabled:[...enabled]},items,houseStyle};
}
export function writtenItems(job:ParsedJob):JobItem[]{return job.items.filter(i=>i.missing.length>0);}
