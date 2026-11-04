import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const runner = process.env.TEST_CLOUD_CANCELLATION_RUNNER ?? new URL('./test-cloud-integration.mjs', import.meta.url).href;

// Removing the whole-run handler abandons scratch and the fixed-project lock in an HTTPS gap.
for (const phase of ['HTTPS gap', 'polling wait']) for (const signal of ['SIGINT', 'SIGTERM']) test(signal + ' in a ' + phase + ' drains owned cleanup and releases admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-cancellation-'));
  try {
    const bin = join(root, 'bin'), scratch = join(root, 'scratch');
    await mkdir(bin); await mkdir(scratch);
    await writeFile(join(bin, 'docker'), String.raw`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),root=process.env.CANCEL_ROOT;
fs.appendFileSync(root+'/calls',JSON.stringify(args)+'\n');
const calls=fs.readFileSync(root+'/calls','utf8').trim().split('\n').map(JSON.parse);
const build=calls.find(a=>a[0]==='build'),owner=build?.find(a=>a.startsWith('cloud.integration.owner='))?.split('=')[1];
if(args[0]==='ps'||['network','volume','image'].includes(args[0])&&args[1]==='ls'){}
else if(args[0]==='image'&&args[1]==='inspect')process.stdout.write(JSON.stringify([{Id:'sha256:'+'c'.repeat(64),RepoTags:['pin:local'],Config:{Labels:{'cloud.waitron-revision':'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7','cloud.integration.owner':owner}}}]));
else if(args[0]==='build'){}
else if(args[0]==='image'&&args[1]==='rm'){process.kill(process.ppid,'SIGTERM');setTimeout(()=>{},100);}
else if(args[0]==='compose'){
 if(args.includes('config'))process.stdout.write(JSON.stringify({services:{account:{}},networks:{},volumes:{}}));
 else if(args.includes('ps'))process.stdout.write('a'.repeat(64));
 else if(args.includes('port'))process.stdout.write('127.0.0.1:12345');
 else if(!args.includes('up'))process.exitCode=34;
}else if(args[0]==='exec'&&args.includes('cat'))process.stdout.write('-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----');
else process.exitCode=35;
`, {mode: 0o700});
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {EventEmitter} from 'node:events';
const before=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));
const timers=await import('node:timers/promises');
mock.module('node:timers/promises',{namedExports:{...timers,setTimeout:(...args)=>{
 if(${phase === 'polling wait'}&&args[0]===100)setImmediate(()=>process.kill(process.pid,${JSON.stringify(signal)}));
 return timers.setTimeout(...args);
}}});
globalThis.fetch=async()=>({text:async()=>JSON.stringify({messages:[]})});
mock.module('node:https',{namedExports:{request:(options,respond)=>{
 const req=new EventEmitter(); let deadline; req.setTimeout=(ms,fail)=>{deadline=setTimeout(fail,ms);};
 const abort=()=>req.destroy(options.signal.reason);
 req.destroy=error=>{clearTimeout(deadline);options.signal?.removeEventListener('abort',abort);req.emit('error',error);};
 options.signal?.addEventListener('abort',abort,{once:true});
 req.end=()=>setImmediate(()=>{
  if(${phase === 'HTTPS gap'})return process.kill(process.pid,${JSON.stringify(signal)});
  clearTimeout(deadline);
  if(options.ca===null||options.servername==='wrong.local')return req.destroy(Error('certificate verify refused'));
  const res=new EventEmitter();res.statusCode=options.path.includes('signup')?202:200;respond(res);
  options.signal?.removeEventListener('abort',abort);res.emit('data','{}');res.emit('end');
 });return req;
}}});
const {runTestCloudClients}=await import(${JSON.stringify(runner)});
await assert.rejects(runTestCloudClients({image:'sha256:'+'b'.repeat(64),waitronImage:'sha256:'+'c'.repeat(64),fixedProject:true}),/integration.cancelled/);
assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),before);
    `], {encoding: 'utf8', timeout: 12000, env: {...process.env, HOME: root, NODE_NO_WARNINGS: '1', CANCEL_ROOT: root,
      PATH: bin + ':' + process.env.PATH, TMPDIR: scratch, TMP: scratch, TEMP: scratch}});
    assert.equal(result.signal, null, 'The runner was killed instead of unwinding cleanup');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    const commands = (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(commands.some(a => a[0] === 'image' && a[1] === 'rm'), 'Owned image must be removed');
    assert.deepEqual(await readdir(scratch), [], 'Scratch and admission lock must be released');
  } finally {await rm(root, {recursive: true, force: true});}
});
