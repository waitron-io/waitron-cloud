import assert from 'node:assert/strict';

// A private witness stays alive across cleanup; sibling fixtures may create and remove their own containers.
export function protectContainer(docker:(args:string[])=>string,image:string,tag:string){
 const label='io.waitron.traffic-protected='+tag;
 const id=docker(['create','--name',tag+'-protected','--label',label,'--network','none','--memory=32m','--cpus=0.1',image,'sleep','300']).trim();
 assert.match(id,/^[a-f0-9]{64}$/);
 const inventory=()=>docker(['ps','-aq','--no-trunc','--filter','label='+label]).trim().split('\n').filter(Boolean).sort()
  .map(container=>docker(['inspect','--format','{{.Id}} {{.State.StartedAt}}',container]).trim());
 const close=()=>{
  docker(['rm','--force',id]);
  assert.equal(docker(['ps','-aq','--no-trunc','--filter','id='+id]).trim(),'','protected witness must be removed');
 };
 try{
  docker(['start',id]);
  const before=inventory();assert.equal(before.length,1,'exactly one protected witness must exist');
  return {verify:()=>assert.deepEqual(inventory(),before,'foreign container identities and start times must survive the fixture'),close};
 }catch(error){close();throw error;}
}
