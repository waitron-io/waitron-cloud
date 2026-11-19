import {createSocket} from 'node:dgram';
import {lookup} from 'node:dns';
import {once} from 'node:events';
import {createConnection, createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const [primary, upstreamPort = '31820', listenPort = '51820', listenHost = '0.0.0.0', tcpPort = '30443', ...standbys] = process.argv.slice(2);
const hosts = [primary, ...standbys];
const inbound = createSocket('udp4');
let peer, upstream, route, misses = 0;

function lookupAddress(host) {
  return new Promise(resolve => lookup(host, {family: 4}, (error, address) => resolve(error ? undefined : address)));
}

function reachable(address) {
  return new Promise(resolve => {
    const socket = createConnection({host: address, port: 30443}, () => {
      resolve(true);
      socket.destroy();
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => resolve(false));
    socket.setTimeout(500, () => socket.destroy());
  });
}

async function checkRoutes() {
  const candidates = await Promise.all(hosts.map(async host => {
    const address = await lookupAddress(host);
    return {host, address, healthy: address && await reachable(address)};
  }));
  const current = candidates.find(candidate => candidate.host === route?.host);
  misses = current?.healthy ? 0 : misses + 1;
  // A shared Service can briefly fail on healthy nodes while Kubernetes withdraws a stopped endpoint.
  const canSwitchNodes = !route || misses >= 3;
  const next = current?.healthy ? current : canSwitchNodes && candidates.find(candidate => candidate.healthy);
  if (!next || next.address === route?.address) return;

  const socket = createSocket('udp4');
  socket.on('error', error => {
    if (!['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code)) throw error;
    console.log('remote.relay_endpoint_unavailable');
  });
  socket.on('message', data => {if (peer) inbound.send(data, peer.port, peer.address);});
  socket.connect(Number(upstreamPort), next.address);
  await once(socket, 'connect');
  upstream?.close();
  upstream = socket;
  route = next;
  misses = 0;
}

const tcp = createServer({allowHalfOpen: true}, client => {
  if (!route) return client.destroy();
  const server = createConnection({host: route.address, port: 30443, allowHalfOpen: true});
  client.on('error', () => server.destroy());
  server.on('error', () => client.destroy());
  client.on('close', () => {if (!client.readableEnded) server.destroy();});
  server.on('close', () => {if (!server.readableEnded) client.destroy();});
  client.pipe(server).pipe(client);
});
inbound.on('message', (data, source) => {
  peer = source;
  upstream?.send(data);
});
tcp.listen(Number(tcpPort), listenHost);
inbound.bind(Number(listenPort), listenHost);
await Promise.all([once(tcp, 'listening'), once(inbound, 'listening')]);
console.log(JSON.stringify({tcp: tcp.address().port, udp: inbound.address().port}));
while (true) {
  await checkRoutes();
  await delay(1000);
}
