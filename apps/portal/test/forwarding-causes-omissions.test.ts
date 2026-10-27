import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {before,after,test} from 'node:test';

const root=fileURLToPath(new URL('../../../',import.meta.url));let temporary:string,candidate:string;
before(async()=>{
 temporary=await mkdtemp(join(tmpdir(),'forward-display-omissions-'));candidate=join(temporary,'candidate');
 execFileSync('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:30000,stdio:'pipe'});
 // Include the complete candidate, including uncommitted test additions in a driver run.
 const patch=execFileSync('git',['diff','--binary','HEAD'],{cwd:root,maxBuffer:8*1024*1024});
 if(patch.length)execFileSync('git',['apply','--binary','-'],{cwd:candidate,input:patch});
 execFileSync('pnpm',['install','--frozen-lockfile','--offline'],{cwd:candidate,timeout:120000,stdio:'pipe'});
},{timeout:150000});
after(async()=>{if(temporary)await rm(temporary,{recursive:true,force:true});});
interface Fault {name:string;source:string;file:string;pattern:string;changes:[string,string][];postgres?:boolean}
const controller='apps/portal/src/remote-controller.ts',types='apps/portal/src/remote-types.ts',app='apps/portal/src/app.ts';
const controls='apps/portal/test/remote-controller.test.ts',browser='apps/portal/test/forwarding-causes-browser.test.ts';
const faults:Fault[]=[
 {name:'canonical timestamp validation',source:types,file:controls,pattern:'^a recent timestamp',changes:[['&&new Date(v).toISOString()===v','']]},
 {name:'clear before apply',source:controller,file:controls,pattern:'^apply clears private',changes:[['this.#clearForward();const generation=this.#generation;this.pending=true;','const generation=this.#generation;this.pending=true;']]},
 {name:'client view validation',source:types,file:controls,pattern:'^forward view rejects',changes:[['!validForward(v.publicForward)||','']]},
 {name:'client expiry',source:controller,file:controls,pattern:'^older server has null',changes:[['this.view={...this.view,publicForward:null};}\n #clearForward','this.view={...this.view};}\n #clearForward']]},
 {name:'refresh clearing',source:controller,file:controls,pattern:'^refresh erases',changes:[['this.#clearForward();const generation=this.#generation,id=this.installationId','const generation=this.#generation,id=this.installationId']]},
 {name:'response binding',source:controller,file:controls,pattern:'^refresh erases',changes:[['&&result.value.installationId===id','']]},
 {name:'late navigation fence',source:controller,file:controls,pattern:'^a venue switch',changes:[['if(generation!==this.#generation)return;','']]},
 {name:'draw timer expiry',source:app,file:browser,pattern:'^en light 390:',changes:[['    this.remote.expireForward();\n','']]},
 {name:'pagehide clearing before draw',source:app,file:browser,pattern:'^en light 390:',changes:[["window.addEventListener('pagehide', () => { this.remote.account(undefined);", "window.addEventListener('pagehide', () => {"]]},
];
for(const fault of faults)test(`${fault.postgres?'postgres':'native'}: deleting ${fault.name} makes its owning assertion fail`,{timeout:150000},async()=>{
 const path=join(candidate,fault.source),original=await readFile(path,'utf8');let altered=original;
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.FORCE_COLOR;delete env.FORWARDING_RECEIPT_DIR;
 const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap','--test-timeout=120000','--test-name-pattern='+fault.pattern,fault.file],{cwd:candidate,env,encoding:'utf8',timeout:130000,maxBuffer:4*1024*1024});
 const control=run();assert.equal(control.status,0,control.stdout+control.stderr);assert.match(control.stdout,/# pass [1-9]\d*/);
 try{
  for(const [needle,replacement] of fault.changes){assert(altered.includes(needle),`missing guard: ${fault.name}`);altered=altered.replaceAll(needle,replacement);}
  await writeFile(path,altered);const broken=run();assert.equal(broken.status,1,broken.stdout+broken.stderr);assert.match(broken.stdout+broken.stderr,/AssertionError/);
 }finally{await writeFile(path,original);}
 const restored=run();assert.equal(restored.status,0,restored.stdout+restored.stderr);
});
