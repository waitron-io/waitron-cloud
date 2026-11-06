import {ChangeResourceRecordSetsCommand,Route53Client,waitUntilResourceRecordSetsChanged} from '@aws-sdk/client-route-53';
import type {DnsChallengeProvider} from './certificates.ts';
import {isHostname} from './manifest.ts';

export function createRoute53DnsProvider(config:{zoneId:string;suffix:string},client=new Route53Client({region:'us-east-1'})):DnsChallengeProvider {
 const {zoneId,suffix}=config;
 if(!/^Z[A-Z0-9]+$/.test(zoneId)||!isHostname(suffix)||suffix!==suffix.toLowerCase())throw new Error('invalid_route53_configuration');
 async function change(action:'UPSERT'|'DELETE',name:string,value:string){
  const hostname=name.slice('_acme-challenge.'.length);
  if(!name.startsWith('_acme-challenge.')||!isHostname(hostname)||hostname!==hostname.toLowerCase()
   ||!hostname.endsWith('.'+suffix)||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new Error('invalid_dns_challenge');
  // Exact-value DELETE cannot erase a newer challenge that replaced this one.
  const result=await client.send(new ChangeResourceRecordSetsCommand({HostedZoneId:zoneId,ChangeBatch:{Changes:[{Action:action,ResourceRecordSet:{Name:name,Type:'TXT',TTL:60,ResourceRecords:[{Value:'"'+value+'"'}]}}]}}));
  if(!result.ChangeInfo?.Id)throw new Error('route53_change_unavailable');
  await waitUntilResourceRecordSetsChanged({client,maxWaitTime:120,minDelay:1,maxDelay:5},{Id:result.ChangeInfo.Id});
 }
 return {present:(name,value)=>change('UPSERT',name,value),remove:(name,value)=>change('DELETE',name,value)};
}
