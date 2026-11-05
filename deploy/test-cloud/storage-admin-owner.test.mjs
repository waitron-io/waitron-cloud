import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {once} from 'node:events';
import test from 'node:test';
import {createAdminPortOwner} from './storage-admin-owner.mjs';

// Without draining probe bytes, a closed peer can leave the owner unable to close.
test('admin port owners close after a peer sends an HTTP/2 preface and disconnects', {timeout:5000}, async t => {
  const server = createAdminPortOwner(7), accepted = new Set();
  server.on('connection', socket => accepted.add(socket));
  t.after(() => {
    for (const socket of accepted) socket.destroy();
    if (server.listening) server.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = connect({host:'127.0.0.1', port:server.address().port});
  t.after(() => client.destroy());
  const disconnected = once(client, 'close');
  let marker = '';
  client.setEncoding('utf8');
  client.on('data', bytes => {marker += bytes;});
  client.end('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');
  await disconnected;
  assert.equal(marker, 'admin-owner-7');
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('owner did not close after its probe peer disconnected')), 1000);
      }),
    ]);
  } finally {clearTimeout(timer);}
  assert.equal(server.listening, false);
  assert.equal(accepted.size, 1);
  for (const socket of accepted) assert.equal(socket.destroyed, true);
});
