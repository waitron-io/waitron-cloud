import assert from 'node:assert/strict';
import {test} from 'node:test';

const implementation=await import('./fixtures/container-protection.ts').catch((error:NodeJS.ErrnoException)=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};
});
const protectContainer=('protectContainer' in implementation ? implementation.protectContainer : ()=>assert.fail('container protection helper must be implemented')) as (docker:(args:string[])=>string,image:string,tag:string)=>{verify:()=>void;close:()=>void};

function fixture(){
 const id='a'.repeat(64),other='b'.repeat(64),label='io.waitron.traffic-protected=fixture';
 type Row={label:string;started:string;status?:string};
 const rows=new Map<string,Row>([[other,{label:'io.waitron.traffic-owner=sibling',started:'original'}]]),calls:string[][]=[];
 let failStart=false,loseCreate=false;
 const docker=(args:string[])=>{
  calls.push(args);
  if(args[0]==='create'){rows.set(id,{label:args[args.indexOf('--label')+1]!,started:'created',status:'created'});if(loseCreate)throw Error('controlled lost create response');return id;}
  if(args[0]==='start'){if(failStart)throw Error('controlled start failure');rows.get(id)!.started='running';rows.get(id)!.status='running';return id;}
  if(args[0]==='ps'){
   const filters=args.flatMap((value,i)=>value==='--filter'?[args[i+1]!]:[]);
   const all=args.some(value=>/^-[a-z]*a[a-z]*$/.test(value));
   return [...rows].filter(([key,row])=>(all || (row.status??'running')==='running') && filters.every(filter=>
    filter.startsWith('label!=') ? row.label.split('=')[0]!==filter.slice(7) : filter==='label='+row.label || filter==='id='+key)).map(([key])=>key).join('\n');
  }
  if(args[0]==='inspect'){
   const key=args.at(-1)!,row=rows.get(key);assert.ok(row,'missing protected container');
   return args[args.indexOf('--format')+1]!.replace('{{.Id}}',key).replace('{{.State.StartedAt}}',row.started).replace('{{.State.Status}}',row.status??'running');
  }
  if(args[0]==='rm'){assert.ok(args.includes('--force'),'running witness removal requires force');assert.equal(args.at(-1),id,'only the recorded protected container may be removed');rows.delete(id);return id;}
  assert.fail('unexpected Docker command '+args.join(' '));
 };
 return {id,other,label,rows,calls,docker,failStart:()=>{failStart=true;},loseCreate:()=>{loseCreate=true;}};
}

test('labelled protection tolerates concurrent sibling creation and removal',()=>{
 const f=fixture(),protection=protectContainer(f.docker,'candidate','fixture');
 f.rows.delete(f.other);f.rows.set('c'.repeat(64),{label:'io.waitron.traffic-owner=another-sibling',started:'new'});
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

test('lost create response removes the uniquely labelled witness before rethrowing',()=>{
 const f=fixture();f.loseCreate();assert.throws(()=>protectContainer(f.docker,'candidate','fixture'),/controlled lost create response/);
 assert.deepEqual([...f.rows.keys()],[f.other]);
});
for(const status of ['running','exited'])test('preservation still refuses removal of unrelated '+status+' foreign container',()=>{
 const f=fixture();f.rows.get(f.other)!.status=status;f.rows.get(f.other)!.label='unrelated';
 const protection=protectContainer(f.docker,'candidate','fixture');f.rows.delete(f.other);
 assert.throws(()=>protection.verify(),/foreign container identities and start times/);protection.close();
});
test('a stopped witness is refused without removing it from the inventory',()=>{
 const f=fixture(),protection=protectContainer(f.docker,'candidate','fixture');f.rows.get(f.id)!.status='exited';
 assert.throws(()=>protection.verify(),/foreign container identities and start times/);protection.close();
});
test('startup requires exactly one labelled witness and removes only its recorded creation',()=>{
 const f=fixture(),extra='c'.repeat(64);f.rows.set(extra,{label:f.label,started:'other'});
 assert.throws(()=>protectContainer(f.docker,'candidate','fixture'),/exactly one protected witness/);
 assert.deepEqual([...f.rows.keys()],[f.other,extra]);
});
