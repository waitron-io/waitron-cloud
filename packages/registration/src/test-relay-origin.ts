import {isIP} from 'node:net';
import {verifyMachine,verifyLease,type SignedEnvelope} from './installation-proof.ts';

export interface TestRelayOrigin {environment:string;origin:string;trusted:ReadonlyMap<string,string>}
export function privateManagementOrigin(value:unknown):value is string {
  if(typeof value!=='string'||value.length>253)return false;
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)return false;
    if(u.hostname.endsWith('.local'))return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+local$/.test(u.hostname);
    if(isIP(u.hostname)!==4)return false;
    const [a,b]=u.hostname.split('.').map(Number);
    return a===10||(a===172&&b!==undefined&&b>=16&&b<=31)||(a===192&&b===168);
  } catch {return false;}
}
// The caller holds test-only owner and installation authority; this checks the signed statement.
export function testRelayOriginProof(config:TestRelayOrigin,installation:{id:string;venue_id:string;environment:string;public_key:string},managementOrigin:string,envelope:SignedEnvelope,time:number):void {
  if(!privateManagementOrigin(managementOrigin))throw Error('origin_unverified');
  const c=verifyMachine(envelope,installation.public_key,config.origin,'configuration',time);
  if(c.installationId!==installation.id||c.body!==JSON.stringify({servicesVersion:2,managementOrigin}))throw Error('origin_unverified');
  const lease=JSON.parse(c.lease);
  if(JSON.stringify(lease)!==c.lease)throw Error('origin_unverified');
  const claims=verifyLease(lease,config.trusted,config.origin,time);
  if(claims.installationId!==installation.id||claims.venueId!==installation.venue_id||claims.environment!==installation.environment||claims.publicKey!==installation.public_key)throw Error('origin_unverified');
}
