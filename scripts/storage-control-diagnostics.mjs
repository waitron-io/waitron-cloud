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
    let socketOwners;
    try {
      socketOwners = {source:'lsof', output:execFileSync('lsof',
        ['-nP','-a','-iTCP:' + (error.port ?? port),'-sTCP:LISTEN','-Fpcn'],
        {encoding:'utf8',timeout:2000,maxBuffer:65536,stdio:['ignore','pipe','pipe']})};
    } catch (failure) {
      socketOwners = {source:'unavailable',reason:failure.code ?? 'exit_' + failure.status};
    }
    // Snapshot before caller cleanup, preserving the original bind refusal.
    error.storageControl = {stage, port:error.port ?? port, socketOwners};
    throw error;
  }
}
