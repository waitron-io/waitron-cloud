import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const runner = new URL('./test-cloud-integration.mjs', import.meta.url).href;
const sourceModule = new URL('../deploy/test-cloud/test-fixtures/integration-source.mjs', import.meta.url).href;
const waitronModule = new URL('../deploy/test-cloud/test-fixtures/integration-waitron-source.mjs', import.meta.url).href;
const sha = value => createHash('sha256').update(value).digest('hex');

// An image-supplied reader can echo the expected digest without ever measuring its changed file.
test('the actual runner refuses a changed Cloud file even when its image supplies a lying reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-trusted-reader-'));
  try {
    const bin = join(root, 'bin'), image = join(root, 'image');
    await mkdir(bin); await mkdir(join(image, 'scripts'), {recursive: true});
    await writeFile(join(image, 'package.json'), '{"tampered":true}\n');
    await writeFile(join(image, 'scripts/test-cloud-image-source.mjs'), `import {createHash} from 'node:crypto';let s='';for await(const b of process.stdin)s+=b;const v=JSON.parse(s);console.log(JSON.stringify({files:v.files.length,runtimeSha256:createHash('sha256').update(JSON.stringify(v.files)).digest('hex')}));`);
    await writeFile(join(bin, 'docker'), String.raw`#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2),root=process.env.READER_ROOT;
fs.appendFileSync(root+'/calls',JSON.stringify(args)+'\n');
if(args[0]==='ps'){}
else if(args[0]==='create'){fs.writeFileSync(root+'/create',JSON.stringify(args));process.stdout.write('a'.repeat(64));}
else if(args[0]==='start'){
 const create=JSON.parse(fs.readFileSync(root+'/create')),command=create.slice(create.indexOf('sha256:'+'b'.repeat(64))+1);
 const result=cp.spawnSync(process.execPath,command,{cwd:root+'/image',input:fs.readFileSync(0),encoding:'utf8'});
 process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status;
}else if(args[0]==='rm')fs.writeFileSync(root+'/removed',args.at(-1));
else process.exitCode=39;
`, {mode: 0o700});
    const file = {path: 'package.json', sha256: sha(await readFile(new URL('../package.json', import.meta.url)))};
    const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
import assert from 'node:assert/strict';import {mock} from 'node:test';
const actual=await import(${JSON.stringify(sourceModule)});
mock.module(${JSON.stringify(sourceModule)},{namedExports:{...actual,captureIntegrationSource:async()=>({files:[${JSON.stringify(file)}]})}});
const waitron=await import(${JSON.stringify(waitronModule)});
mock.module(${JSON.stringify(waitronModule)},{namedExports:{...waitron,captureWaitronSource:async()=>({})}});
const {runTestCloudClients}=await import(${JSON.stringify(runner)});
await assert.rejects(runTestCloudClients({image:'sha256:'+'b'.repeat(64),waitronImage:'sha256:'+'c'.repeat(64),sourceProvenance:true,waitronCheckout:'/fixture'}),/integration.command_failed:source-measure/);
`], {encoding: 'utf8', timeout: 10000, env: {...process.env, NODE_NO_WARNINGS: '1', READER_ROOT: root, PATH: bin + ':' + process.env.PATH}});
    assert.equal(child.status, 0, child.stderr);
    assert.equal(await readFile(join(root, 'removed'), 'utf8'), 'a'.repeat(64), 'The refused measuring container must be cleaned');
  } finally {await rm(root, {recursive: true, force: true});}
});

for (const name of ['trial+a.txt', 'unsupported name.txt']) test('tracked runtime input ' + name + ' is measured or refused explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-source-path-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  try {
    await mkdir(join(root, 'packages')); await writeFile(join(root, 'packages', name), 'runtime');
    await writeFile(join(root, 'package.json'), '{}\n');
    git('init', '-q'); git('add', '.'); git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Runtime paths');
    const {captureIntegrationSource, measureIntegrationFiles} = await import(sourceModule);
    if (name.includes(' ')) await assert.rejects(captureIntegrationSource(root), /integration.source_path/);
    else {
      const source = await captureIntegrationSource(root);
      assert.deepEqual(source.files.map(v => v.path), ['package.json', 'packages/trial+a.txt']);
      assert.equal((await measureIntegrationFiles(root, source.files)).files, 2);
    }
  } finally {await rm(root, {recursive: true, force: true});}
});
