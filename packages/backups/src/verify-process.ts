import {spawn} from 'node:child_process';
interface VerifierLimits {cpuSeconds?:number;maxFileBytes?:number;maxOpenFiles?:number;heapMiB?:number;}
export async function runNodeVerifier(args:string[],options:{input:unknown;timeoutMs?:number;signal?:AbortSignal;cwd?:string;readablePaths?:string[];writablePaths?:string[];allowWorker?:boolean;limits?:VerifierLimits}):Promise<unknown>{
 const timeout=options.timeoutMs??30000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>30000)throw Error('backup.verifier_configuration');
 if(!process.allowedNodeEnvironmentFlags.has('--allow-net'))throw Error('backup.verifier_configuration');
 if(args.some(arg=>/^--(?:(?:experimental-)?permission|allow-)/.test(arg)))throw Error('backup.verifier_configuration');
 const cpuSeconds=options.limits?.cpuSeconds??25,maxFileBytes=options.limits?.maxFileBytes??512*1024*1024,maxOpenFiles=options.limits?.maxOpenFiles??128,heapMiB=options.limits?.heapMiB??512;
 if(!Number.isInteger(cpuSeconds)||cpuSeconds<1||cpuSeconds>30||!Number.isInteger(maxFileBytes)||maxFileBytes<512||maxFileBytes>512*1024*1024||!Number.isInteger(maxOpenFiles)||maxOpenFiles<32||maxOpenFiles>128||!Number.isInteger(heapMiB)||heapMiB<16||heapMiB>512)throw Error('backup.verifier_configuration');
 let input:string;try{input=JSON.stringify(options.input);if(!input||Buffer.byteLength(input)>65536)throw Error();}catch{throw Error('backup.verifier_input');}
 if(options.signal?.aborted)throw Error('backup.verifier_cancelled');
 return new Promise((resolve,reject)=>{
  const permissions=['--permission',...(options.readablePaths??[]).map(path=>'--allow-fs-read='+path),...(options.writablePaths??[]).map(path=>'--allow-fs-write='+path),...(options.allowWorker?['--allow-worker']:[])];
  const nodeArgs=['--max-old-space-size='+heapMiB,...permissions,...args];
  const limits='ulimit -c 0; ulimit -t "$1"; ulimit -f "$2"; ulimit -n "$3"; shift 3; exec "$@"';
  // macOS sh measures `ulimit -f` in KiB; Linux sh uses 512-byte blocks.
  const fileLimitUnit=process.platform==='darwin'?1024:512;
  const child=spawn('/bin/sh',['-c',limits,'verifier-limits',String(cpuSeconds),String(Math.ceil(maxFileBytes/fileLimitUnit)),String(maxOpenFiles),process.execPath,...nodeArgs],{cwd:options.cwd,env:{TSX_DISABLE_CACHE:'1'},detached:true,stdio:['pipe','pipe','pipe']});
  let output='',errors='',size=0,failure:string|undefined,closed=false;
  const kill=()=>{if(closed)return;try{if(child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* The process may already have exited. */}};
  const fail=(code:string)=>{failure??=code;kill();};
  const abort=()=>fail('backup.verifier_cancelled');options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>fail('backup.verifier_timeout'),timeout);
  const collect=(bytes:Buffer,stdout:boolean)=>{size+=bytes.length;if(size>65536){fail('backup.verifier_output');return;}if(stdout)output+=bytes.toString('utf8');else errors+=bytes.toString('utf8');};
  child.stdout.on('data',bytes=>collect(bytes,true));child.stderr.on('data',bytes=>collect(bytes,false));
  child.on('error',()=>fail('backup.verifier_failed'));child.stdin.on('error',()=>fail('backup.verifier_failed'));
  // Wait for process close after killing it; callers may then remove the private restore directory.
  child.on('close',(code,signal)=>{
   kill();closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   const resourceSignal=signal==='SIGXCPU'||signal==='SIGXFSZ'||signal==='SIGKILL'||signal==='SIGABRT';
   // Node reports macOS file-limit failures as EFBIG and V8 heap exhaustion in stderr before exiting.
   const resourceError=/\bEFBIG\b|heap out of memory|reached heap limit|ineffective mark-compacts near heap limit/i.test(errors);
   if(failure||code!==0){reject(Error(failure??(resourceSignal||resourceError?'backup.verifier_resource':'backup.verifier_failed')));return;}
   try{resolve(JSON.parse(output));}catch{reject(Error('backup.verifier_output'));}
  });
  child.stdin.end(input);if(options.signal?.aborted)abort();
 });
}
