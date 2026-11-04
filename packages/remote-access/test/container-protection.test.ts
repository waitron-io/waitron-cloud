import assert from 'node:assert/strict';
import {test} from 'node:test';

const implementation=await import('./fixtures/container-protection.ts').catch((error:NodeJS.ErrnoException)=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};
});
const protectContainer=('protectContainer' in implementation ? implementation.protectContainer : ()=>assert.fail('container protection helper must be implemented')) as (docker:(args:string[])=>string,image:string,tag:string)=>{verify:()=>void;close:()=>void};

function fixture(){
 const id='a'.repeat(64),other='b'.repeat(64),label='io.waitron.traffic-protected=fixture';
 const rows=new Map([[other,{label:'sibling',started:'original'}]]),calls:string[][]=[];
 let failStart=false;
 const docker=(args:string[])=>{
  calls.push(args);
  if(args[0]==='create'){rows.set(id,{label:args[args.indexOf('--label')+1]!,started:'created'});return id;}
  if(args[0]==='start'){if(failStart)throw Error('controlled start failure');rows.get(id)!.started='running';return id;}
  if(args[0]==='ps'){
   const filter=args[args.indexOf('--filter')+1];
   return [...rows].filter(([key,row])=>!args.includes('--filter') || filter==='label='+row.label || filter==='id='+key).map(([key])=>key).join('\n');
  }
  if(args[0]==='inspect'){const key=args.at(-1)!,row=rows.get(key);assert.ok(row,'missing protected container');return key+' '+row.started;}
  if(args[0]==='rm'){assert.equal(args.at(-1),id,'only the recorded protected container may be removed');rows.delete(id);return id;}
  assert.fail('unexpected Docker command '+args.join(' '));
 };
 return {id,other,label,rows,calls,docker,failStart:()=>{failStart=true;}};
}

test('labelled protection tolerates concurrent sibling creation and removal',()=>{
 const f=fixture(),protection=protectContainer(f.docker,'candidate','fixture');
 f.rows.delete(f.other);f.rows.set('c'.repeat(64),{label:'another-sibling',started:'new'});
 protection.verify();protection.close();
 assert.deepEqual([...f.rows.keys()],['c'.repeat(64)]);
 assert.ok(f.calls.filter(args=>args[0]==='ps').every(args=>args.includes('--filter')));
});
for(const fault of ['removed','restarted','extra'] as const)test('protection refuses '+fault+' labelled container',()=>{
 const f=fixture(),protection=protectContainer(f.docker,'candidate','fixture');
 if(fault==='removed')f.rows.delete(f.id);
 if(fault==='restarted')f.rows.get(f.id)!.started='restarted';
 if(fault==='extra')f.rows.set('c'.repeat(64),{label:f.label,started:'extra'});
 assert.throws(()=>protection.verify(),/foreign container identities and start times/);
 if(fault==='removed')f.rows.set(f.id,{label:f.label,started:'restored-for-cleanup'});
 protection.close();assert.ok(f.rows.has(f.other));assert.equal(f.rows.has(f.id),false);
});
test('failed witness startup cleans only its recorded container',()=>{
 const f=fixture();f.failStart();assert.throws(()=>protectContainer(f.docker,'candidate','fixture'),/controlled start failure/);
 assert.deepEqual([...f.rows.keys()],[f.other]);
});
