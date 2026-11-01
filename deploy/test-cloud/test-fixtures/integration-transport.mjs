import {createServer,connect} from 'node:net';

// These fixture tunnels forward TLS bytes; they never terminate TLS or change signed hosts.
export async function forwardIntegrationPort({port,targetHost,targetPort}) {
  const sockets=new Set();
  const server=createServer(incoming=>{
    const outgoing=connect(targetPort,targetHost);
    for(const socket of [incoming,outgoing]) {
      sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
      socket.once('error',()=>{incoming.destroy();outgoing.destroy();});
    }
    incoming.pipe(outgoing);outgoing.pipe(incoming);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  let closing;
  return {port:server.address().port,close(){
    if(!closing) closing=new Promise((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve());
      for(const socket of sockets)socket.destroy();
    });
    return closing;
  }};
}
export async function startIntegrationTransport() {
  const bridges=[];
  try {
    bridges.push(await forwardIntegrationPort({port:3000,targetHost:'proxy',targetPort:3000}));
    bridges.push(await forwardIntegrationPort({port:8333,targetHost:'storage',targetPort:8333}));
    return async()=>{await Promise.all(bridges.map(bridge=>bridge.close()));};
  } catch(error) {await Promise.all(bridges.map(bridge=>bridge.close()));throw error;}
}
