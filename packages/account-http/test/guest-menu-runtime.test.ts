import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {guestTlsFixture} from './fixtures/guest-menu.ts';

test('the account CLI starts and stops the separate guest HTTPS listener from operator settings',async()=>{
 const f=await guestTlsFixture();await f.seed();
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${f.db.schema}`);
 const child=spawn(process.execPath,[new URL('../src/server-cli.ts',import.meta.url).pathname],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:url.href,CLOUD_PORTAL_ORIGIN:'http://localhost',CLOUD_HTTP_PORT:'0',CLOUD_HTTP_RATE_KEY:f.db.rateKey,CLOUD_HTTP_HOST:'127.0.0.1',CLOUD_HTTP_TRUSTED_PROXY_IPS:'',CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(f.db.keys),GUEST_ORIGIN:f.origin,GUEST_HTTP_PORT:'0',GUEST_TLS_KEY_FILE:f.keyFile,GUEST_TLS_CERT_FILE:f.certFile},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const deadline=setTimeout(()=>child.kill('SIGKILL'),15000);
 try{
  const ready=await Promise.race([new Promise<string>(resolve=>{child.stdout.on('data',()=>{if(stdout.includes('\n'))resolve(stdout.trim());});}),exited.then(()=>{throw Error('CLI exited: '+stderr);})]);
  const value=JSON.parse(ready);assert.equal(typeof value.guestPort,'number');
  const response=await f.send(value.guestPort,'/m/'+f.venueId);assert.equal(response.status,200);assert.equal(response.body,'<h1>Menu</h1>');
 }finally{child.kill('SIGTERM');const [code,signal]=await exited;clearTimeout(deadline);await f.close();assert.equal(code,0);assert.equal(signal,null);}
});
