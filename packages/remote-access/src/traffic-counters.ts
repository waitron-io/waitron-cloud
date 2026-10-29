export interface TrafficCounter {ingress:string;egress:string}
const invalid=():never=>{throw new Error('invalid_traffic_counters');};
function quantity(value:unknown):bigint {
 if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(value))return invalid();
 const n=BigInt(value);if(n>18446744073709551615n)return invalid();return n;
}
export function trafficDelta(previous:TrafficCounter,current:TrafficCounter):{ingress:bigint;egress:bigint} {
 const ingress=quantity(current.ingress)-quantity(previous.ingress),egress=quantity(current.egress)-quantity(previous.egress);
 if(ingress<0n||egress<0n||ingress+egress>9223372036854775807n)return invalid();
 return {ingress,egress};
}
/** Only generated, mapped BACKEND totals count; frontend/server rows would double count bytes. */
export function readTrafficCounters(csv:string,backends:ReadonlyMap<string,string>):Map<string,TrafficCounter> {
 if(typeof csv!=='string'||Buffer.byteLength(csv)>1048576||backends.size>128||new Set(backends.values()).size!==backends.size)return invalid();
 const lines=csv.trim().split(/\r?\n/),first=lines.shift();if(!first?.startsWith('# '))return invalid();
 const header=first.slice(2).split(','),names=header.filter(Boolean);
 if(new Set(names).size!==names.length)return invalid();
 const positions=['pxname','svname','bin','bout'].map(name=>header.indexOf(name));if(positions.some(p=>p<0))return invalid();
 const [px,sv,bin,bout]=positions as [number,number,number,number],result=new Map<string,TrafficCounter>();
 for(const line of lines){
  const row=line.split(','),route=backends.get(row[px]??'');if(route===undefined||row[sv]!=='BACKEND')continue;
  if(!route||row.length!==header.length||result.has(route))return invalid();
  const ingress=row[bin],egress=row[bout];quantity(ingress);quantity(egress);
  result.set(route,{ingress:ingress!,egress:egress!});
 }
 if(result.size!==backends.size)return invalid();return result;
}
