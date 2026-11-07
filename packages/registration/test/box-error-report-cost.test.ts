import assert from 'node:assert/strict';
import {test} from 'node:test';

function repeatedAggregates(plan:Record<string,any>):number{
 return (plan['Node Type']==='Aggregate'&&plan['Actual Loops']>1?1:0)
  +(plan.Plans??[]).reduce((n:number,p:Record<string,any>)=>n+repeatedAggregates(p),0);
}
function reportRows(plan:Record<string,any>):number{
 return (plan['Relation Name']==='installation_error_reports'?plan['Actual Rows']*plan['Actual Loops']:0)
  +(plan.Plans??[]).reduce((n:number,p:Record<string,any>)=>n+reportRows(p),0);
}

test('volume measurement loads distinct boxes and releases and explains real receiver reads',async()=>{
 const runner=await import(new URL('../scripts/measure-box-error-reports.mjs',import.meta.url).href).catch((error:NodeJS.ErrnoException)=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return undefined;throw error;
 });
 const result=await runner?.measureBoxReports({boxes:40,releases:20,volumes:[1000,2000]});
 assert.equal(result?.samples.length,2,'the measurement must run both requested PostgreSQL volumes');
 for(const [i,sample] of result.samples.entries()){
  assert.equal(sample.loaded.reports,[1000,2000][i]);
  assert.equal(sample.loaded.boxes,40);
  assert.equal(sample.loaded.releases,20);
  assert.equal(sample.loaded.codes,5);
  assert(sample.storage.tableBytes>0);assert(sample.storage.indexBytes>0);
  assert(sample.insertMs>0);
  for(const action of ['submit','duplicate','held-latest','held-first','held-missing']){
   const probe=sample.probes.find((p:{action:string})=>p.action===action);
   assert(probe,action);assert.equal(probe.reads.length,8,'include three real route allowance reads and five receiver reads');
   for(const read of probe.reads){
    assert(read.plan.Plan);assert(read.plan['Execution Time']>=0);
    assert.equal(repeatedAggregates(read.plan.Plan),0,'a hold read must compute each aggregate once');
    if(action==='held-first'||action==='held-missing')assert(reportRows(read.plan.Plan)<=1,
     'a missing comparison needs only an existence probe, not a version history scan');
   }
  }
  assert.equal(sample.probes.find((p:{action:string})=>p.action==='submit').result.accepted,true);
  assert.equal(sample.probes.find((p:{action:string})=>p.action==='duplicate').result.accepted,true);
  assert.deepEqual(sample.probes.find((p:{action:string})=>p.action==='held-first').result,{version:'1.0.0',held:false});
  assert.deepEqual(sample.probes.find((p:{action:string})=>p.action==='held-missing').result,{version:'2.0.0',held:false});
  assert.equal(sample.afterProbes,[1001,2001][i],'duplicate probing must add only the original report');
 }
});
