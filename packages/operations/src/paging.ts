const services={cloud:['Waitron Cloud','Waitron Cloud'],remote_access:['Remote access','Acceso remoto'],backups:['Backups','Copias de seguridad'],email:['Email','Correo electrónico'],hosted_servers:['Cloud-hosted venue servers','Servidores de locales alojados en Cloud']} as const;
export interface Notification {incidentId:string;notificationId:string;locale:'en'|'es';service:keyof typeof services;venues:number;since:string;fixProposed:boolean}
export type Provider='twilio'|'vonage';
export type Kind='text'|'call'|'input';
export type Submission={state:'accepted';ids:string[]}|{state:'failed'|'unknown'};
export interface ProviderEvent {provider:Provider;kind:Kind;id:string;state:'pending'|'delivered'|'failed'|'answered'|'completed'|'input';digits?:string}
export interface TrustedEvent {incidentId:string;notificationId:string;event:ProviderEvent}
// The caller authenticates callbacks and binds their path context before passing trusted events.
export interface PagingProvider {provider:Provider;text(n:Notification):Promise<Submission>;call(n:Notification):Promise<Submission>;readTrustedEvent(kind:Kind,body:unknown):ProviderEvent|null}
export interface PageAttempt {provider:Provider;incidentId:string;notificationId:string;text:Submission;call:Submission}
export interface Configuration {
 origin:string;to:string;from:string;timeoutMs:number;
 // The injected transport must honor the supplied AbortSignal, including response-body reads.
 fetcher:typeof fetch;
}
const uuid=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
function notification(n:Notification){
 try{
  if(Object.keys(n).sort().join(',')!=='fixProposed,incidentId,locale,notificationId,service,since,venues'||!uuid(n.incidentId)||!uuid(n.notificationId)
   ||!['en','es'].includes(n.locale)||!Object.hasOwn(services,n.service)||!Number.isSafeInteger(n.venues)||n.venues<0||typeof n.fixProposed!=='boolean'
   ||typeof n.since!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(n.since)
   ||new Date(n.since).toISOString().replace('.000Z','Z')!==n.since.replace('.000Z','Z'))throw Error();
 }catch{throw new Error('paging.invalid_notification');}
}
export function origin(value:string){try{const url=new URL(value);if(url.origin!==value||url.protocol!=='https:')throw Error();return value;}catch{throw new Error('paging.invalid_config');}}
export function configuration(c:Configuration){
 origin(c.origin);
 if(typeof c.fetcher!=='function'||![c.to,c.from].every(s=>typeof s==='string'&&/^\+[1-9][0-9]{7,14}$/.test(s))||!Number.isInteger(c.timeoutMs)||c.timeoutMs<1||c.timeoutMs>10000)throw new Error('paging.invalid_config');
}
export function callback(c:Configuration,n:Notification,p:Provider,kind:Kind){return `${c.origin}/paging/${n.incidentId}/${n.notificationId}/${p}/${kind}`;}
export function pagingMessage(n:Notification,base:string){
 notification(n);origin(base);const es=n.locale==='es',service=services[n.service][es?1:0],since=n.since.slice(0,19).replace('T',' ')+' UTC',link=`${base}/incidents/${n.incidentId}`;
 const fix=es?(n.fixProposed?'Se propone una solución.':'No se propone ninguna solución.'):(n.fixProposed?'A fix is proposed.':'No fix is proposed.');
 return {text:es?`Alerta de Waitron Cloud: ${service}. Locales afectados: ${n.venues}. Desde: ${since}. ${fix} Detalles: ${link}`:`Waitron Cloud alert: ${service}. Affected venues: ${n.venues}. Since: ${since}. ${fix} Details: ${link}`,
  voice:es?`Alerta de Waitron Cloud: ${service}. Locales afectados: ${n.venues}. Detalles enviados por SMS. Pulsa 1 para confirmar la recepción.`:`Waitron Cloud alert: ${service}. Affected venues: ${n.venues}. Details sent by text. Press 1 to acknowledge.`};
}
export async function pagingRequest(c:Configuration,url:string,headers:Record<string,string>,body:string):Promise<{state:'ok';body:unknown}|{state:'failed'|'unknown'}>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const response=await c.fetcher(url,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(c.timeoutMs)});
  if(!response.ok){void response.body?.cancel().catch(()=>{});return {state:response.status>=400&&response.status<500?'failed':'unknown'};}
  reader=response.body?.getReader();if(!reader)return {state:'unknown'};
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)return {state:'unknown'};chunks.push(value);}
  return {state:'ok',body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))};
 }catch{return {state:'unknown'};}finally{void reader?.cancel().catch(()=>{});}
}
export function object(body:unknown):Record<string,unknown>{return body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};}
export async function sendPage(p:PagingProvider,n:Notification):Promise<PageAttempt>{
 notification(n);
 const submit=async(kind:'text'|'call'):Promise<Submission>=>{try{return await p[kind](n);}catch{return {state:'unknown'};}};
 const text=await submit('text'),call=await submit('call');return {provider:p.provider,incidentId:n.incidentId,notificationId:n.notificationId,text,call};
}
function matching(a:PageAttempt,k:'text'|'call',events:readonly TrustedEvent[]){
 return events.filter(e=>e.incidentId===a.incidentId&&e.notificationId===a.notificationId).map(e=>e.event)
  .filter(e=>e.provider===a.provider&&a[k].state==='accepted'&&a[k].ids.includes(e.id)&&(e.kind===k||k==='call'&&e.kind==='input'));
}
export function deliveryConfirmed(a:PageAttempt,k:'text'|'call',events:readonly TrustedEvent[]){
 const s=a[k],e=matching(a,k,events);
 return s.state==='accepted'&&s.ids.length>0&&s.ids.every(id=>e.some(e=>e.id===id&&(k==='text'?e.state==='delivered':['answered','completed'].includes(e.state))));
}
export function pageDecision(facts:{notification:Notification;attempts:readonly PageAttempt[];events:readonly TrustedEvent[];unconfirmed?:readonly ('text'|'call')[]}){
 const n=facts.notification;notification(n);
 const attempts=facts.attempts.filter(a=>a.incidentId===n.incidentId&&a.notificationId===n.notificationId);
 const acknowledged=attempts.some(a=>matching(a,'call',facts.events).some(e=>e.kind==='input'&&e.digits==='1'));
 const primary=attempts.find(a=>a.provider==='twilio');
 const failed=primary&&(['text','call'] as const).some(k=>{
  const s=primary[k],e=matching(primary,k,facts.events);if(s.state!=='accepted'||e.some(e=>e.state==='failed'))return true;
  return facts.unconfirmed?.includes(k)&&!deliveryConfirmed(primary,k,facts.events);
 });
 return {backupNeeded:!!primary&&!attempts.some(a=>a.provider==='vonage')&&!acknowledged&&!!failed,acknowledged};
}
