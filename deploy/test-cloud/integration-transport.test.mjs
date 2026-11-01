import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,connect} from 'node:net';
const load=()=>import('./test-fixtures/integration-transport.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith('/integration-transport.mjs'))return {};
  throw error;
});

test('the fixture forwards exact bytes and drains connections when closed',async()=>{
  const {forwardIntegrationPort}=await load();assert.equal(typeof forwardIntegrationPort,'function','Private port forwarding is missing');
  const upstream=new Set(),clients=new Set();let timer;
  let connections=0,heldReady;const accepted=new Promise(resolve=>{heldReady=resolve;});
  const server=createServer(socket=>{
    upstream.add(socket);socket.once('close',()=>upstream.delete(socket));
    if(++connections===2)heldReady();
    socket.once('data',part=>socket.end(Buffer.concat([Buffer.from('storage:'),part])));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let bridge;
  try {
    bridge=await forwardIntegrationPort({port:0,targetHost:'127.0.0.1',targetPort:server.address().port});
    const socket=connect(bridge.port,'127.0.0.1');clients.add(socket);socket.write('private bytes');
    const output=await new Promise((resolve,reject)=>{let output='';socket.on('data',part=>output+=part);socket.once('error',reject);socket.once('close',()=>resolve(output));});
    assert.equal(output,'storage:private bytes');
    const held=connect(bridge.port,'127.0.0.1');clients.add(held);held.on('error',()=>{});
    const closed=new Promise(resolve=>held.once('close',resolve));
    await new Promise(resolve=>held.once('connect',resolve));await accepted;
    await Promise.race([bridge.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('bridge failed to drain')),500);})]);clearTimeout(timer);await closed;
    await assert.rejects(new Promise((resolve,reject)=>{const refused=connect(bridge.port,'127.0.0.1');refused.once('error',reject);refused.once('connect',()=>{refused.destroy();resolve();});}),{code:'ECONNREFUSED'});
  } finally {clearTimeout(timer);for(const socket of [...clients,...upstream])socket.destroy();await bridge?.close();await new Promise(resolve=>server.close(resolve));}
});
