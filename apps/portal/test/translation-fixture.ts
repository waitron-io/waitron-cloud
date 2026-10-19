import type {Pool} from 'pg';
import type {IncomingMessage,Server,ServerResponse} from 'node:http';
import {readMachineClaims,type LeaseIssuer} from '@waitron-cloud/registration';
import {TranslationMachine,maxCollectBytes,type TranslationAction} from '../../../packages/translation/src/index.ts';

type Action='translation-collect'|'translation-release';
type Reference={action:Action;installationId:string;jobId:string;cursor?:number};
export type TranslationEvent=Reference&({kind:'request'}|{kind:'reply'|'lost';status:number;body:unknown});
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 // A controller may be closed before its caller starts awaiting an armed fault.
 void promise.catch(()=>undefined);return {promise,resolve,reject};
}
type Gate={cursor:number;claimed:boolean;cancelled:boolean;entered:ReturnType<typeof deferred<{jobId:string;cursor:number}>>;wait:ReturnType<typeof deferred<void>>};
type Loss={action:Action;cursor?:number;reply:ReturnType<typeof deferred<{status:number;body:string}>>;reserved?:Observation};
type Observation={request:IncomingMessage;response:ServerResponse;payload?:string;reference?:Reference;loss?:Loss};

export class TranslationFixture {
 readonly machine:TranslationMachine;
 readonly events:TranslationEvent[]=[];
 readonly #failed=deferred<never>();
 readonly failure=this.#failed.promise;
 readonly #closed=deferred<void>();
 readonly #gates=new Set<Gate>();
 readonly #losses=new Set<Loss>();
 readonly #observations=new Set<Observation>();
 readonly #releaseChecks=new Set<(jobId:string)=>Promise<void>>();
 #isClosed=false;
 server?:Server;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,pageBytes?:number){
  const owner=this;
  this.machine=new class extends TranslationMachine {
   override async execute(action:TranslationAction,envelope:unknown,jobBody?:string){
    return owner.#execute(action,envelope,()=>super.execute(action,envelope,jobBody));
   }
  }(pool,issuer,origin,undefined,pageBytes);
 }
 pauseCollect(cursor:number){
  this.#open();if(!Number.isSafeInteger(cursor)||cursor<0)throw new Error('translation_fixture_cursor_invalid');
  const gate:Gate={cursor,claimed:false,cancelled:false,entered:deferred(),wait:deferred()};this.#gates.add(gate);
  return {entered:gate.entered.promise,resume:()=>gate.wait.resolve(),cancel:()=>this.#cancel(gate)};
 }
 loseReply(action:Action,cursor?:number){
  this.#open();const loss:Loss={action,cursor,reply:deferred()};this.#losses.add(loss);return loss.reply.promise;
 }
 beforeRelease(check:(jobId:string)=>Promise<void>){this.#open();this.#releaseChecks.add(check);return ()=>{this.#releaseChecks.delete(check);};}
 attach(server:Server){
  this.#open();if(this.server)throw new Error('translation_fixture_already_attached');
  this.server=server;server.prependListener('request',this.#observe);
 }
 close(){
  if(this.#isClosed)return;this.#isClosed=true;this.#closed.resolve();
  this.server?.removeListener('request',this.#observe);
  for(const gate of this.#gates)this.#cancel(gate);
  for(const loss of this.#losses)loss.reply.reject(new Error('translation_fixture_closed'));
  this.#losses.clear();this.#releaseChecks.clear();
  for(const observation of this.#observations)observation.request.socket.destroy();
 }
 #open(){if(this.#isClosed)throw new Error('translation_fixture_closed');}
 #cancel(gate:Gate){gate.cancelled=true;gate.entered.reject(new Error('translation_fixture_cancelled'));gate.wait.resolve();this.#gates.delete(gate);}
 async #execute(action:TranslationAction,envelope:unknown,execute:()=>Promise<Record<string,unknown>>){
  this.#open();if(action!=='translation-collect'&&action!=='translation-release')return execute();
  const claims=readMachineClaims(envelope);
  let body:{jobId?:unknown;cursor?:unknown};try{body=JSON.parse(claims.body);}catch{return execute();}
  if(!body||typeof body.jobId!=='string')return execute();
  const reference:Reference={action,installationId:claims.installationId,jobId:body.jobId,...(action==='translation-collect'?{cursor:typeof body.cursor==='number'?body.cursor:0}:{})};
  // The HTTP route has authenticated this envelope. Observation never grants authority.
  const payload=(envelope as {payload:string}).payload;
  const observation=[...this.#observations].find(o=>o.payload===payload&&!o.reference);
  if(observation)observation.reference=reference;
  this.events.push({kind:'request',...reference});
  const gate=action==='translation-collect'?[...this.#gates].find(g=>!g.claimed&&g.cursor===reference.cursor):undefined;
  if(gate){
   gate.claimed=true;gate.entered.resolve({jobId:reference.jobId,cursor:gate.cursor});await gate.wait.promise;
   this.#gates.delete(gate);if(gate.cancelled)throw new Error('translation_fixture_cancelled');
  }
  this.#open();
  if(action==='translation-release')for(const check of this.#releaseChecks){
   try{await Promise.race([check(reference.jobId),this.#closed.promise.then(()=>{throw new Error('translation_fixture_closed');})]);}
   catch(error){this.#failed.reject(error instanceof Error?error:new Error('translation_fixture_release_check_failed'));throw error;}
  }
  this.#open();return execute();
 }
 #observe=(request:IncomingMessage,response:ServerResponse)=>{
  if(!['/api/installations/translation-collect','/api/installations/translation-release'].includes(request.url??''))return;
  const observation:Observation={request,response};this.#observations.add(observation);
  let requestBytes=0;const requestChunks:Buffer[]=[];
  const data=(chunk:Buffer)=>{requestBytes+=chunk.length;if(requestBytes<=16384)requestChunks.push(Buffer.from(chunk));else requestChunks.length=0;};
  const end=()=>{
   if(requestBytes<=16384)try{const value=JSON.parse(Buffer.concat(requestChunks).toString('utf8'));if(typeof value?.payload==='string')observation.payload=value.payload;}catch{/* The genuine reader reports malformed input. */}
   requestChunks.length=0;
  };
  // A data listener would start flowing before the asynchronous handler reads its body.
  // Observe emitted bytes without resuming or consuming the original request stream.
  const emit=request.emit;
  const observedEmit=function(event:string|symbol,...args:unknown[]){
   if(event==='data')data(args[0] as Buffer);
   if(event==='end'){end();request.emit=emit;}
   return Reflect.apply(emit,request,[event,...args]);
  } as typeof request.emit;
  request.emit=observedEmit;
  response.once('close',()=>{if(request.emit===observedEmit)request.emit=emit;this.#observations.delete(observation);});
  const chunks:Buffer[]=[];let bytes=0,finished=false,recorded=false,contentLength:number|undefined;
  const capture=(value:unknown,encoding?:unknown)=>{
   if(value===undefined||value===null||typeof value==='function')return;
   const chunk=typeof value==='string'?Buffer.from(value,typeof encoding==='string'?encoding as BufferEncoding:undefined):Buffer.from(value as Uint8Array);
   bytes+=chunk.length;
   if(bytes>maxCollectBytes){this.#failed.reject(new Error('translation_fixture_reply_too_large'));request.socket.destroy();throw new Error('translation_fixture_reply_too_large');}
   chunks.push(chunk);
  };
  const losing=(status=response.statusCode)=>{
   if(!observation.reference||status!==200)return false;
   if(!observation.loss){
    const ref=observation.reference,loss=[...this.#losses].find(l=>!l.reserved&&l.action===ref.action&&(l.cursor===undefined||l.cursor===ref.cursor));
    if(loss){loss.reserved=observation;observation.loss=loss;}
   }
   return !!observation.loss&&this.#losses.has(observation.loss);
  };
  const controller=this;
  const record=(kind:'reply'|'lost')=>{
   const body=Buffer.concat(chunks).toString('utf8');
   if(!recorded&&observation.reference){
    let parsed:unknown;try{parsed=JSON.parse(body);}catch{parsed=body;}
    controller.events.push({...observation.reference,kind,status:response.statusCode,body:parsed});recorded=true;
   }
   return body;
  };
  const write=response.write,finish=response.end,head=response.writeHead,flush=response.flushHeaders;
  response.writeHead=function(...args:unknown[]){
   const headers=typeof args[1]==='string'?args[2]:args[1];
   const entries=Array.isArray(headers)?Array.from({length:Math.floor(headers.length/2)},(_,i)=>[headers[i*2],headers[i*2+1]]):headers&&typeof headers==='object'?Object.entries(headers):[];
   const length=entries.find(([name])=>String(name).toLowerCase()==='content-length')?.[1]??response.getHeader('content-length');
   if(length!==undefined&&Number.isSafeInteger(Number(length))&&Number(length)>=0)contentLength=Number(length);
   if(losing(Number(args[0]))){response.statusCode=Number(args[0]);return response;}return Reflect.apply(head,response,args);
  } as typeof response.writeHead;
  response.flushHeaders=function(){if(!losing())return flush.call(response);};
  response.write=function(...args:unknown[]){
   capture(args[0],args[1]);if(!losing()){
    const writable=Reflect.apply(write,response,args);
    // A fixed-length reply reaches the client before end() when the last write fills it.
    if(contentLength!==undefined&&bytes===contentLength)record('reply');return writable;
   }
   const callback=args.find(a=>typeof a==='function') as (()=>void)|undefined;if(callback)queueMicrotask(callback);return true;
  } as typeof response.write;
  response.end=function(...args:unknown[]){
   if(finished)return response;finished=true;capture(args[0],args[1]);
   const drop=losing(),body=record(drop?'lost':'reply');
   if(drop){
    const loss=observation.loss!;controller.#losses.delete(loss);loss.reply.resolve({status:response.statusCode,body});request.socket.destroy();
    const callback=args.find(a=>typeof a==='function') as (()=>void)|undefined;if(callback)queueMicrotask(callback);return response;
   }
   return Reflect.apply(finish,response,args);
  } as typeof response.end;
 };
}
