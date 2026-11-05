import {createServer} from 'node:net';

export function createAdminPortOwner(marker) {
  return createServer(socket => {
    // Native readiness probes may reset their non-gRPC connection.
    socket.on('error', () => {});
    // Consume probe bytes so their EOF reaches the stream and server.close can finish.
    socket.resume();
    socket.end(marker);
  });
}
