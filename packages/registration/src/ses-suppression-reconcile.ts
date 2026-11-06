import type {MailScope} from './ses-feedback-config.ts';

export type ProviderSuppressionReason='BOUNCE'|'COMPLAINT';
export interface ProviderSuppressionPort {
 query(scope:MailScope,recipient:string,signal:AbortSignal):Promise<readonly string[]>;
 remove(scope:MailScope,recipient:string,reason:ProviderSuppressionReason,signal:AbortSignal):Promise<void>;
}
export interface ReconciliationBinding {operationId:string;scope:MailScope;revision:number}
declare const observationBrand:unique symbol;
export interface ProviderSuppressionObservation {readonly [observationBrand]:true}
interface ProviderEvidence {status:'confirmed'|'failed';before:ProviderSuppressionReason[];after:ProviderSuppressionReason[]}
const bindingKey=(binding:ReconciliationBinding)=>JSON.stringify([binding.operationId,binding.scope.country,binding.scope.providerAccountId,binding.scope.region,binding.revision]);
function reasons(value:readonly string[]):ProviderSuppressionReason[]{
 if(!Array.isArray(value)||value.length>2||new Set(value).size!==value.length||value.some(r=>r!=='BOUNCE'&&r!=='COMPLAINT'))throw Error('provider_unconfirmed');
 return [...value].sort() as ProviderSuppressionReason[];
}

/** This port performs no AWS calls unless separately authorised tooling supplies them. */
export function createSesSuppressionReconciler(port:ProviderSuppressionPort,ttlMs=300000,timeoutMs=15000){
 if(!port||typeof port.query!=='function'||typeof port.remove!=='function'
  ||!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>300000||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw Error('mail_reconciliation_unavailable');
 const observations=new WeakMap<object,{binding:string;expires:number;evidence:ProviderEvidence}>();
 // Bind methods once so caller mutations cannot replace a trusted provider port.
 const query=port.query.bind(port),remove=port.remove.bind(port);
 const issue=(binding:ReconciliationBinding,evidence:ProviderEvidence)=>{
  const observation=Object.freeze({}) as ProviderSuppressionObservation;
  observations.set(observation,{binding:bindingKey(binding),expires:performance.now()+ttlMs,evidence});return observation;
 };
 return {
  refuse(binding:ReconciliationBinding):ProviderSuppressionObservation{return issue(binding,{status:'failed',before:[],after:[]});},
  // Historical audit evidence remains recordable after its permission to clear expires.
  auditEvidence(observation:ProviderSuppressionObservation,binding:ReconciliationBinding):ProviderEvidence{
   const registered=observations.get(observation);
   if(!registered||registered.binding!==bindingKey(binding))throw Error('provider_unconfirmed');
   return structuredClone(registered.evidence);
  },
  async reconcile(binding:ReconciliationBinding,recipient:string,signal:AbortSignal):Promise<ProviderSuppressionObservation>{
   const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
   let timer:ReturnType<typeof setTimeout>|undefined;
   let before:ProviderSuppressionReason[]=[];
   const work=async():Promise<ProviderEvidence>=>{
    combined.throwIfAborted();before=reasons(await query(binding.scope,recipient,combined));
    for(const reason of before){combined.throwIfAborted();await remove(binding.scope,recipient,reason,combined);}
    combined.throwIfAborted();const after=reasons(await query(binding.scope,recipient,combined));combined.throwIfAborted();
    return {status:'confirmed',before,after};
   };
   const aborted=new Promise<never>((_resolve,reject)=>{
    combined.addEventListener('abort',()=>reject(Error('provider_unconfirmed')),{once:true});
    timer=setTimeout(()=>controller.abort(),timeoutMs);
   });
   let evidence:ProviderEvidence;
   try{evidence=await Promise.race([work(),aborted]);}
   catch{evidence={status:'failed',before,after:[]};}
   finally{clearTimeout(timer);controller.abort();}
   return issue(binding,evidence);
  },
  evidence(observation:unknown,binding:ReconciliationBinding):ProviderEvidence|null{
   if(!observation||typeof observation!=='object')return null;
   const registered=observations.get(observation);
   if(!registered||registered.binding!==bindingKey(binding)||performance.now()>=registered.expires)return null;
   return registered.evidence;
  },
 };
}
