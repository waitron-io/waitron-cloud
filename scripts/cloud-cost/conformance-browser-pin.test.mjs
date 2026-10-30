import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Dropping either cleanup or sharing one manifest must fail these controls.
for(const refusal of [null,'browser','replay'])test('combined browser and replay preparation: '+(refusal??'complete'),{timeout:10000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'cost-browser-pin-')),bin=join(root,'bin'),state=join(root,'state.json');
  await mkdir(bin);await writeFile(state,JSON.stringify({sources:{},roots:[],fetches:[]}));
  const prelude="import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {join,dirname} from 'node:path';\n"
    +'const state='+JSON.stringify(state)+',data=JSON.parse(readFileSync(state)),args=process.argv.slice(2);\n';
  const script=async(name,body)=>writeFile(join(bin,name),'#!'+process.execPath+'\n'+prelude+body,{mode:0o700});
  await script('git',[
    "if(args[0]==='init'){const source=args.at(-1);mkdirSync(source,{recursive:true});data.roots.push(dirname(source));}",
    "else if(args.includes('fetch')){const source=args[args.indexOf('-C')+1];data.sources[source]=args.at(-1);data.fetches.push(args.at(-1));}",
    "else if(args.includes('checkout')){const source=args[args.indexOf('-C')+1],migrations=join(source,'packages/migrations');",
    "mkdirSync(join(source,'apps/server/src/assets'),{recursive:true});writeFileSync(join(source,'apps/server/src/assets/invoice-noto-sans.ttf'),'generated-font');",
    "const tokens=join(source,'packages/ui-core');mkdirSync(join(tokens,'src/tokens'),{recursive:true});writeFileSync(join(tokens,'package.json'),JSON.stringify({name:'@waitron/ui-core'}));",
    "writeFileSync(join(tokens,'src/tokens/colors.css'),'generated-colors');writeFileSync(join(tokens,'src/tokens/structure.css'),'generated-structure');",
    "mkdirSync(join(migrations,'generated'),{recursive:true});writeFileSync(join(migrations,'generated/001.sql'),'select 1;');",
    "writeFileSync(join(migrations,'migrations.manifest.json'),JSON.stringify([{name:'generated',from:'generated'}]));",
    "const module=join(source,'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib');mkdirSync(module,{recursive:true});",
    "writeFileSync(join(module,'package.json'),JSON.stringify({type:'module'}));",
    'writeFileSync(join(module,"main.js"),'+JSON.stringify("import {writeFileSync} from 'node:fs';export async function build({outfile}) {writeFileSync(outfile,'export const generated=true;');}")+');}',
    "else if(args.includes('rev-parse'))console.log(args.includes('-C')?data.sources[args[args.indexOf('-C')+1]]:'a'.repeat(40));else process.exit(90);",
    'writeFileSync(state,JSON.stringify(data));'
  ].join('\n'));
  await script('pnpm',[
    "if(args[0]==='install'){const browser=data.sources[process.cwd()]==='e8cfd38ed07bf546f14ad15334e54ee997114c75';",
    'if('+JSON.stringify(refusal)+"===(browser?'browser':'replay')){console.error('GENERATED_INSTALL_REFUSAL');process.exit(44);}}",
    "else if(args.at(-1)==='build')mkdirSync(join(process.cwd(),'apps/dashboard/dist'),{recursive:true});else process.exit(91);"
  ].join('\n'));
  await script('docker',"if(args[0]!=='image'||args[1]!=='inspect')process.exit(92);console.log('sha256:'+'a'.repeat(64));");
  const program=[
    "import {readFileSync} from 'node:fs';import {join} from 'node:path';",
    'import {prepareConformance} from '+JSON.stringify(new URL('./conformance-prepare.mjs',import.meta.url).href)+';',
    "const fixture=await prepareConformance(['cadence-conformance.test.mjs','remote-browser-conformance.test.mjs']);",
    'try {const read=path=>JSON.parse(readFileSync(path));',
    'const synthetic=read(fixture.env.COST_SYNTHETIC_CONFIG),owner=read(fixture.env.COST_OWNER_FIXTURE),browser=read(fixture.env.COST_BROWSER_FIXTURE);',
    "console.log('PREPARED='+JSON.stringify({replay:read(join(synthetic.codeRoot,'runtime-manifest.json')).revision,owner:owner.revision,browser:browser.revision,font:readFileSync(join(browser.runtime,'../assets/invoice-noto-sans.ttf'),'utf8'),runtimeAssets:browser.runtimeAssets===join(browser.runtime,'../assets'),colors:readFileSync(join(browser.runtimePackages,'@waitron/ui-core/src/tokens/colors.css'),'utf8'),structure:readFileSync(join(browser.runtimePackages,'@waitron/ui-core/src/tokens/structure.css'),'utf8')}));",
    '} finally {fixture.cleanup();}'
  ].join('\n');
  const child=spawn(process.execPath,['--input-type=module','-e',program],{env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
    for(const owned of JSON.parse(await readFile(state,'utf8')).roots)await rm(owned,{recursive:true,force:true});
    await rm(root,{recursive:true,force:true});
  });
  let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  const result=await Promise.race([closed,delay(8000,null,{ref:false})]);
  assert.notEqual(result,null,'preparation must finish and release its timers');
  assert.deepEqual(result,{code:refusal?1:0,signal:null},output);
  const data=JSON.parse(await readFile(state,'utf8'));
  assert.deepEqual(data.fetches,refusal==='replay'?['fbadd15785464e59747e697c11048bfbc6e4938f']:
    ['fbadd15785464e59747e697c11048bfbc6e4938f','e8cfd38ed07bf546f14ad15334e54ee997114c75']);
  assert.ok(data.roots.every(owned=>!existsSync(owned)),'collect every owned preparation on success or refusal');
  if(refusal)assert.match(output,/GENERATED_INSTALL_REFUSAL/);
  else {
    const prepared=JSON.parse(output.split('\n').find(line=>line.startsWith('PREPARED=')).slice(9));
    assert.deepEqual(prepared,{replay:'fbadd15785464e59747e697c11048bfbc6e4938f',owner:'fbadd15785464e59747e697c11048bfbc6e4938f',browser:'e8cfd38ed07bf546f14ad15334e54ee997114c75',font:'generated-font',runtimeAssets:true,colors:'generated-colors',structure:'generated-structure'});
  }
});
