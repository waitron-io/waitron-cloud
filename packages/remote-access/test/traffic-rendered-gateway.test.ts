import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {test} from 'node:test';

// A missing image or failed fixture is a failure: CI must execute the real candidate renderer and HAProxy.
test('candidate image exercises rendered TLS probes and venue counters without leftover resources',{timeout:240000},t=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),tag='cloud-traffic-tls-'+randomUUID();
 const fixture=resolve(root,'packages/remote-access/test/fixtures/traffic-rendered-haproxy.ts');
 const docker=(args:string[],timeout=30000)=>execFileSync('docker',args,{cwd:root,timeout,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}).toString();
 const inventory=()=>{
  const ids=docker(['ps','-aq','--no-trunc']).trim().split('\n').filter(Boolean).sort();
  return ids.map(id=>docker(['inspect','--format','{{.Id}} {{.State.StartedAt}}',id]).trim());
 };
 const before=inventory();
 let image=false,container:string|undefined;
 try{
  docker(['build','-f','deploy/local-remote/Dockerfile','-t',tag,'.'],150000);image=true;
  container=docker(['create','--name',tag,'--network','none','--cap-add','NET_ADMIN','--memory=384m','--cpus=1','--mount',`type=bind,source=${fixture},target=/app/test/fixtures/traffic-rendered-haproxy.ts,readonly`,tag,'node','--test','--test-reporter=tap','--test-timeout=45000','test/fixtures/traffic-rendered-haproxy.ts']).trim();
  assert.match(container,/^[a-f0-9]{64}$/);
  const result=spawnSync('docker',['start','--attach',container],{cwd:root,timeout:60000,maxBuffer:8*1024*1024,encoding:'utf8'});
  const output=result.stdout+result.stderr;for(const line of output.split('\n'))t.diagnostic(line);
  if(result.error)throw result.error;
  assert.equal(result.status,0,'rendered HAProxy fixture must pass');
  assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',container]).trim(),'0',output);
  assert.match(output,/# pass 1\b/);assert.match(output,/# fail 0\b/);assert.match(output,/# skipped 0\b/);
 }finally{
  if(container)docker(['rm','--force',container]);
  if(image)docker(['image','rm',tag]);
  assert.equal(docker(['ps','-aq','--filter','name=^/'+tag+'$']).trim(),'');
  assert.equal(docker(['image','ls','--quiet',tag]).trim(),'');
  assert.deepEqual(inventory(),before,'foreign container identities and start times must survive the fixture');
  t.diagnostic('owned image/container removed; foreign container identities/start times unchanged');
 }
});
