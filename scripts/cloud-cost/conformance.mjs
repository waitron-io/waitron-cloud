import {readdirSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFileSync} from 'node:child_process';

const here=fileURLToPath(new URL('.',import.meta.url));
export const conformanceFiles=() => readdirSync(join(here,'fixtures')).filter(name=>name.endsWith('-conformance.test.mjs')).sort();

export function conformanceMatrix() {
  const first='^(?:complete|tampered|refused|stack|genuine(?:StorageTraffic|ArchiveAnd|VersionAnd|LitestreamRequestLogs))';
  const second='^genuine(?:LitestreamTransport|LitestreamStorage|StorageReplacement|NativeStreamHistories|SdkBulk|NativeVersionHistories|PinnedLitestream|NativeBatchListener)';
  const patterns=[first,second,'^(?!(?:'+first+'|'+second+'))'];
  // The last group includes new case names so additions cannot disappear from CI.
  return conformanceFiles().flatMap(file=>file==='stack-conformance.test.mjs'
    ?patterns.map((pattern,index)=>({file,pattern,group:`${index+1}/3`,...(index===2?{skipPattern:first+'|'+second}:{})}))
    :[{file,pattern:'.',group:'1/1'}]);
}

export function runTests(files,{pattern,skipPattern,...options}={}) {
  return runCommand(process.execPath,['--test','--test-concurrency=1',...(pattern?['--test-name-pattern='+pattern]:[]),...(skipPattern?['--test-skip-pattern='+skipPattern]:[]),...files],options);
}

function runCommand(command,args,{env=process.env,stdio='inherit'}={}) {
  const childEnv={...env}; delete childEnv.NODE_TEST_CONTEXT;
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env:childEnv,stdio});
    let output='';
    child.stdout?.on('data',bytes=>{output+=bytes;});
    child.stderr?.on('data',bytes=>{output+=bytes;});
    const stop=signal=>child.kill(signal);
    const interrupt=()=>stop('SIGINT'), terminate=()=>stop('SIGTERM');
    process.once('SIGINT',interrupt); process.once('SIGTERM',terminate);
    const clear=()=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);};
    child.once('error',error=>{clear();reject(error);});
    child.once('close',code=>{clear();resolve({code:code??1,output});});
  });
}

async function main(args) {
  const files=conformanceFiles();
  if(args.length===1 && args[0]==='--list') {console.log(JSON.stringify(files));return;}
  if(args.length===1 && args[0]==='--matrix') {console.log(JSON.stringify(conformanceMatrix()));return;}
  if(args.length && !([2,4,6].includes(args.length) && args[0]==='--only' && files.includes(args[1])
    && (args.length===2 || (args[2]==='--pattern' && args[3].length>0))
    && (args.length<6 || args[4]==='--skip-pattern'))) throw Error('Use --list, --matrix or --only <listed file> [--pattern <expression> [--skip-pattern <expression>]]');
  const pattern=args.length>=4?args[3]:undefined;
  const skipPattern=args.length===6?args[5]:undefined;
  const selected=args.length?[args[1]]:files;
  const {prepareConformance}=await import('./conformance-prepare.mjs');
  const fixture=await prepareConformance(selected);
  try {
    const host=selected.filter(name=>name!=='worker-storage-conformance.test.mjs');
    if(host.length) process.exitCode=(await runTests(host.map(name=>join(here,'fixtures',name)),{env:{...process.env,...fixture.env},pattern,skipPattern})).code;
    if(!process.exitCode && selected.includes('worker-storage-conformance.test.mjs')) {
      let id;
      try {
        id=execFileSync('docker',['create','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true',
          '--tmpfs=/tmp:rw,nosuid,size=512m','--mount',`type=bind,src=${realpathSync(here)},dst=/app/scripts/cloud-cost,readonly`,
          fixture.image,'node','--test','/app/scripts/cloud-cost/fixtures/worker-storage-conformance.test.mjs'],{encoding:'utf8'}).trim();
        process.exitCode=(await runCommand('docker',['start','--attach',id])).code;
      } finally {if(id)execFileSync('docker',['rm','-f',id],{stdio:'inherit'});}
    }
  } finally {fixture.cleanup();}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===realpathSync(process.argv[1])) main(process.argv.slice(2)).catch(error=>{console.error(error);process.exitCode=1;});
