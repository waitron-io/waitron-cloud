import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// The real pnpm body reader can outlive its request timeout. Dropping the outer
// deadline or its process-group cleanup must fail these controlled downloads.
for(const mode of ['headers-stall','body-stall','trickle','healthy','damaged']){
  test('real pnpm source installation handles '+mode+' within the setup boundary',{timeout:15000},async()=>{
    const root=realpathSync(mkdtempSync(join(tmpdir(),'cost-install-transport-'))),bin=join(root,'bin');
    mkdirSync(bin);mkdirSync(join(root,'package'));
    writeFileSync(join(root,'package/package.json'),JSON.stringify({name:'setup-transfer-probe',version:'1.0.0'}));
    // Exceed pnpm's five MiB progress threshold with incompressible, generated data.
    writeFileSync(join(root,'package/payload'),randomBytes(6*1024*1024));
    execFileSync('tar',['-czf',join(root,'package.tgz'),'-C',root,'package']);
    const body=readFileSync(join(root,'package.tgz'));
    const integrity='sha512-'+createHash('sha512').update(body).digest('base64');
    let child,closed,interval,output='',requests=0,sent=0,requestAt,installer,source;
    const server=createServer((request,response)=>{
      requests++;requestAt??=performance.now();
      if(mode==='headers-stall')return;
      response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':body.length});
      if(mode==='healthy'||mode==='damaged'){
        const bytes=Buffer.from(body);if(mode==='damaged')bytes[100]^=1;
        sent=bytes.length;response.end(bytes);return;
      }
      sent=65536;response.write(body.subarray(0,sent));
      if(mode==='trickle')interval=setInterval(()=>{const end=sent+16384;response.write(body.subarray(sent,end));sent=end;},100);
    });
    try{
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const url='http://127.0.0.1:'+server.address().port+'/package.tgz';
      const manifest={name:'setup-transfer-project',private:true,dependencies:{'setup-transfer-probe':'1.0.0'}};
      const lock=`lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      setup-transfer-probe:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n  setup-transfer-probe@1.0.0:\n    resolution: {integrity: ${integrity}, tarball: ${url}}\nsnapshots:\n  setup-transfer-probe@1.0.0: {}\n`;
      // Substitute only source acquisition. Installation uses the actual pinned CLI.
      writeFileSync(join(bin,'git'),`#!${process.execPath}
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const a=process.argv.slice(2);
if(a[0]==='init'){
 const source=a.at(-1);mkdirSync(source,{recursive:true});
 writeFileSync(join(source,'package.json'),${JSON.stringify(JSON.stringify(manifest))});
 writeFileSync(join(source,'pnpm-lock.yaml'),${JSON.stringify(lock)});
 writeFileSync(join(source,'.npmrc'),'fetch-timeout=250\\nfetch-retries=0\\nignore-scripts=true\\nstore-dir='+join(source,'store')+'\\ncache-dir='+join(source,'cache')+'\\n');
}
if(a.includes('rev-parse'))console.log('fbadd15785464e59747e697c11048bfbc6e4938f');
`,{mode:0o700});
      // Accelerate only the supervisor's unchanged five-minute limit in this child.
      const clock='const timeout=setTimeout,interval=setInterval;globalThis.setTimeout=(fn,ms,...args)=>timeout(fn,ms===300000?4000:ms,...args);globalThis.setInterval=(fn,ms,...args)=>interval(fn,ms===10000?50:ms,...args);';
      child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(clock),new URL('./conformance.mjs',import.meta.url).pathname,'--only','cadence-conformance.test.mjs'],
        {env:{...process.env,PATH:bin+':'+process.env.PATH,NODE_AUTH_TOKEN:'generated-transport-secret'},stdio:['ignore','pipe','pipe']});
      const collect=bytes=>{
        output+=bytes;
        for(const line of output.split('\n').filter(line=>line.startsWith('conformance_setup='))){
          let record;try{record=JSON.parse(line.slice(18));}catch{continue;}
          if(record.phase==='source-install'&&record.event==='start')installer=record.pid;
          if(record.phase==='source-init'&&record.event==='start')source=record.args.at(-1);
        }
      };
      child.stdout.on('data',collect);child.stderr.on('data',collect);
      closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
      const result=await Promise.race([closed,delay(9000,null,{ref:false})]);
      assert.notEqual(result,null,'the outer deadline must settle even a stalled real pnpm body');
      assert.deepEqual(result,{code:1,signal:null});
      const records=output.split('\n').filter(line=>line.startsWith('conformance_setup=')).map(line=>JSON.parse(line.slice(18)));
      const install=records.filter(record=>record.phase==='source-install');
      const start=install.find(record=>record.event==='start');
      assert.ok(start,'reach source installation through the real supervisor');
      assert.equal(start.command,'pnpm');assert.deepEqual(start.args,['install','--frozen-lockfile','--reporter=ndjson']);
      assert.equal(start.timeoutMs,300000);assert.equal(requests,1,'make exactly one request to the controlled tarball endpoint');
      const summary=install.filter(record=>record.event==='install-progress').at(-1);
      assert.ok(summary);assert.equal(summary.truncated,false);assert.equal(summary.discardedLines,0);
      assert.equal(install.at(-2),summary,'emit the final snapshot before the installer close record');
      if(mode==='body-stall'||mode==='trickle'){
        assert.ok(install.some(record=>record.event==='timeout'&&record.timeoutMs===300000));
        assert.ok(install.some(record=>record.event==='closed'&&record.signal==='SIGKILL'));
        assert.ok(performance.now()-requestAt>1000,'the body outlives the fixture request timeout');
        assert.equal(summary.pendingDownloadCount,1);
        const download=summary.pendingDownloads[0];
        assert.deepEqual({...download,downloaded:undefined},{packageId:'setup-transfer-probe@1.0.0',attempt:1,size:body.length,downloaded:undefined});
        assert.ok(download.downloaded>=65536&&download.downloaded<=sent,'reported bytes cannot exceed what the server sent');
        if(mode==='body-stall')assert.equal(download.downloaded,65536);
        else assert.ok(download.downloaded>65536,'the observer sees progress despite the pending transfer');
        assert.equal(summary.available,0);assert.equal(summary.imported,0);
        assert.equal(summary.activeScriptCount,0);
        assert.ok(sent<body.length);if(mode==='trickle')assert.ok(sent>65536);
      }else if(mode==='healthy'){
        assert.ok(install.some(record=>record.event==='complete'&&record.code===0));
        assert.equal(summary.available,1);assert.equal(summary.imported,1);
        assert.equal(summary.pendingDownloadCount,0);assert.equal(summary.pendingImportCount,0);
      }else{
        assert.ok(install.some(record=>record.event==='failure'&&record.code!==0));
        assert.equal(install.some(record=>record.event==='timeout'||record.event==='complete'),false);
        if(mode==='damaged')assert.deepEqual(summary.errorCodes,['ERR_PNPM_TARBALL_INTEGRITY']);
        else assert.equal(sent,0);
      }
      assert.equal(output.includes('generated-transport-secret'),false);
      assert.throws(()=>process.kill(installer,0),{code:'ESRCH'});
      assert.equal(typeof source,'string');
      assert.equal(existsSync(join(source,'..')),false,'setup removes its scratch directory and isolated installer store');
    }finally{
      clearInterval(interval);
      if(installer){try{process.kill(-installer,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
      if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
      if(closed)await closed;
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      if(typeof source==='string'&&existsSync(source))rmSync(join(source,'..'),{recursive:true,force:true});
      rmSync(root,{recursive:true,force:true});
    }
  });
}
