import {isAbsolute,normalize} from 'node:path';
import {isUuid} from './manifest.ts';

export interface TrafficMapping {country:'ES';environment:'test';cellId:string;directory:string;writerUid:number;readerGid:number}
export function validateTrafficMapping(value:unknown):asserts value is TrafficMapping {
 const fail=():never=>{throw new Error('traffic_authority_unavailable');};
 if(!value||typeof value!=='object'||Array.isArray(value))fail();const m=value as TrafficMapping;
 if(Object.keys(m).sort().join(',')!=='cellId,country,directory,environment,readerGid,writerUid'||m.country!=='ES'||m.environment!=='test'||!isUuid(m.cellId)
  ||typeof m.directory!=='string'||!isAbsolute(m.directory)||normalize(m.directory)!==m.directory
  ||!Number.isSafeInteger(m.writerUid)||m.writerUid<0||!Number.isSafeInteger(m.readerGid)||m.readerGid<0)fail();
}
