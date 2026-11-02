type RecordedChild={id:string;image:string;labels:Record<string,string>};
export function boundFixtureCleanup(docker:(...args:string[])=>string){
 const children=new Map<string,RecordedChild>();
 function inspect(id:string){
  try{
   const found=JSON.parse(docker('inspect',id));
   if(!Array.isArray(found)||found.length!==1||!found[0])throw Error('bound_fixture.inspect');
   return found[0];
  }
  catch(error){
   const failure=error as {status?:unknown;signal?:unknown;stderr?:unknown};
   if(failure.status===1&&!failure.signal&&[`error: no such object: ${id}`,`error response from daemon: no such container: ${id}`].includes(String(failure.stderr??'').trim().toLowerCase()))return null;
   throw error;
  }
 }
 return {
  record(child:RecordedChild){
   const fields=['owner','scope','token','claim','request','deadline'].map(name=>'cloud.backup-verifier.'+name);
   if(!/^[a-f0-9]{64}$/.test(child.id)||!/^sha256:[a-f0-9]{64}$/.test(child.image)||Object.keys(child.labels).length!==fields.length||fields.some(key=>typeof child.labels[key]!=='string'||!child.labels[key]))throw Error('bound_fixture.record');
   children.set(child.id,{...child,labels:{...child.labels}});
  },
  release(){
   const errors:unknown[]=[];
   for(const child of children.values())try{
    const info=inspect(child.id);
    if(info){
     if(info.Id!==child.id||info.Image!==child.image||Object.entries(child.labels).some(([key,value])=>info.Config?.Labels?.[key]!==value))throw Error('bound_fixture.ownership');
     docker('rm','-f',child.id);
     if(inspect(child.id))throw Error('bound_fixture.present');
    }
    children.delete(child.id);
   }catch(error){errors.push(error);}
   if(errors.length)throw new AggregateError(errors,'bound_fixture.cleanup');
  }
 };
}
