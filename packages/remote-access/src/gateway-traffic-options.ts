import {createHash,type KeyObject} from 'node:crypto';
import {validateTrafficRenderOptions,type TrafficRenderOptions} from './config.ts';
import {isUuid,verifyManifest,type GatewayRoute} from './manifest.ts';

export interface GatewayTrafficOptions {socketDirectory:string;operationalSources:readonly string[]}
export function gatewayTrafficFingerprint(routes:GatewayRoute[],certificates:unknown[],envelope?:unknown):string{
 return JSON.stringify([routes,certificates,...(envelope===undefined?[]:[createHash('sha256').update(JSON.stringify(envelope)).digest('hex')])]);
}
const names=['MODE','COUNTRY','ENVIRONMENT','SOCKET_DIRECTORY','OPERATIONAL_SOURCES'].map(name=>'GATEWAY_TRAFFIC_'+name);
export function gatewayTrafficOptions(env:NodeJS.ProcessEnv):GatewayTrafficOptions|undefined{
 if(names.every(name=>env[name]===undefined))return;
 try{
  if(env.GATEWAY_TRAFFIC_MODE!=='test'||env.GATEWAY_TRAFFIC_COUNTRY!=='ES'||env.GATEWAY_TRAFFIC_ENVIRONMENT!=='test')throw new Error();
  const socketDirectory=env.GATEWAY_TRAFFIC_SOCKET_DIRECTORY,operationalSources:unknown=JSON.parse(env.GATEWAY_TRAFFIC_OPERATIONAL_SOURCES??'');
  if(typeof socketDirectory!=='string'||!Array.isArray(operationalSources))throw new Error();
  validateTrafficRenderOptions({socket:socketDirectory+'/00000000-0000-0000-0000-000000000000.sock',operationalSources});
  return {socketDirectory,operationalSources:[...operationalSources]};
 }catch{throw new Error('invalid_traffic_options');}
}

// The cached envelope is authenticated again because apply runs before authority exposes its routes.
export function trafficManifestOptions(options:GatewayTrafficOptions,envelope:unknown,key:KeyObject,cellId:string,routes:GatewayRoute[],processId:string,now=Date.now()):TrafficRenderOptions{
 try{
  const value=verifyManifest(envelope,key,cellId,now);
  if(!isUuid(processId)||value.version!==2||JSON.stringify(value.routes)!==JSON.stringify(routes))throw new Error();
  const rendered={socket:`${options.socketDirectory}/${processId}.sock`,operationalSources:options.operationalSources};
  validateTrafficRenderOptions(rendered);return rendered;
 }catch{throw new Error('traffic_authority_unavailable');}
}
