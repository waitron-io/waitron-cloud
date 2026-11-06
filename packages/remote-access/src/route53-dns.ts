import {ChangeResourceRecordSetsCommand,GetChangeCommand,Route53Client} from '@aws-sdk/client-route-53';
import {setTimeout as delay} from 'node:timers/promises';
import type {DnsChallengeProvider} from './certificates.ts';
import {isHostname} from './manifest.ts';

export function createRoute53DnsProvider(config:{zoneId:string;suffix:string},client=new Route53Client({region:'us-east-1'})):DnsChallengeProvider {
 const {zoneId,suffix}=config;
 if(!/^Z[A-Z0-9]+$/.test(zoneId)||!isHostname(suffix))throw new Error('invalid_route53_configuration');
 async function change(action:'UPSERT'|'DELETE',name:string,value:string,caller?:AbortSignal){
  const hostname=name.slice('_acme-challenge.'.length);
  if(!name.startsWith('_acme-challenge.')||name.length>253||!isHostname(hostname)
   ||!hostname.endsWith('.'+suffix)||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new Error('invalid_dns_challenge');
  // Leave room for ACME in the existing 120-second claim; cleanup needs no propagation wait.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='UPSERT'?75000:10000);
  const signal=caller?AbortSignal.any([caller,controller.signal]):controller.signal;
  try{
   signal.throwIfAborted();
   // Exact-value DELETE protects a different newer value, not overlapping identical challenges.
   const result=await client.send(new ChangeResourceRecordSetsCommand({HostedZoneId:zoneId,ChangeBatch:{Changes:[{Action:action,ResourceRecordSet:{Name:name,Type:'TXT',TTL:60,ResourceRecords:[{Value:'"'+value+'"'}]}}]}}),{abortSignal:signal});
   if(!result.ChangeInfo?.Id)throw new Error('route53_change_unavailable');
   if(action==='UPSERT')while(true){
    const state=(await client.send(new GetChangeCommand({Id:result.ChangeInfo.Id}),{abortSignal:signal})).ChangeInfo?.Status;
    if(state==='INSYNC')break;
    if(state!=='PENDING')throw new Error('route53_change_unavailable');
    await delay(1000,undefined,{signal});
   }
  }catch(error){if(action==='DELETE')console.error('remote.dns_cleanup_failed');throw error;}
  finally{clearTimeout(timer);}
 }
 return {present:(name,value,signal)=>change('UPSERT',name,value,signal),remove:(name,value,signal)=>change('DELETE',name,value,signal)};
}
