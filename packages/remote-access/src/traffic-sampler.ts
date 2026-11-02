import {type KeyObject} from 'node:crypto';
import {verifyManifest,type ReportingGatewayManifest} from './manifest.ts';
import {routeBinding} from './forward-report.ts';
import {readTrafficCounters,trafficDelta,type TrafficCounter} from './traffic-counters.ts';
import {signTrafficReport,validateTrafficReport,type TrafficEntry,type TrafficReport} from './traffic-report.ts';
import {TrafficSpool} from './traffic-spool.ts';
import {readTrafficSocket} from './traffic-socket.ts';

interface Options {
 spool:TrafficSpool;envelope:unknown;issuerKey:KeyObject;cellId:string;processId:string;startedAt:string;key:KeyObject;fresh:boolean;
}
function unavailable():never{throw new Error('traffic_sampling_unavailable');}
function instant(value:string):boolean{return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
/** One instance samples one child. The supervisor must serialize sampling and spool transfers too. */
export class TrafficSampler {
 readonly #spool:TrafficSpool;readonly #key:KeyObject;readonly #base:Omit<TrafficReport,'sequence'|'from'|'until'|'complete'|'entries'>;
 readonly #startedAt:string;readonly #fresh:boolean;readonly #entries:Omit<TrafficEntry,'ingress'|'egress'>[];
 readonly #backends=new Map<string,string>();#pending:Promise<void>=Promise.resolve();
 constructor(options:Options){
  try{
   if(!instant(options.startedAt)||typeof options.fresh!=='boolean')unavailable();
   const manifest=verifyManifest(options.envelope,options.issuerKey,options.cellId,Date.parse(options.startedAt));
   if(manifest.version!==2)unavailable();
   this.#spool=options.spool;this.#key=options.key;this.#startedAt=options.startedAt;this.#fresh=options.fresh;
   this.#base={version:1,audience:'waitron-cloud-remote-traffic',cellId:manifest.cellId,gatewayId:manifest.reporter.gatewayId,generation:manifest.reporter.generation,processId:options.processId};
   this.#entries=this.#routes(manifest);
   // A zero-delta interval validates the child identity and the dedicated private reporter key.
   signTrafficReport({...this.#base,sequence:1,from:this.#startedAt,until:new Date(Date.parse(this.#startedAt)+1).toISOString(),complete:false,entries:this.#entries.map(e=>({...e,ingress:'0',egress:'0'}))},this.#key);
  }catch{unavailable();}
 }
 #routes(manifest:ReportingGatewayManifest):Omit<TrafficEntry,'ingress'|'egress'>[]{
  return manifest.routes.flatMap(route=>(['staff','public'] as const).map(channel=>{
   const binding=routeBinding(route),name=`${route.installationId}:${route.revision}:${binding}:${channel}`;
   this.#backends.set(`traffic_user_${channel}_${route.installationId.replaceAll('-','')}`,name);
   return {installationId:route.installationId,venueId:route.venueId,revision:route.revision,routeBinding:binding,channel};
  }));
 }
 sample(csv:string,until:string):Promise<void>{
  const next=this.#pending.then(()=>this.#sample(csv,until));this.#pending=next.catch(()=>{});return next;
 }
 sampleSocket(path:string,now:()=>number=Date.now):Promise<void>{
  const next=this.#pending.then(async()=>{
   try{await this.#sample(await readTrafficSocket(path),new Date(now()).toISOString());}
   catch{return this.#failed();}
  });
  this.#pending=next.catch(()=>{});return next;
 }
 async #failed():Promise<never>{
  try{await this.#spool.markGap();}catch{/* Country coverage also detects an unreported tail. */}
  return unavailable();
 }
 async #sample(csv:string,until:string):Promise<void>{
  try{
   const previous=await this.#spool.cursor();
   if(previous&&(previous.processId!==this.#base.processId||previous.until<this.#startedAt))unavailable();
   const from=previous?.until??this.#startedAt;
   if(!instant(until)||until<=from)unavailable();
   const current=readTrafficCounters(csv,this.#backends);
   if(previous&&(previous.counters.size!==current.size||[...current.keys()].some(name=>!previous.counters.has(name))))unavailable();
   const complete=previous?previous.complete:this.#fresh;
   const entries=this.#entries.map(entry=>{
    const name=`${entry.installationId}:${entry.revision}:${entry.routeBinding}:${entry.channel}`,counter=current.get(name)!;
    const baseline:TrafficCounter=previous?previous.counters.get(name)!:this.#fresh?{ingress:'0',egress:'0'}:counter;
    const delta=trafficDelta(baseline,counter);return {...entry,ingress:String(delta.ingress),egress:String(delta.egress)};
   });
   const report:TrafficReport={...this.#base,sequence:(previous?.sequence??0)+1,from,until,complete,entries};
   validateTrafficReport(report);await this.#spool.append(report,signTrafficReport(report,this.#key),current);
  }catch{return this.#failed();}
 }
}
