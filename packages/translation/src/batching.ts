import type {JobItem} from './job-body.ts';
export const batchTarget=90;
export function planBatches(items:readonly JobItem[]):JobItem[][]{
 const families=new Map<string,JobItem[]>();
 for(const item of items){const f=families.get(item.family);if(f)f.push(item);else families.set(item.family,[item]);}
 const groups=new Map<string|null,JobItem[][]>();
 for(const members of families.values()){
  const head=members.find(m=>m.ref===m.family)??members[0]!;
  const g=groups.get(head.category);if(g)g.push(members);else groups.set(head.category,[members]);
 }
 const batches:JobItem[][]=[];let current:JobItem[]=[];
 const close=()=>{if(current.length){batches.push(current);current=[];}};
 for(const group of groups.values()){
  const size=group.reduce((n,f)=>n+f.length,0);
  if(size<=batchTarget){if(current.length+size>batchTarget)close();for(const f of group)current.push(...f);continue;}
  for(const family of group){
   if(family.length>batchTarget){close();batches.push([...family]);continue;}
   if(current.length+family.length>batchTarget)close();
   current.push(...family);
  }
 }
 close();return batches;
}
