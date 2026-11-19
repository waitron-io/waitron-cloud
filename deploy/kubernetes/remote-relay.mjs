import {createSocket} from 'node:dgram';

const [host, upstreamPort = '31820', listenPort = '51820', listenHost = '0.0.0.0'] = process.argv.slice(2);
const inbound = createSocket('udp4'), upstream = createSocket('udp4');
let peer;

// The NodePort can refuse datagrams between the old and new ready endpoints.
upstream.on('error', error => {
  if (error.code !== 'ECONNREFUSED') throw error;
  console.log('remote.relay_endpoint_unavailable');
});

upstream.connect(Number(upstreamPort), host, () => {
  inbound.on('message', (data, source) => {peer = source; upstream.send(data);});
  inbound.bind(Number(listenPort), listenHost, () => console.log(inbound.address().port));
});
upstream.on('message', data => {if (peer) inbound.send(data, peer.port, peer.address);});
