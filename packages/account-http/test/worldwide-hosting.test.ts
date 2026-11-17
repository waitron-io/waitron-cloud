import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {ConsoleAuth} from '../src/worldwide/auth.ts';
import {startConsole} from '../src/worldwide/server-cli.ts';
import {CountryReadiness} from '../src/worldwide/countries.ts';
import {worldwideDatabase, consolePort} from './worldwide-fixture.ts';
const exec = promisify(execFile);
test('admin CLI bootstraps a separate database and the server starts only its console runtime', async t => {
  const db = await worldwideDatabase(); t.after(() => db.close());
  const env = {...process.env,DATABASE_URL:db.connection.connectionString,PGOPTIONS:db.connection.options};
  const cli = new URL('../src/worldwide/admin-cli.ts',import.meta.url).pathname;
  const created = await exec(process.execPath,[cli,'create','Local administrator'],{env});
  assert.match(created.stdout.trim(),/^[A-Za-z0-9_-]{43}$/);
  await exec(process.execPath,[cli,'disable','Local administrator'],{env});
  assert.ok((await db.pool.query('SELECT disabled_at FROM cloud_accounts')).rows[0].disabled_at);
  const port = await consolePort(); const origin = `http://localhost:${port}`;
  const running = await startConsole({auth:new ConsoleAuth(db.pool,origin),countries:new CountryReadiness({ES:'https://es.example.test'}),rateKey:randomBytes(32).toString('hex'),port});
  try {
    const response = await fetch(`http://localhost:${running.port}/`);
    assert.equal(response.status,200); assert.match(await response.text(),/worldwide.js/);
    assert.equal((await fetch(`http://localhost:${running.port}/api/account/signup`)).status,404);
  } finally {await running.close();}
  await db.pool.query('CREATE TABLE schema_migrations(name text)');
  let unexpected: Awaited<ReturnType<typeof startConsole>> | undefined;
  try {await assert.rejects(async () => {unexpected=await startConsole({auth:new ConsoleAuth(db.pool,'http://localhost:3000'),countries:new CountryReadiness({ES:'https://es.example.test'}),rateKey:randomBytes(32).toString('hex'),port:0});},/customer database/);}
  finally {await unexpected?.close();}
});

test('real TLS proxy redirects only apex root to Spain and admits the console host', async () => {
  const {mkdtemp,readFile,writeFile,rm} = await import('node:fs/promises');
  const {existsSync} = await import('node:fs');
  const {tmpdir} = await import('node:os'); const {join} = await import('node:path');
  const {request} = await import('node:https'); const {randomUUID} = await import('node:crypto');
  const config = new URL('../../../deploy/worldwide/proxy.cfg',import.meta.url);
  assert.ok(existsSync(config),'Worldwide TLS proxy must be supplied');
  const directory = await mkdtemp(join(tmpdir(),'console-proxy-')); const name = 'cloud-console-proxy-'+randomUUID(); let owned=false;
  try {
    await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=console.example.test','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem')]);
    await writeFile(join(directory,'tls.pem'),await readFile(join(directory,'cert.pem'),'utf8')+await readFile(join(directory,'key.pem'),'utf8'));
    await writeFile(join(directory,'proxy.cfg'),await readFile(config));
    try {await exec('docker',['image','inspect','haproxy:3.2-alpine']);} catch {await exec('docker',['pull','haproxy:3.2-alpine'],{timeout:120000});}
    await exec('docker',['run','--detach','--rm','--name',name,'--publish','127.0.0.1::8443','--volume',`${directory}:/run/console:ro`,'--env','CONSOLE_HOST=console.example.test','--env','APEX_HOST=example.test','haproxy:3.2-alpine','haproxy','-W','-db','-f','/run/console/proxy.cfg']); owned=true;
    const port = Number((await exec('docker',['port',name,'8443/tcp'])).stdout.trim().split(':').at(-1));
    const get = (host:string,path:string) => new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders}>((resolve,reject) => {
      const req = request({hostname:'127.0.0.1',port,path,headers:{host,cookie:'country_session=never-forward'},rejectUnauthorized:false},response=>{
        response.resume();response.on('end',()=>resolve({status:response.statusCode!,headers:response.headers}));
      });req.setTimeout(1000,()=>req.destroy(new Error('Proxy timeout')));req.on('error',reject);req.end();
    });
    let ready=false;
    for(let n=0;n<30;n++) {try {await get('example.test','/');ready=true;break;} catch {await new Promise(resolve=>setTimeout(resolve,100));}}
    assert.ok(ready,(await exec('docker',['logs',name])).stdout);
    const root=await get('example.test','/?next=https://elsewhere.test/private');
    assert.equal(root.status,302);assert.equal(root.headers.location,'https://es.waitron.io/');assert.equal(root.headers['set-cookie'],undefined);
    assert.equal((await get('example.test','/api/account/session')).status,404);
    assert.equal((await get('console.example.test','/')).status,503);
    assert.equal((await get('elsewhere.test','/')).status,403);
  } finally {if(owned) await exec('docker',['rm','--force',name]);await rm(directory,{recursive:true,force:true});}
});
test('an empty dedicated database can start before the first admin is provisioned', async t => {
  const db = await worldwideDatabase(); t.after(()=>db.close()); const port=await consolePort();
  const running=await startConsole({auth:new ConsoleAuth(db.pool,`http://localhost:${port}`),countries:new CountryReadiness({ES:'https://es.example.test'}),rateKey:'ab'.repeat(32),port});
  try {assert.equal((await fetch(`http://localhost:${port}/api/health/ready`)).status,200);}
  finally {await running.close();}
});
