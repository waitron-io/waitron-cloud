import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Removing retries, admitting damaged bytes, or restarting the deadline breaks these HTTP journeys.
for(const scenario of ['504-then-success','500-then-success','504-twice-success','retry-digest-mismatch','connection-reset','partial-reset',
  'always-504','open-503-body','404','429','digest-mismatch','cancel-backoff','shared-deadline']) {
  test('archive retry: '+scenario,{timeout:9000},async()=>{
    const root=mkdtempSync(join(tmpdir(),'cost-archive-retry-')),path=join(root,'fixture.tar.gz');
    const bytes=Buffer.from('verified public fixture bytes'),digest=createHash('sha256').update(bytes).digest('hex');
    let requests=0;
    const server=createServer((request,response)=>{
      const attempt=++requests;
      if(scenario==='shared-deadline'){
        if(attempt===1)setTimeout(()=>{response.writeHead(504);response.end();},300);
        return;
      }
      if(scenario==='connection-reset'&&attempt===1){request.socket.destroy();return;}
      if(scenario==='partial-reset'&&attempt===1){
        response.writeHead(200);response.write('discard these partial bytes');
        setTimeout(()=>response.destroy(),40);return;
      }
      const status=scenario==='404'?404:scenario==='429'?429:scenario==='open-503-body'?503:
        scenario==='always-504'||scenario==='cancel-backoff'||(scenario==='504-then-success'&&attempt===1)||(scenario==='504-twice-success'&&attempt<=2)||(scenario==='retry-digest-mismatch'&&attempt===1)?504:
        scenario==='500-then-success'&&attempt===1?500:200;
      response.writeHead(status);
      if(scenario==='open-503-body'){response.write('discard this refusal body');return;}
      response.end(status===200?((scenario==='digest-mismatch'&&attempt===1)||(scenario==='retry-digest-mismatch'&&attempt===2)?Buffer.from('damaged'):bytes):'unavailable');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/fixture.tar.gz`;
    const program=`
      import assert from 'node:assert/strict';
      import {downloadConformanceArchive} from ${JSON.stringify(new URL('./conformance-archive.mjs',import.meta.url).href)};
      const controller=new AbortController();
      ${scenario==='cancel-backoff'?"setTimeout(()=>controller.abort('owner interrupted'),250);":''}
      ${scenario==='shared-deadline'?`
        const originalTimeout=AbortSignal.timeout;
        AbortSignal.timeout=ms=>{assert.equal(ms,120000);return originalTimeout(1600);};
      `:''}
      try{
        await downloadConformanceArchive(${JSON.stringify(url)},${JSON.stringify(digest)},${JSON.stringify(path)},
          {signal:controller.signal,phase:'storage-archive'});
        console.log('download-succeeded');
      }catch(error){console.error('download-error='+String(error?.name)+':'+String(error?.message??error));process.exitCode=1;}
    `;
    const started=performance.now(),child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    try{
      const result=await Promise.race([closed,delay(7000,null,{ref:false})]);
      assert.notEqual(result,null,'download must settle: '+output);assert.equal(result.signal,null);
      const success=['504-then-success','500-then-success','504-twice-success','connection-reset','partial-reset'].includes(scenario);
      assert.equal(result.code,success?0:1,output);
      assert.equal(requests,scenario==='504-twice-success'?3:success||['shared-deadline','retry-digest-mismatch'].includes(scenario)?2:
        ['always-504','open-503-body'].includes(scenario)?3:1,output);
      if(success)assert.deepEqual(readFileSync(path),bytes,'only the successful verified attempt reaches extraction');
      else assert.equal(existsSync(path),false,'failed bytes never reach extraction');
      const records=output.split('\n').filter(line=>line.startsWith('conformance_archive='))
        .map(line=>JSON.parse(line.slice('conformance_archive='.length)));
      const attempts=records.filter(record=>record.event==='attempt');
      assert.deepEqual(attempts.map(record=>record.attempt),Array.from({length:requests},(_,i)=>i+1));
      for(const record of attempts){assert.equal(record.bytesReceived,0);assert.equal('status' in record,false);}
      for(const record of records){assert.equal(record.timeoutMs,120000);assert.equal(record.phase,'storage-archive');assert.equal(record.url,url);}
      assert.equal(records.at(-1).event,success?'complete':'failure');
      assert.equal(records.filter(record=>record.event==='retry').length,requests-1+(scenario==='cancel-backoff'?1:0));
      if(['digest-mismatch','retry-digest-mismatch'].includes(scenario))assert.match(output,/Fixture archive digest mismatch/);
      if(scenario==='cancel-backoff'){assert.match(output,/owner interrupted/);assert.ok(performance.now()-started<1500);}
      if(scenario==='shared-deadline'){
        assert.match(output,/TimeoutError/);assert.ok(performance.now()-started<2300,'attempts share one deadline: '+output);
      }
    }finally{
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      rmSync(root,{recursive:true,force:true});
    }
  });
}
