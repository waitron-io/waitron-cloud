import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';

const originalExec=child.execFileSync,originalSpawn=child.spawnSync;
const scenario=process.env.TRAFFIC_WRAPPER_FAULT,rows=new Map([
 ['c'.repeat(64),{name:'unrelated-running',label:'unrelated=running',started:'original',status:'running',image:'different-running-image'}],
 ['d'.repeat(64),{name:'unrelated-stopped',label:'unrelated=stopped',started:'original',status:'exited',image:'different-stopped-image'}],
 ['b'.repeat(64),{name:'sibling',label:'io.waitron.traffic-owner=sibling',started:'original',status:'running',image:'sibling-image'}],
]);
const images=new Set(),volumes=new Set();let sequence=0,called=false,damaged=false;
const inspect=(row,id,format)=>format.replace('{{.Id}}',id).replace('{{.State.StartedAt}}',row.started).replace('{{.State.Status}}',row.status)
 .replace('{{.State.ExitCode}}','0').replace('{{json .Mounts}}',JSON.stringify(row.volume?[{Type:'volume',Name:row.volume}]:[]));
const protectedRow=row=>row.label.startsWith('io.waitron.traffic-protected=');
function docker(args){
 called=true;
 if(args[0]==='build'){images.add(args[args.indexOf('-t')+1]);return '';}
 if(args[0]==='create'){
  const id=(++sequence).toString(16).padStart(64,'0'),name=args[args.indexOf('--name')+1];
  const label=args.includes('--label')?args[args.indexOf('--label')+1]:'';
  const image=[...images].find(value=>args.includes(value))??'postgres:18-alpine';
  const row={name,label,image,started:'created',status:'created',volume:name.endsWith('-db')?'owned-volume':undefined};rows.set(id,row);
  if(row.volume)volumes.add(row.volume);
  if(protectedRow(row)&&scenario==='lost-create')throw Error('controlled lost create response');
  return id;
 }
 if(args[0]==='start'){const row=rows.get(args.at(-1));row.status='running';row.started='first-start';return args.at(-1);}
 if(args[0]==='exec')return 'accepting connections';
 if(args[0]==='inspect'){const id=args.at(-1),row=rows.get(id);if(!row)throw Error('missing container');return inspect(row,id,args[args.indexOf('--format')+1]);}
 if(args[0]==='ps'){
  const all=args.some(value=>/^-[a-z]*a[a-z]*$/.test(value)),filters=args.flatMap((value,i)=>value==='--filter'?[args[i+1]]:[]);
  if(filters.some(filter=>filter.startsWith('label!=')))throw Error("invalid filter 'label!'");
  const selected=[...rows].filter(([id,row])=>(all||row.status==='running')&&filters.every(filter=>{
   if(filter.startsWith('label!='))return row.label.split('=')[0]!==filter.slice(7);
   if(filter.startsWith('label='))return row.label===filter.slice(6);
   if(filter.startsWith('id='))return id===filter.slice(3);
   if(filter.startsWith('name='))return new RegExp(filter.slice(5)).test('/'+row.name);
   throw Error('unknown filter '+filter);
  }));
  if(args.includes('--format'))return selected.map(([id,row])=>id+'|'+(row.label.startsWith('io.waitron.traffic-owner=')?row.label.split('=')[1]:'')+'|'+(row.label.startsWith('io.waitron.traffic-protected=')?row.label.split('=')[1]:'')).sort().join('\n');
  return selected.map(([id])=>id).sort().join('\n');
 }
 if(args[0]==='rm'){
  const id=args.at(-1),row=rows.get(id);if(!row)return '';
  if(row.status==='running'&&!args.includes('--force'))throw Error('running container requires force');
  rows.delete(id);if(row.volume&&args.includes('--volumes'))volumes.delete(row.volume);
  if(!protectedRow(row)&&!damaged){
   damaged=true;
   const witness=[...rows].find(([,value])=>protectedRow(value));
   if(witness&&scenario==='witness-restarted')witness[1].started='second-start';
   if(witness&&scenario==='witness-stopped')witness[1].status='exited';
   if(scenario==='foreign-running-removed')rows.delete('c'.repeat(64));
   if(scenario==='foreign-stopped-removed')rows.delete('d'.repeat(64));
   if(scenario==='sibling-churn'){rows.delete('b'.repeat(64));rows.set('e'.repeat(64),{name:'next-sibling',label:'io.waitron.traffic-owner=next',started:'new',status:'running',image:'sibling-image'});}
  }
  return id;
 }
 if(args[0]==='image'&&args[1]==='rm'){
  const image=args.at(-1);if([...rows.values()].some(row=>row.image===image))throw Error('image still has a container');images.delete(image);return '';
 }
 if(args[0]==='image'&&args[1]==='ls')return images.has(args.at(-1))?'owned-image':'';
 if(args[0]==='volume'&&args[1]==='ls')return [...volumes].join('\n');
 throw Error('unexpected Docker command '+args.join(' '));
}
child.execFileSync=function(command,args,options){
 if(command==='docker')return Buffer.from(docker(args));
 if(command==='git')return Buffer.from(args[0]==='status'?'':args.at(-1)==='HEAD^{tree}'?'b'.repeat(40):'a'.repeat(40));
 return originalExec.call(this,command,args,options);
};
child.spawnSync=function(command,args,options){
 if(command!=='docker')return originalSpawn.call(this,command,args,options);
 const row=rows.get(args.at(-1)),count=row.name.endsWith('-counters')?5:row.name.endsWith('-collector')?13:row.name.endsWith('-gateway')?4:1;
 return {status:0,signal:null,stdout:`# tests ${count}\n# pass ${count}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`,stderr:''};
};
syncBuiltinESMExports();
process.on('exit',()=>{
 if(called)writeFileSync(process.env.TRAFFIC_WRAPPER_STATE,JSON.stringify({containers:[...rows.values()],images:[...images],volumes:[...volumes],damaged}));
});
