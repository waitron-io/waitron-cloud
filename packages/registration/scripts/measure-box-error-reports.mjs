import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {cpus,platform,arch} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createLeaseIssuer} from '../src/installation-proof.ts';
import {createAccountApp} from '../../account-http/src/app.ts';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';

// Capture the statements the real receiver sends, so copied SQL cannot drift.
function recordingPool(pool,reads){
 const wrap=target=>new Proxy(target,{get(object,key){
  if(key==='query')return(sql,values)=>{
   if(/^\s*(SELECT|WITH)\b/i.test(sql))reads.push({sql,values});
   return object.query(sql,values);
  };
  const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value;
 }});
 return new Proxy(pool,{get(object,key){
  if(key==='connect')return async()=>wrap(await object.connect());
  return Reflect.get(wrap(object),key);
 }});
}

async function explain(pool,read){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const result=await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+read.sql,read.values);
  return {...read,plan:result.rows[0]['QUERY PLAN'][0]};
 }finally{await client.query('ROLLBACK');client.release();}
}

export async function measureBoxReports({boxes=1000,releases=20,volumes=[10000,100000,1000000]}={}){
 assert(Number.isInteger(boxes)&&boxes>=2&&boxes<=10000);
 assert(Number.isInteger(releases)&&releases>=2&&releases<=100);
 assert(volumes.length&&volumes.every(n=>Number.isInteger(n)&&n>=boxes&&n>=releases&&n<=1000000));
 const db=await database(),origin='https://cloud.example.test';
 try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const box=await connectedVenue(db,issuer,origin);
  const venues=(await db.pool.query(`INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment)
   SELECT gen_random_uuid(),$1,$2,gen_random_uuid(),'test' FROM generate_series(1,$3::integer) RETURNING id`,[box.organisationId,box.legalBusinessId,boxes-1])).rows;
  const extra=(await db.pool.query(`INSERT INTO installations(id,venue_id,public_key)
   SELECT gen_random_uuid(),v,'synthetic-cost-'||v FROM unnest($1::uuid[]) v RETURNING id`,[venues.map(v=>v.id)])).rows;
  const ids=[box.installationId,...extra.map(row=>row.id)];
  const reads=[],samples=[];
  const app=createAccountApp({pool:recordingPool(db.pool,reads),outbox:db.outbox,leaseIssuer:issuer,
   config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
  for(const total of volumes){
   await db.pool.query('TRUNCATE installation_error_reports');
   const started=performance.now();
   await db.pool.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,code,source,
    version_major,version_minor,version_patch,reported_at,occurrences,logs)
    SELECT ($1::uuid[])[1+(n-1)/$3::integer%$2::integer],gen_random_uuid(),'test',repeat('a',64),
     CASE WHEN bucket<60 THEN 'network.unavailable' WHEN bucket<80 THEN 'storage.disk_full'
      WHEN bucket<90 THEN 'sync.timeout' WHEN bucket<97 THEN 'backup.failed' ELSE 'print.unavailable' END,
     'packages/synthetic/src/worker.ts#run',1,(n-1)%$3::integer,0,
     timestamptz '2026-10-01 00:00:00+00'+(n%2592000)*interval '1 second',1+n%5,
     '[{"level":"error","code":"network.unavailable","source":"packages/synthetic/src/worker.ts#run"},
       {"level":"warn","code":"sync.timeout","source":"packages/synthetic/src/retry.ts#wait"}]'::jsonb
    FROM (SELECT n,(n*17+(n-1)/$3::integer*13)%100 AS bucket FROM generate_series(1,$4::integer) n) generated`,[ids,boxes,releases,total]);
   const insertMs=performance.now()-started;
   await db.pool.query('VACUUM (ANALYZE) installation_error_reports');
   const loaded=(await db.pool.query(`SELECT count(*)::integer AS reports,count(DISTINCT installation_id)::integer AS boxes,
    count(DISTINCT (version_major,version_minor,version_patch))::integer AS releases,count(DISTINCT code)::integer AS codes
    FROM installation_error_reports`)).rows[0];
   assert.equal(loaded.reports,total);assert.equal(loaded.releases,releases);
   const storage=(await db.pool.query(`SELECT pg_table_size('installation_error_reports')::float8 AS "tableBytes",
    pg_indexes_size('installation_error_reports')::float8 AS "indexBytes",
    pg_total_relation_size('installation_error_reports')::float8 AS "totalBytes"`)).rows[0];
   const probes=[],operationId=randomUUID(),version=`1.${releases-1}.0`;
   const report={code:'probe.new_error',source:'packages/synthetic/src/probe.ts#run',version,time:1700000000000,count:1,logs:[]};
   for(const [action,method,value,id] of [
    ['submit','error-report',report,operationId],['duplicate','error-report',report,operationId],
    ['held-latest','release-held',{version},randomUUID()],
    ['held-first','release-held',{version:'1.0.0'},randomUUID()],
    ['held-missing','release-held',{version:'2.0.0'},randomUUID()],
   ]){
    reads.length=0;
    const proof=box.proof(method,value,id,box.lease),start=performance.now();
    const response=await app.request(origin+'/api/installations/'+method,{method:'POST',
     headers:{'content-type':'application/json'},body:JSON.stringify(proof)},
     {incoming:{socket:{remoteAddress:'203.0.113.61'}}});
    assert.equal(response.status,200,await response.clone().text());const result=await response.json();
    const wallMs=performance.now()-start,captured=reads.splice(0);
    const plans=[];for(const read of captured)plans.push(await explain(db.pool,read));
    probes.push({action,result,wallMs,reads:plans});
   }
   const afterProbes=Number((await db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count);
   assert.equal(afterProbes,total+1);
   samples.push({loaded,storage,insertMs,probes,afterProbes});
  }
  const postgres=(await db.pool.query('SELECT version() AS version')).rows[0].version;
  return {postgres,node:process.version,platform:platform(),arch:arch(),cpus:cpus().length,boxes,releases,samples};
 }finally{await db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.log('BOX_REPORT_COST '+JSON.stringify(await measureBoxReports()));
}
