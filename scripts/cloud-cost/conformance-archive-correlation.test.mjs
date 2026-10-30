import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Omitting, carrying over or copying unchecked response identity breaks these downloads.
for(const scenario of ['exhausted','recovery','reset','redirect','malformed','unreadable','digest',
  'github-prefix','github-suffix','github-groups','github-width','azure-prefix','azure-suffix','duplicate',
  'unreadable-url-refusal','unreadable-header-refusal','maximum-id','azure-server','varnish-server']) {
  test('archive response correlation: '+scenario,{timeout:8000},async()=>{
    const root=mkdtempSync(join(tmpdir(),'archive-correlation-')),path=join(root,'fixture.tar.gz');
    const bytes=Buffer.from('public pinned archive'),digest=createHash('sha256').update(bytes).digest('hex');
    let requests=0;
    const server=createServer((request,response)=>{
      if(scenario==='redirect'&&request.url==='/fixture'){
        response.writeHead(302,{location:'/asset?signature=generated-private-query'});response.end();return;
      }
      const attempt=++requests;
      if(scenario==='reset'&&attempt>1){request.socket.resetAndDestroy();return;}
      const refused=['exhausted','reset','unreadable-url-refusal','unreadable-header-refusal'].includes(scenario)||(scenario==='recovery'&&attempt===1);
      const githubId='ABCD:1234:5678:9ABC:DEF'+attempt,azureId='12345678-1234-abcd-9876-123456789abc';
      const githubValues={
        'github-prefix':'generated-private-'+githubId,'github-suffix':githubId+'-generated-private',
        'github-groups':'A:B:C:D:E:F:1','github-width':'A'.repeat(17)+':1234:5678:9ABC',
        'duplicate':[githubId,githubId],'maximum-id':Array(6).fill('A'.repeat(16)).join(':'),
      };
      const azureValues={'azure-prefix':'generated-private-'+azureId,'azure-suffix':azureId+'-generated-private','duplicate':[azureId,azureId]};
      const headers={
        server:scenario==='malformed'?'generated-private-server':scenario==='azure-server'?'Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0':scenario==='varnish-server'?'Varnish':'GitHub.com',
        'x-github-request-id':scenario==='malformed'?'generated-private-request':githubValues[scenario]??githubId,
        'x-ms-request-id':scenario==='malformed'?'a'.repeat(500):azureValues[scenario]??azureId,
        'set-cookie':'generated-private-cookie',
        'x-unrelated-request-id':'generated-private-header',
      };
      response.writeHead(refused?500:200,headers);
      response.end(refused?'generated-private-body':bytes);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${server.address().port}/fixture`;
    const program=`
      import timerPromises from 'node:timers/promises';
      import {syncBuiltinESMExports} from 'node:module';
      const originalDelay=timerPromises.setTimeout;
      timerPromises.setTimeout=(ms,value,options)=>originalDelay([1000,2000].includes(ms)?10:ms,value,options);
      syncBuiltinESMExports();
      const originalFetch=globalThis.fetch;
      globalThis.fetch=async(...args)=>{
        const response=await originalFetch(...args);
        ${scenario==='redirect'?"Object.defineProperty(response,'url',{value:'https://release-assets.githubusercontent.com/private/asset?signature=generated-private-query'});":''}
        ${['unreadable','unreadable-header-refusal'].includes(scenario)?"Object.defineProperty(response,'headers',{get(){throw Error('generated-private-accessor');}});":''}
        ${scenario==='unreadable-url-refusal'?"Object.defineProperty(response,'url',{get(){throw Error('generated-private-url-accessor');}});":''}
        return response;
      };
      const {downloadConformanceArchive}=await import(${JSON.stringify(new URL('./conformance-archive.mjs',import.meta.url).href)});
      try {await downloadConformanceArchive(${JSON.stringify(url)},${JSON.stringify(scenario==='digest'?'0'.repeat(64):digest)},${JSON.stringify(path)},
        {signal:new AbortController().signal,phase:'litestream-archive'});}
      catch(error){console.error('download-error='+error.message);process.exitCode=1;}
    `;
    const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    try {
      const result=await Promise.race([closed,delay(6000,null,{ref:false})]);
      assert.notEqual(result,null,'the download must settle within its observed budget');
      const failed=['exhausted','reset','digest','unreadable-url-refusal','unreadable-header-refusal'].includes(scenario);
      assert.equal(result.signal,null);assert.equal(result.code,failed?1:0,output);
      assert.equal(requests,['exhausted','reset','unreadable-url-refusal','unreadable-header-refusal'].includes(scenario)?3:scenario==='recovery'?2:1);
      if(failed)assert.equal(existsSync(path),false,'no refused or unverified file reaches extraction');
      else assert.deepEqual(readFileSync(path),bytes);
      const records=output.split('\n').filter(line=>line.startsWith('conformance_archive='))
        .map(line=>JSON.parse(line.slice('conformance_archive='.length)));
      const headers=records.filter(record=>record.event==='headers');
      assert.equal(headers.length,scenario==='reset'?1:requests);
      if(!['malformed','unreadable','unreadable-header-refusal'].includes(scenario)){
        for(const record of records.filter(record=>record.status!==undefined)){
          assert.equal(record.responseServer,scenario==='azure-server'?'azure-blob':scenario==='varnish-server'?'varnish':'github');
          if(['github-prefix','github-suffix','github-groups','github-width','duplicate'].includes(scenario))assert.equal('githubRequestId' in record,false);
          else assert.equal(record.githubRequestId,scenario==='maximum-id'?'AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAA':'ABCD:1234:5678:9ABC:DEF'+record.attempt);
          if(['azure-prefix','azure-suffix','duplicate'].includes(scenario))assert.equal('azureRequestId' in record,false);
          else assert.equal(record.azureRequestId,'12345678-1234-abcd-9876-123456789abc');
          if(scenario==='redirect')assert.equal(record.responseService,'github-release-assets');
          else assert.equal('responseService' in record,false,'unrecognised hosts stay unlabelled');
        }
      }else{
        for(const record of records){
          for(const key of ['responseServer','githubRequestId','azureRequestId','responseService'])assert.equal(key in record,false);
        }
      }
      for(const record of records.filter(record=>record.event==='attempt'||(scenario==='reset'&&record.attempt>1))){
        for(const key of ['responseServer','githubRequestId','azureRequestId','responseService'])
          assert.equal(key in record,false,'each new attempt clears prior response identity');
      }
      assert.equal(output.includes('generated-private'),false,'response bodies, signed URLs and arbitrary headers stay private');
      if(['exhausted','unreadable-url-refusal','unreadable-header-refusal'].includes(scenario)){
        assert.match(output,/Fixture archive download failed/);assert.equal(records.at(-1).status,500);
      }
      if(scenario==='digest')assert.match(output,/Fixture archive digest mismatch/);
      assert.equal(records.at(-1).event,failed?'failure':'complete');
    }finally{
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      rmSync(root,{recursive:true,force:true});
    }
  });
}
