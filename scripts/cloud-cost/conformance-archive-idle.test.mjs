import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

// Without an inactivity bound, a stalled first response consumes the entire retry budget.
for(const scenario of ['headers-stall','body-stall','always-stalled','progress','cancel','shared-deadline']) {
  test('archive inactivity: '+scenario,{timeout:5000},async t=>{
    const root=mkdtempSync(join(tmpdir(),'cost-archive-idle-')),path=join(root,'archive');
    const bytes=Buffer.from('complete verified archive'),digest=createHash('sha256').update(bytes).digest('hex');
    let requests=0;const timers=new Set();
    const later=(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);};
    const server=createServer((request,response)=>{
      const attempt=++requests;
      if(['always-stalled','cancel','shared-deadline'].includes(scenario)||scenario==='headers-stall'&&attempt===1)return;
      response.writeHead(200);
      if(scenario==='body-stall'&&attempt===1){response.write('discard partial archive');return;}
      if(scenario==='progress'){
        let offset=0;
        const send=()=>{response.write(bytes.subarray(offset,offset+4));offset+=4;
          if(offset>=bytes.length)response.end();else later(send,50);};
        send();return;
      }
      response.end(bytes);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(async()=>{
      for(const timer of timers)clearTimeout(timer);
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      rmSync(root,{recursive:true,force:true});
    });
    const program=`
      import timerPromises from 'node:timers/promises';
      import {syncBuiltinESMExports} from 'node:module';
      const sleep=timerPromises.setTimeout;
      timerPromises.setTimeout=(ms,value,options)=>sleep([1000,2000].includes(ms)?20:ms,value,options);
      syncBuiltinESMExports();
      const timeout=globalThis.setTimeout;
      globalThis.setTimeout=(fn,ms,...args)=>timeout(fn,ms===30000?150:ms,...args);
      const budget=AbortSignal.timeout;
      AbortSignal.timeout=ms=>budget(ms===120000?${scenario==='shared-deadline'?240:1200}:ms);
      const {downloadConformanceArchive}=await import(${JSON.stringify(new URL('./conformance-archive.mjs',import.meta.url).href)});
      const controller=new AbortController();
      ${scenario==='cancel'?"timeout(()=>controller.abort(new Error('owner interrupted')),80);":''}
      try {
        await downloadConformanceArchive(${JSON.stringify(`http://127.0.0.1:${server.address().port}/archive`)},
          ${JSON.stringify(digest)},${JSON.stringify(path)},{signal:controller.signal,phase:'litestream-archive'});
      } catch(error) {console.error('download-error='+error.name+':'+error.message);process.exitCode=1;}
    `;
    const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;});
    const result=await closed;
    const success=['headers-stall','body-stall','progress'].includes(scenario);
    assert.equal(result.signal,null,output);
    assert.equal(result.code,success?0:1,output);
    assert.equal(requests,scenario==='always-stalled'?3:scenario==='cancel'||scenario==='progress'?1:2,output);
    if(success)assert.deepEqual(readFileSync(path),bytes,'partial failed responses cannot enter the archive');
    else assert.equal(existsSync(path),false);
    const records=output.split('\n').filter(line=>line.startsWith('conformance_archive='))
      .map(line=>JSON.parse(line.slice('conformance_archive='.length)));
    assert.equal(records.at(-1).event,success?'complete':'failure');
    if(scenario==='cancel')assert.match(output,/owner interrupted/);
    if(scenario==='shared-deadline')assert.match(output,/TimeoutError/);
    if(scenario==='body-stall')assert.equal(records.find(row=>row.event==='retry').bytesReceived,23);
  });
}
