import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createOpenAiClient,openAiBaseUrl,parseJob,planBatches,translateBatch,translationModel,translationPromptVersion,type BatchHooks,type ItemResult,type ParsedJob} from '../src/index.ts';
import {languages,loadSet,type GradedSet,type SetName} from './scorer.ts';

export function trialJob(set:GradedSet):ParsedJob{
 const items=set.products.map(p=>({ref:p.id,kind:p.kind??'product',family:p.family??p.id,category:p.category,staffName:p.internal,existing:p.existing??{},
  missing:languages.filter(l=>!Object.hasOwn(p.existing??{},l))})).filter(item=>item.missing.length>0);
 return parseJob(JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:[...languages]},items,houseStyle:[]}));
}
export function namesFrom(results:readonly ItemResult[]):Record<string,Record<string,unknown>>{
 return Object.fromEntries(results.map(r=>[r.ref,{...r.names,placeholder:r.placeholder,corrections:r.corrections}]));
}
export async function runTrial(options:{set:SetName;runs:number;outDir:URL;env:NodeJS.ProcessEnv}):Promise<URL[]>{
 if(!Number.isInteger(options.runs)||options.runs<1||options.runs>10)throw new Error('--runs takes 1 to 10');
 const apiKey=options.env.CLOUD_OPENAI_API_KEY;
 if(!apiKey?.trim())throw new Error('CLOUD_OPENAI_API_KEY is required');
 if(options.set!=='tuning'&&options.set!=='blind')throw new Error('Invalid graded set');
 const client=createOpenAiClient({apiKey,baseUrl:openAiBaseUrl(options.env)}),job=trialJob(loadSet(options.set)),batches=planBatches(job.items);
 mkdirSync(options.outDir,{recursive:true});
 // A unique stamp and exclusive creation preserve earlier paid trial evidence.
 const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID(),written:URL[]=[];
 const outDir=pathToFileURL(fileURLToPath(options.outDir).replace(/\/$/,'')+'/');
 for(let repeat=1;repeat<=options.runs;repeat++){
  const usage={inputTokens:0,outputTokens:0},results:ItemResult[]=[],failed:string[]=[];
  const hooks:BatchHooks={mayCall:async()=>true,spent:async u=>{usage.inputTokens+=u.inputTokens;usage.outputTokens+=u.outputTokens;},attempted:async()=>{},
   wait:async(ms,signal)=>{await delay(ms,undefined,{signal});}};
  for(const batch of batches){
   const outcome=await translateBatch(job,batch,client,hooks,new AbortController().signal);
   if(outcome.kind==='done')results.push(...outcome.results);
   // Review fallback is valid production behavior but cannot qualify a two-pass quality trial.
   if(outcome.kind!=='done'||outcome.reviewFailed)failed.push(...batch.filter(i=>i.missing.length>0).map(i=>i.ref));
  }
  // Recorded migration 039 prices, USD per million tokens; this is an estimate, not a bill.
  const costUsd=(usage.inputTokens*0.10+usage.outputTokens*0.50)/1e6;
  const file=new URL(`${options.set}-${stamp}-${repeat}.json`,outDir);
  writeFileSync(file,JSON.stringify({set:options.set,promptVersion:translationPromptVersion,model:translationModel,repeat,names:namesFrom(results),failed,usage,costUsd},null,1)+'\n',{flag:'wx',mode:0o600});
  written.push(file);
 }
 return written;
}
async function main(args:string[]){
 const usage='usage: node quality/trial.ts --set tuning|blind --runs N [--out <dir>]';
 const flags=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){
  const key=args[i]!,value=args[i+1];
  if(!['--set','--runs','--out'].includes(key)||flags.has(key)||!value||value.startsWith('--'))throw new Error(usage);
  flags.set(key,value);
 }
 const set=flags.get('--set'),n=flags.get('--runs');
 if((set!=='tuning'&&set!=='blind')||!n||!/^([1-9]|10)$/.test(n))throw new Error(usage);
 const out=flags.get('--out'),outDir=out?pathToFileURL(out.replace(/\/$/,'')+'/'):new URL('./results/',import.meta.url);
 const files=await runTrial({set,runs:Number(n),outDir,env:process.env});
 for(const file of files)console.log(fileURLToPath(file));
 if(files.some(file=>JSON.parse(readFileSync(file,'utf8')).failed.length))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main(process.argv.slice(2));}catch(error){
  const message=error instanceof Error?error.message:'';
  console.error(message.startsWith('usage:')||message==='CLOUD_OPENAI_API_KEY is required'?message:'Translation trial failed; check options, output directory and provider configuration');
  process.exitCode=1;
 }
}
