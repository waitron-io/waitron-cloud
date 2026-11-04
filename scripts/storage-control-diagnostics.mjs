import {execFileSync} from 'node:child_process';

export function storageControlOutput(child, report) {
  let output = '';
  const receive = text => {
    output += text;
    // The parent can time out before its child exits; publish each chunk now.
    try {report(text);} catch {}
  };
  child.stdout.setEncoding('utf8').on('data', receive);
  child.stderr.setEncoding('utf8').on('data', receive);
  return () => output;
}

function inspectSockets(source, args) {
  try {
    return {source,output:execFileSync(source,args,
      {encoding:'utf8',timeout:5000,killSignal:'SIGKILL',maxBuffer:65536,stdio:['ignore','pipe','pipe']})};
  } catch (failure) {
    const reason = failure.code ?? (failure.signal ? 'signal_' + failure.signal : 'exit_' + failure.status);
    // A nonzero inspector exit is not evidence that the tool was absent.
    const ran = failure.status !== null || failure.signal !== null;
    return ran
      ? {source,output:failure.stdout ?? '',stderr:failure.stderr ?? '',
        status:failure.status,signal:failure.signal,reason}
      : {source:'unavailable',reason};
  }
}

export async function listenStorageControl(server, port, stage) {
  try {
    await new Promise((resolve, reject) => {
      const refused = error => {server.off('listening', ready); reject(error);};
      const ready = () => {server.off('error', refused); resolve();};
      server.once('error', refused);
      server.once('listening', ready);
      server.listen(port, '127.0.0.1');
    });
  } catch (error) {
    const refusedPort = error.port ?? port;
    const socketOwners = inspectSockets('lsof',['-nP','-iTCP:' + refusedPort,'-FpcnT']);
    // Linux lsof can omit bound sockets that have not entered TCP's listen table.
    if (process.platform === 'linux' && socketOwners.source === 'lsof' && socketOwners.output === '') {
      socketOwners.boundInactive = inspectSockets('ss',['-B','-tnp','sport = :' + refusedPort]);
    }
    // Snapshot before caller cleanup, preserving the original bind refusal.
    error.storageControl = {stage,port:refusedPort,socketOwners};
    throw error;
  }
}
