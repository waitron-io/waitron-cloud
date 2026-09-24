import {isAddress,isHostname,isPeerKey,isUuid,type GatewayRoute} from './manifest.ts';
interface HaproxyOptions {port:number;publicTlsPort:number;gatePort:number;certificateDirectory:string}
function validate(routes:GatewayRoute[]){
 if(routes.length>64)throw new Error('invalid_routes');const hosts=new Set(),addresses=new Set();
 for(const r of routes){if(!isUuid(r.installationId)||!isUuid(r.venueId)||!isHostname(r.staffHostname)||!isHostname(r.publicHostname)||r.staffHostname===r.publicHostname
  ||hosts.has(r.staffHostname)||hosts.has(r.publicHostname)||!isAddress(r.address)||addresses.has(r.address)||!isPeerKey(r.peerPublicKey)||!Number.isInteger(r.port)||r.port<1||r.port>65535)throw new Error('invalid_route');
  hosts.add(r.staffHostname);hosts.add(r.publicHostname);addresses.add(r.address);}
}
export function renderHaproxy(routes:GatewayRoute[],o:HaproxyOptions):string{
 validate(routes);if(![o.port,o.publicTlsPort,o.gatePort].every(p=>Number.isInteger(p)&&p>0&&p<=65535)||new Set([o.port,o.publicTlsPort,o.gatePort]).size!==3||!/^\/[A-Za-z0-9_/-]+$/.test(o.certificateDirectory))throw new Error('invalid_gateway_options');
 return `global
  maxconn 512
  hard-stop-after 5s
  log stdout format raw local0
defaults
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
  tcp-request content accept if { req.ssl_hello_type 1 }
${routes.map(r=>`  use_backend venue_${r.installationId.replaceAll('-','')} if { req.ssl_sni -m str ${r.staffHostname} }
  use_backend public_tls if { req.ssl_sni -m str ${r.publicHostname} }`).join('\n')}
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
${routes.map(r=>`backend venue_${r.installationId.replaceAll('-','')}
  server venue ${r.address}:${r.port} maxconn 32`).join('\n')}
`;
}
export function renderWireGuard(routes:GatewayRoute[]):string{
 validate(routes);return routes.map(r=>`[Peer]\nPublicKey = ${r.peerPublicKey}\nAllowedIPs = ${r.address}/32\n`).join('\n');
}
