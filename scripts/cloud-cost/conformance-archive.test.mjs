import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Missing progress, a false success or a bypassed digest must fail these real HTTP journeys.
for(const outcome of ['success','http-failure','digest-mismatch','timeout','interrupted','body-failure','cancel-after-body']) {
  test('archive diagnostics describe '+outcome,{timeout:8000},async()=>{
    const root=mkdtempSync(join(tmpdir(),'cost-archive-diagnostics-')),path=join(root,'fixture.tar.gz');
    const bytes=Buffer.from('public fixture archive bytes');
    const digest=createHash('sha256').update(bytes).digest('hex');
    const server=createServer((request,response)=>{
      if(outcome==='timeout')return;
      if(outcome==='http-failure'){response.writeHead(503);response.end('unavailable');return;}
      response.writeHead(200);response.write(bytes.subarray(0,7));
      if(outcome==='interrupted')return;
      setTimeout(()=>outcome==='body-failure'?response.destroy():response.end(bytes.subarray(7)),180);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/fixture.tar.gz`;
    // Accelerate the real fixed budgets only inside the disposable observer.
    // Retry timing is covered separately; keep these observers focused on diagnostics.
    const program=`
      import timerPromises from 'node:timers/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const originalDelay=timerPromises.setTimeout;
    timerPromises.setTimeout=(ms,value,options)=>originalDelay([1000,2000].includes(ms)?20:ms,value,options);
    syncBuiltinESMExports();
      import assert from 'node:assert/strict';
      const originalInterval=globalThis.setInterval;
      globalThis.setInterval=(fn,ms,...args)=>originalInterval(fn,ms===10000?40:ms,...args);
      const originalTimeout=AbortSignal.timeout;
      AbortSignal.timeout=ms=>{assert.equal(ms,120000);return originalTimeout(${outcome==='timeout'?400:4000});};
      const module=await import(${JSON.stringify(new URL('./conformance-archive.mjs',import.meta.url).href)}).catch(error=>{
        if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
      });
      assert.equal(typeof module.downloadConformanceArchive,'function','archive fetch must publish bounded diagnostics');
      const controller=new AbortController();
      ${outcome==='cancel-after-body'?`
        const originalFetch=globalThis.fetch;
        globalThis.fetch=async(...args)=>{
          const response=await originalFetch(...args),iterate=response.body[Symbol.asyncIterator].bind(response.body);
          response.body[Symbol.asyncIterator]=async function*(){for await(const chunk of iterate())yield chunk;controller.abort();};
          return response;
        };
      `:''}
      ${outcome==='interrupted'?"setTimeout(()=>controller.abort(),400);":''}
      try {
        await module.downloadConformanceArchive(${JSON.stringify(url)},${JSON.stringify(outcome==='digest-mismatch'?'0'.repeat(64):digest)},${JSON.stringify(path)},
          {signal:controller.signal,phase:'litestream-archive'});
        console.log('download-succeeded');
      } catch(error) {console.error('download-error='+error.name+':'+error.message);process.exitCode=1;}
    `;
    const child=spawn(process.execPath,['--input-type=module','-e',program],
      {env:{...process.env,NODE_AUTH_TOKEN:'generated-archive-secret'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    try {
      const result=await Promise.race([closed,delay(5000,null,{ref:false})]);
      assert.notEqual(result,null,'the download must settle within its observed budget');
      assert.equal(result.signal,null);
      const records=output.split('\n').filter(line=>line.startsWith('conformance_archive='))
        .map(line=>JSON.parse(line.slice('conformance_archive='.length)));
      assert.ok(records.length>0,'report an archive before waiting on the network: '+output);
      const started=records[0];assert.equal(started.event,'start');
      assert.equal(started.phase,'litestream-archive');assert.equal(started.url,url);
      assert.equal(started.bytesReceived,0);assert.equal(started.timeoutMs,120000);
      for(const record of records){
        assert.equal(record.phase,started.phase);assert.equal(record.url,url);assert.equal(record.timeoutMs,120000);
        assert.ok(Number.isInteger(record.elapsedMs)&&record.elapsedMs>=0);
      }
      assert.equal(output.includes('generated-archive-secret'),false);
      const ended=records.at(-1);
      const headers=records.filter(record=>record.event==='headers');
      if(outcome==='timeout')assert.deepEqual(headers,[]);
      else {
        const attempts=['http-failure','body-failure'].includes(outcome)?3:1;
        assert.equal(headers.length,attempts);
        for(const [index,header] of headers.entries()){
          assert.equal(header.attempt,index+1);assert.equal(header.status,outcome==='http-failure'?503:200);
          assert.ok(records.indexOf(header)<records.length-1);
        }
      }
      if(outcome==='success'){
        assert.equal(result.code,0);assert.equal(ended.event,'complete');assert.equal(ended.bytesReceived,bytes.length);
        assert.deepEqual(readFileSync(path),bytes);
      }else{
        assert.equal(result.code,1);assert.equal(ended.event,'failure');assert.equal(typeof ended.errorName,'string');
        assert.equal(records.some(record=>record.event==='complete'),false);
        assert.equal(existsSync(path),false,'failed or unverified bytes never reach extraction');
      }
      if(outcome==='http-failure'){assert.equal(ended.status,503);assert.match(output,/Fixture archive download failed/);}
      else if(outcome==='timeout'){
        assert.equal(ended.errorName,'TimeoutError');assert.equal(ended.bytesReceived,0);
        assert.ok(records.some(record=>record.event==='progress'&&record.bytesReceived===0),'report waiting for headers');
      }else{
        assert.equal(ended.status,200);
        assert.ok(records.some(record=>record.event==='progress'&&record.bytesReceived===7),'report bytes while the body is incomplete');
        if(outcome==='interrupted'||outcome==='cancel-after-body')assert.equal(ended.errorName,'AbortError');
      }
    }finally{
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      rmSync(root,{recursive:true,force:true});
    }
  });
}

// Calling the old unobserved fetch would hide the phase and skip these diagnostics.
test('the conformance preparer reports the pinned archive and collects failed setup',{timeout:8000},async()=>{
  const {mkdirSync,writeFileSync,readdirSync}=await import('node:fs');
  const root=mkdtempSync(join(tmpdir(),'cost-archive-wiring-')),bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'docker'),`#!${process.execPath}
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['info','--format','{{.Architecture}}']))process.exit(91);
console.log('x86_64');
`,{mode:0o700});
  const server=createServer((request,response)=>{response.writeHead(503);response.end('unavailable');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  const program=`
    import timerPromises from 'node:timers/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const originalDelay=timerPromises.setTimeout;
    timerPromises.setTimeout=(ms,value,options)=>originalDelay([1000,2000].includes(ms)?20:ms,value,options);
    syncBuiltinESMExports();
    const original=globalThis.fetch;
    globalThis.fetch=(url,options)=>original(${JSON.stringify(endpoint)},options);
    const {prepareConformance}=await import(${JSON.stringify(new URL('./conformance-prepare.mjs',import.meta.url).href)});
    try {await prepareConformance(['worker-storage-conformance.test.mjs']);process.exitCode=91;}
    catch(error){console.error(error.message);process.exitCode=1;}
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',program],
    {env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:root},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const closed=new Promise(resolve=>child.once('close',code=>resolve(code)));
  try{
    assert.equal(await Promise.race([closed,delay(5000,null,{ref:false})]),1,output);
    assert.match(output,/Fixture archive download failed/);
    const records=output.split('\n').filter(line=>line.startsWith('conformance_archive='))
      .map(line=>JSON.parse(line.slice('conformance_archive='.length)));
    assert.equal(records[0]?.event,'start','the real preparer must call the observed archive path');
    assert.equal(records[0].phase,'litestream-archive');
    assert.equal(records[0].url,'https://github.com/benbjohnson/litestream/releases/download/v0.5.17/litestream-0.5.17-linux-x86_64.tar.gz');
    assert.equal(records.at(-1).event,'failure');assert.equal(records.at(-1).status,503);
    assert.deepEqual(readdirSync(root),['bin'],'failed preparation collects its own scratch');
  }finally{
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    rmSync(root,{recursive:true,force:true});
  }
});


// A diagnostic must preserve the caller's original cancellation reason, even when it is not an Error.
for(const reason of [null,'interrupted'])test('archive diagnostics preserve a non-Error abort reason '+JSON.stringify(reason),{timeout:8000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'cost-archive-abort-')),path=join(root,'unverified.tar.gz');
  const program=`
    import assert from 'node:assert/strict';
    import {downloadConformanceArchive} from ${JSON.stringify(new URL('./conformance-archive.mjs',import.meta.url).href)};
    const reason=${JSON.stringify(reason)},controller=new AbortController();controller.abort(reason);
    await assert.rejects(()=>downloadConformanceArchive('http://127.0.0.1:1/unused','0'.repeat(64),${JSON.stringify(path)},
      {signal:controller.signal,phase:'storage-archive'}),error=>Object.is(error,reason));
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const closed=new Promise(resolve=>child.once('close',code=>resolve(code)));
  try{
    assert.equal(await Promise.race([closed,delay(5000,null,{ref:false})]),0,output);
    const records=output.split('\n').filter(line=>line.startsWith('conformance_archive='))
      .map(line=>JSON.parse(line.slice('conformance_archive='.length)));
    assert.equal(records.at(-1).event,'failure');assert.equal(records.at(-1).errorName,'UnknownError');
    assert.equal(records.at(-1).phase,'storage-archive');assert.equal(existsSync(path),false);
  }finally{
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
    rmSync(root,{recursive:true,force:true});
  }
});
