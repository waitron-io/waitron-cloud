import {createSocket} from 'node:dgram';
import {lookup} from 'node:dns';
import {once} from 'node:events';
import {createConnection, createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {connect as connectTls} from 'node:tls';

const [primary, upstreamPort = '31820', listenPort = '51820', listenHost = '0.0.0.0', tcpPort = '30443', ...args] = process.argv.slice(2);
const hosts = [primary, ...args.filter(value => !value.startsWith('--tcp='))];
const inbound = createSocket('udp4');
const probeTimeoutMs = 500;
let peer, upstream, route, misses = 0;

function lookupAddress(host) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, probeTimeoutMs);
    lookup(host, {family: 4}, (error, address) => {
      clearTimeout(timer);
      resolve(error ? undefined : address);
    });
  });
}

function reachable(address, port, tlsProbe = false) {
  return new Promise(resolve => {
    const options = {host: address, port};
    // Readiness only checks for a completed handshake. Clients verify TLS through the byte stream.
    const socket = tlsProbe ? connectTls({...options, rejectUnauthorized: false}, ready) : createConnection(options, ready);
    const timer = setTimeout(() => socket.destroy(), probeTimeoutMs);
    function ready() {
      resolve(true);
      socket.destroy();
    }
    socket.once('error', () => socket.destroy());
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function checkGateway(addresses) {
  const candidates = await Promise.all(addresses.map(async row =>
    ({...row, healthy: row.address && await reachable(row.address, 30443)})));
  const current = candidates.find(candidate => candidate.host === route?.host);
  const healthy = candidates.find(candidate => candidate.healthy);
  // Only count failures while another node has a working path to the shared Service.
  misses = current?.healthy || !healthy ? 0 : misses + 1;
  const canSwitchNodes = !route || misses >= 3;
  const next = current?.healthy ? current : canSwitchNodes && healthy;
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

function tcpRelay(port, address) {
  return createServer({allowHalfOpen: true}, client => {
    const host = address();
    if (!host) return client.destroy();
    const server = createConnection({host, port, allowHalfOpen: true});
    client.on('error', () => server.destroy());
    server.on('error', () => client.destroy());
    client.on('close', () => {if (!client.readableEnded) server.destroy();});
    server.on('close', () => {if (!server.readableEnded) client.destroy();});
    client.pipe(server).pipe(client);
  });
}

const tcp = tcpRelay(30443, () => route?.address);
const services = args.filter(value => value.startsWith('--tcp=')).map(value => {
  const [listen, destination, probe] = value.slice('--tcp='.length).split(':');
  const port = Number(destination);
  const tlsProbe = probe === 'tls';
  let active, checked = false;
  const server = tcpRelay(port, () => active?.address);
  server.listen(Number(listen), listenHost);
  return {server, async check(addresses) {
    const healthy = (await Promise.all(addresses.map(async row =>
      row.address && await reachable(row.address, port, tlsProbe) ? row : undefined))).filter(Boolean);
    const next = healthy.find(row => row.host === active?.host) ?? healthy[0];
    if (tlsProbe && (!checked || next?.host !== active?.host || next?.address !== active?.address)) {
      console.log(JSON.stringify({event: 'remote.relay_account_target', at: new Date().toISOString(),
        target: next?.host ?? null, address: next?.address ?? null}));
    }
    checked = true;
    active = next;
  }};
});
inbound.on('message', (data, source) => {
  peer = source;
  upstream?.send(data);
});
tcp.listen(Number(tcpPort), listenHost);
inbound.bind(Number(listenPort), listenHost);
await Promise.all([once(tcp, 'listening'), once(inbound, 'listening'),
  ...services.map(({server}) => once(server, 'listening'))]);
console.log(JSON.stringify({tcp: tcp.address().port, udp: inbound.address().port,
  ...(services.length && {services: services.map(({server}) => server.address().port)})}));
while (true) {
  const addresses = await Promise.all(hosts.map(async host => ({host, address: await lookupAddress(host)})));
  await Promise.all([checkGateway(addresses), ...services.map(service => service.check(addresses))]);
  await delay(1000);
}
