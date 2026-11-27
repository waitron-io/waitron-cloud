import {
 ChangeResourceRecordSetsCommand,GetChangeCommand,GetHostedZoneCommand,ListResourceRecordSetsCommand,
 Route53Client,type ResourceRecordSet,type Route53ClientConfig,
} from '@aws-sdk/client-route-53';
import {setTimeout as delay} from 'node:timers/promises';
import type {DnsChallengeProvider} from './certificates.ts';
import {isHostname,isUuid} from './manifest.ts';

async function changeRecord(client:Route53Client,zoneId:string,action:'CREATE'|'UPSERT'|'DELETE',record:ResourceRecordSet,caller?:AbortSignal){
 // Propagation shares the write's budget. Cleanup needs only the write response.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='DELETE'?10000:75000);
 const signal=caller?AbortSignal.any([caller,controller.signal]):controller.signal;
 try{
  signal.throwIfAborted();
  const result=await client.send(new ChangeResourceRecordSetsCommand({
   HostedZoneId:zoneId,ChangeBatch:{Changes:[{Action:action,ResourceRecordSet:record}]},
  }),{abortSignal:signal});
  if(!result.ChangeInfo?.Id)throw new Error('route53_change_unavailable');
  if(action!=='DELETE')while(true){
   const state=(await client.send(new GetChangeCommand({Id:result.ChangeInfo.Id}),{abortSignal:signal})).ChangeInfo?.Status;
   if(state==='INSYNC')break;
   if(state!=='PENDING')throw new Error('route53_change_unavailable');
   await delay(1000,undefined,{signal});
  }
 }finally{clearTimeout(timer);}
}

export function createRoute53DnsProvider(config:{zoneId:string;suffix:string},client=new Route53Client({region:'us-east-1'})):DnsChallengeProvider {
 const {zoneId,suffix}=config;
 if(!/^Z[A-Z0-9]+$/.test(zoneId)||!isHostname(suffix))throw new Error('invalid_route53_configuration');
 async function change(action:'UPSERT'|'DELETE',name:string,value:string,caller?:AbortSignal,type:'TXT'|'CNAME'='TXT'){
  if(type==='CNAME'){
   const label=name.slice(0,-suffix.length-1),id=label.startsWith('staff-v-')?label.slice(8):label.startsWith('v-')?label.slice(2):'';
   if(name!==label+'.'+suffix||!isUuid(id)||!isHostname(name)||!isHostname(value))throw new Error('invalid_name_record');
  }else{
  const hostname=name.slice('_acme-challenge.'.length);
  if(!name.startsWith('_acme-challenge.')||name.length>253||!isHostname(hostname)
   ||!hostname.endsWith('.'+suffix)||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new Error('invalid_dns_challenge');
  }
  try{
   await changeRecord(client,zoneId,action,{Name:name,Type:type,TTL:60,ResourceRecords:[{Value:type==='TXT'?'"'+value+'"':value}]},caller);
  }catch(error){if(action==='DELETE')console.error('remote.dns_cleanup_failed');throw error;}
 }
 return {present:(name,value,signal)=>change('UPSERT',name,value,signal),remove:(name,value,signal)=>change('DELETE',name,value,signal),point:(name,target,signal)=>change('UPSERT',name,target,signal,'CNAME')};
}

const dnsName=(name:string)=>name.toLowerCase().replace(/\.$/,'');
export const mailKeyTxt=(publicKey:string)=>'v=DKIM1; k=rsa; p='+publicKey;

export function createRoute53MailDnsProvider(config:{zoneId:string;suffix:string},options:Route53ClientConfig={}){
 const {zoneId,suffix}=config;
 if(!/^Z[A-Z0-9]+$/.test(zoneId)||!isHostname(suffix))throw new Error('invalid_route53_configuration');
 const client=new Route53Client({region:'us-east-1',...options,maxAttempts:1});
 const mailSuffix='.mail.'+suffix;
 const readOptions=()=>({abortSignal:AbortSignal.timeout(10000)});
 function record(name:string,key:string):ResourceRecordSet{
  if(!name.endsWith(mailSuffix)||!isUuid(name.slice(0,-mailSuffix.length))||!isHostname(name)
   ||!/^[A-Za-z0-9+/]+={0,2}$/.test(key))throw new Error('invalid_mail_dns_record');
  const value=mailKeyTxt(key).match(/.{1,255}/g)!.map(chunk=>'"'+chunk+'"').join(' ');
  return {Name:name,Type:'TXT',TTL:60,ResourceRecords:[{Value:value}]};
 }
 return {
  async checkZone(){
   const {HostedZone:zone}=await client.send(new GetHostedZoneCommand({Id:zoneId}),readOptions());
   const name=zone?.Name&&dnsName(zone.Name);
   if(!name||zone?.Config?.PrivateZone!==false||(name!==suffix&&!suffix.endsWith('.'+name)))throw new Error('invalid_mail_dns_zone');
  },
  async read(name:string,key:string):Promise<'absent'|'matching'|'different'>{
   const expected=record(name,key);
   const {ResourceRecordSets}=await client.send(new ListResourceRecordSetsCommand({
    HostedZoneId:zoneId,StartRecordName:name,StartRecordType:'TXT',MaxItems:1,
   }),readOptions());
   const actual=ResourceRecordSets?.[0];
   if(!actual||dnsName(actual.Name??'')!==name||actual.Type!=='TXT')return 'absent';
   return !actual.SetIdentifier&&actual.TTL===expected.TTL&&actual.ResourceRecords?.length===1&&
    actual.ResourceRecords[0]?.Value===expected.ResourceRecords![0]!.Value?'matching':'different';
  },
  async create(name:string,key:string){await changeRecord(client,zoneId,'CREATE',record(name,key));},
  async remove(name:string,key:string){await changeRecord(client,zoneId,'DELETE',record(name,key));},
  close(){client.destroy();},
 };
}
