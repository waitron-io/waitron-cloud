import {spawn} from 'node:child_process';
export async function runNodeVerifier(args:string[],options:{input:unknown;timeoutMs?:number;signal?:AbortSignal;cwd?:string;environment?:Record<string,string>}):Promise<unknown>{
 const timeout=options.timeoutMs??30000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>30000)throw Error('backup.verifier_configuration');
 let input:string;try{input=JSON.stringify(options.input);if(!input||Buffer.byteLength(input)>65536)throw Error();}catch{throw Error('backup.verifier_input');}
 if(options.signal?.aborted)throw Error('backup.verifier_cancelled');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=512',...args],{cwd:options.cwd,env:{PATH:process.env.PATH??'',TSX_DISABLE_CACHE:'1',...options.environment},detached:true,stdio:['pipe','pipe','pipe']});
  let output='',size=0,failure:string|undefined,closed=false;
  const kill=()=>{if(closed)return;try{if(child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* The process may already have exited. */}};
  const fail=(code:string)=>{failure??=code;kill();};
  const abort=()=>fail('backup.verifier_cancelled');options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>fail('backup.verifier_timeout'),timeout);
  const collect=(bytes:Buffer,stdout:boolean)=>{size+=bytes.length;if(size>65536){fail('backup.verifier_output');return;}if(stdout)output+=bytes.toString('utf8');};
  child.stdout.on('data',bytes=>collect(bytes,true));child.stderr.on('data',bytes=>collect(bytes,false));
  child.on('error',()=>fail('backup.verifier_failed'));child.stdin.on('error',()=>fail('backup.verifier_failed'));
  // Wait for process close after killing it; callers may then remove the private restore directory.
  child.on('close',code=>{
   kill();closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   if(failure||code!==0){reject(Error(failure??'backup.verifier_failed'));return;}
   try{resolve(JSON.parse(output));}catch{reject(Error('backup.verifier_output'));}
  });
  child.stdin.end(input);if(options.signal?.aborted)abort();
 });
}
