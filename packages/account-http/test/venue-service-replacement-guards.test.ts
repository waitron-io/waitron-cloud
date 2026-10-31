import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Composition, error translation and wire filtering must each fail real HTTP assertions when independently omitted.
test('replacement HTTP venue guards detect independent omissions',{timeout:240000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-replacement-http-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const cases=[
   {name:'machine route venue mode',path:'app.ts',needle:'return replacementResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:options.planMode}:undefined,consume});',
    replacement:"return replacementResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:'existing'}:undefined,consume});",
    pattern:'venue (snapshot|continuous) replacement HTTP refuses machine proposals at level one',count:2,expected:'200 !== 403'},
   {name:'owner route venue mode',path:'app.ts',needle:'return recoveryResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:options.planMode}:undefined,consume,recoveryCodeKeys});',
    replacement:"return recoveryResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:'existing'}:undefined,consume,recoveryCodeKeys});",
    pattern:'venue (snapshot|continuous) replacement HTTP refuses activation but retains owner inspection and close',count:2,expected:'200 !== 403'},
   {name:'completed machine replay venue mode',path:'app.ts',needle:'return replacementResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:options.planMode}:undefined,consume});',
    replacement:"return replacementResponse(c,{pool,origin:config.portalOrigin,ip,captures:options.captures?{...options.captures,planMode:'existing'}:undefined,consume});",
    pattern:'venue (snapshot|continuous) replacement HTTP completed replay refuses a downgrade',count:2,expected:'200 !== 403'},
   {name:'machine source field filtering',path:'replacement.ts',needle:"const {source: _ownerSource, ...machineView}=await store.machine(action as 'prepare'|'status',envelope);",
    replacement:"const machineView=await store.machine(action as 'prepare'|'status',envelope);",
    pattern:'venue (snapshot|continuous) replacement HTTP at (connected|hosted) keeps the machine wire and activates once',count:4,expected:"'source'"},
   {name:'machine proof error status',path:'replacement.ts',needle:"'backup.invalid_proof':401,",replacement:'',
    pattern:'venue (snapshot|continuous) replacement HTTP authenticates both proofs before reporting level refusal',count:2,expected:'503 !== 401'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','packages/account-http/test/venue-service-replacement.test.ts'],{cwd:candidate,env,timeout:45000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,'packages/account-http/src',c.path),original=await readFile(path,'utf8');
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,new RegExp('# pass '+c.count+'\\b'));assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c.pattern);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,new RegExp('# fail '+c.count+'\\b'));
    assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,new RegExp('# pass '+c.count+'\\b'));assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_REPLACEMENT_HTTP_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
