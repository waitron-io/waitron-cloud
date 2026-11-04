import assert from 'node:assert/strict';

// Only positively labelled traffic siblings own a lifecycle that can change during this fixture.
export function protectContainer(docker:(args:string[])=>string,image:string,tag:string){
 const label='io.waitron.traffic-protected='+tag;
 const owned=()=>docker(['ps','-aq','--no-trunc','--filter','label='+label]).trim().split('\n').filter(Boolean);
 let id:string|undefined;
 const close=()=>{
  docker(['rm','--force',id!]);
  assert.equal(docker(['ps','-aq','--no-trunc','--filter','id='+id]).trim(),'','protected witness must be removed');
 };
 try{
  id=docker(['create','--name',tag+'-protected','--label',label,'--network','none','--memory=32m','--cpus=0.1',image,'sleep','300']).trim();
  assert.match(id,/^[a-f0-9]{64}$/);
  docker(['start',id]);
  assert.equal(owned().length,1,'exactly one protected witness must exist');
  const inventory=()=>{
   const unrelated=docker(['ps','-aq','--no-trunc','--filter','label!=io.waitron.traffic-owner','--filter','label!=io.waitron.traffic-protected']).trim().split('\n').filter(Boolean);
   return [...unrelated,...owned()].sort().map(container=>docker(['inspect','--format','{{.Id}} {{.State.StartedAt}} {{.State.Status}}',container]).trim());
  };
  const before=inventory();
  return {verify:()=>assert.deepEqual(inventory(),before,'foreign container identities and start times must survive the fixture'),close};
 }catch(error){
  // A failed client response can follow a successful create; the unique label still identifies our creation.
  if(id)close();else for(const container of owned())docker(['rm','--force',container]);
  throw error;
 }
}
