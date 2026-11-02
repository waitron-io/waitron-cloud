import {isAddress,isHostname,isPeerKey,isUuid,type GatewayRoute} from './manifest.ts';
import {isIP} from 'node:net';
export interface TrafficRenderOptions {socket:string;operationalSources:readonly string[]}
interface HaproxyOptions {port:number;publicTlsPort:number;gatePort:number;certificateDirectory:string;traffic?:TrafficRenderOptions}
export function validateTrafficRenderOptions(value:TrafficRenderOptions):void{
 if(!value||typeof value.socket!=='string'||value.socket.length>100||!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.sock$/.test(value.socket)
  ||!Array.isArray(value.operationalSources)||value.operationalSources.length<1||value.operationalSources.length>64
  ||new Set(value.operationalSources).size!==value.operationalSources.length||value.operationalSources.some(source=>typeof source!=='string'||isIP(source)===0))throw new Error('invalid_traffic_options');
}
function validate(routes:GatewayRoute[]){
 if(routes.length>64)throw new Error('invalid_routes');const hosts=new Set(),addresses=new Set();
 for(const r of routes){if(!isUuid(r.installationId)||!isUuid(r.venueId)||!isHostname(r.staffHostname)||!isHostname(r.publicHostname)||r.staffHostname===r.publicHostname
  ||hosts.has(r.staffHostname)||hosts.has(r.publicHostname)||!isAddress(r.address)||addresses.has(r.address)||!isPeerKey(r.peerPublicKey)||!Number.isInteger(r.port)||r.port<1||r.port>65535)throw new Error('invalid_route');
  hosts.add(r.staffHostname);hosts.add(r.publicHostname);addresses.add(r.address);}
}
export function renderHaproxy(routes:GatewayRoute[],o:HaproxyOptions):string{
 validate(routes);if(![o.port,o.publicTlsPort,o.gatePort].every(p=>Number.isInteger(p)&&p>0&&p<=65535)||new Set([o.port,o.publicTlsPort,o.gatePort]).size!==3||!/^\/[A-Za-z0-9_/-]+$/.test(o.certificateDirectory))throw new Error('invalid_gateway_options');
 if(o.traffic)validateTrafficRenderOptions(o.traffic);
 const name=(r:GatewayRoute,kind:'user'|'ops',channel:'staff'|'public')=>`traffic_${kind}_${channel}_${r.installationId.replaceAll('-','')}`;
 const selectors=o.traffic?routes.map(r=>[
  `  use_backend ${name(r,'ops','staff')} if traffic_operational { req.ssl_sni -m str ${r.staffHostname} }`,
  `  use_backend ${name(r,'ops','public')} if traffic_operational { req.ssl_sni -m str ${r.publicHostname} }`,
  `  use_backend ${name(r,'user','staff')} if { req.ssl_sni -m str ${r.staffHostname} }`,
  `  use_backend ${name(r,'user','public')} if { req.ssl_sni -m str ${r.publicHostname} }`,
 ].join('\n')).join('\n'):routes.map(r=>`  use_backend venue_${r.installationId.replaceAll('-','')} if { req.ssl_sni -m str ${r.staffHostname} }
  use_backend public_tls if { req.ssl_sni -m str ${r.publicHostname} }`).join('\n');
 const backends=o.traffic?routes.map(r=>(['user','ops'] as const).map(kind=>`backend ${name(r,kind,'staff')}
  server venue ${r.address}:${r.port} maxconn 32
backend ${name(r,kind,'public')}
  server edge 127.0.0.1:${o.publicTlsPort} send-proxy-v2 maxconn 128`).join('\n')).join('\n'):routes.map(r=>`backend venue_${r.installationId.replaceAll('-','')}
  server venue ${r.address}:${r.port} maxconn 32`).join('\n');
 // Split counters share the original destination ceilings across user and operational backends.
 const limits=o.traffic?routes.map(r=>`  tcp-request content track-sc1 str(staff_${r.installationId.replaceAll('-','')}) table traffic_connection_limits if { req.ssl_sni -m str ${r.staffHostname} }
  tcp-request content reject if { sc1_conn_cur gt 32 } { req.ssl_sni -m str ${r.staffHostname} }
  tcp-request content track-sc1 str(public) table traffic_connection_limits if { req.ssl_sni -m str ${r.publicHostname} }
  tcp-request content reject if { sc1_conn_cur gt 128 } { req.ssl_sni -m str ${r.publicHostname} }`).join('\n')+'\n':'';
 return `global
  maxconn 512
  hard-stop-after 5s
  log stdout format raw local0
${o.traffic?`  stats socket ${o.traffic.socket} mode 600 level operator\n`:''}defaults
  mode tcp
  timeout connect 3s
  timeout client 60s
  timeout server 60s
frontend ingress
  bind :${o.port}
  stick-table type ip size 10000 expire 1m store conn_cur,conn_rate(10s)
  tcp-request connection track-sc0 src
  tcp-request connection reject if { sc0_conn_cur gt 32 }
  tcp-request connection reject if { sc0_conn_rate gt 60 }
  tcp-request inspect-delay 5s
${limits}  tcp-request content accept if { req.ssl_hello_type 1 }
${o.traffic?`  acl traffic_operational src ${o.traffic.operationalSources.join(' ')}\n`:''}${selectors}
  default_backend denied
backend denied
  tcp-request content reject
backend public_tls
  server edge 127.0.0.1:${o.publicTlsPort} send-proxy-v2 maxconn 128
frontend public_https
  bind 127.0.0.1:${o.publicTlsPort} accept-proxy ssl crt ${o.certificateDirectory} strict-sni
  mode http
  timeout http-request 10s
  timeout http-keep-alive 10s
  http-request set-header X-Waitron-Client-IP %[src]
  http-request set-header X-Waitron-SNI %[ssl_fc_sni]
  http-request del-header Forwarded
  http-request del-header X-Forwarded-For
  default_backend public_gate
backend public_gate
  mode http
  server gate 127.0.0.1:${o.gatePort} maxconn 128
${backends}
${o.traffic?'backend traffic_connection_limits\n  stick-table type string len 64 size 128 store conn_cur\n':''}`;
}
export function renderWireGuard(routes:GatewayRoute[]):string{
 validate(routes);return routes.map(r=>`[Peer]\nPublicKey = ${r.peerPublicKey}\nAllowedIPs = ${r.address}/32\n`).join('\n');
}
