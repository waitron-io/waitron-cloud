import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

// Only the observer's first DATA reply changes. The real mailer still receives
// the backend's original bytes through the socket's separate pipe listener.
export function perturbMailObserver(t, targetPort) {
  const original = net.connect;
  let changed = 0;
  net.connect = (...args) => {
    const socket = original(...args);
    if (Number(args[0]) !== targetPort) return socket;
    const on = socket.on, write = socket.write;
    let parser = false, body = false, tail = '';
    socket.write = function(chunk, ...rest) {
      const text = tail + chunk.toString('latin1');
      if (text.includes('\r\n.\r\n')) body = true;
      tail = text.slice(-4);
      return Reflect.apply(write, this, [chunk, ...rest]);
    };
    socket.on = function(event, listener) {
      if (event === 'data' && !parser) {
        parser = true;
        return Reflect.apply(on, this, [event, function(chunk) {
          if (body && !changed && chunk.subarray(0, 4).toString('latin1') === '250 ') {
            const observation = Buffer.from(chunk); observation.write('451', 0, 'latin1'); changed++;
            return listener.call(this, observation);
          }
          return listener.call(this, chunk);
        }]);
      }
      return Reflect.apply(on, this, [event, listener]);
    };
    return socket;
  };
  syncBuiltinESMExports();
  t.after(() => { net.connect = original; syncBuiltinESMExports(); });
  return { changed: () => changed };
}
