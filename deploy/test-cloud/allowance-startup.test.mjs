import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {test} from 'node:test';

// Missing startup validation would connect to this real socket before refusing configuration.
for(const [path,message] of [
 ['deploy/test-cloud/account-worker.mjs','Account server failed; check database, migrations and configuration'],
 ['packages/account-http/src/server-cli.ts','Account server failed; check database, migrations and configuration'],
 ['packages/translation/src/worker-cli.ts','Translation worker failed; check database, migrations and provider configuration'],
])test(path+' refuses invalid allowance settings before connecting to a database',async t=>{
 let connections=0;const server=createServer(socket=>{connections++;socket.destroy();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const address=server.address();assert.ok(address&&typeof address!=='string');
 const child=spawn(process.execPath,[new URL('../../'+path,import.meta.url).pathname],{env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:'+address.port+'/fixture',CLOUD_VENUE_SERVICE_LEVELS:'test',CLOUD_TEST_ALLOWANCES:'1',CLOUD_ALLOWANCE_CALENDAR:'Europe/Rome',CLOUD_OPENAI_API_KEY:'synthetic-only',CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify({test:'ab'.repeat(32)}),CLOUD_PORTAL_ORIGIN:'http://localhost',CLOUD_HTTP_RATE_KEY:'ab'.repeat(32)},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const deadline=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{const [code,signal]=await once(child,'close');assert.deepEqual([code,signal,stdout,stderr,connections],[1,null,'',message+'\n',0]);}
 finally{clearTimeout(deadline);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'close');}}
});
