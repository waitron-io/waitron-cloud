import {Pool} from 'pg';
import {LifecycleStore} from '../../src/data-lifecycle.ts';

const {ref,operationId,effectId,stage}=JSON.parse(process.argv[2]!);
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:process.env.LIFECYCLE_TEST_OPTIONS});
const store=new LifecycleStore(pool),claim=await store.claim(ref,operationId);
if(!claim)throw new Error('fixture_claim_refused');
const effect={effectId,requestFingerprint:'b'.repeat(64),phase:'intent' as const};
if(stage!=='claimed')await store.recordEffect(ref,operationId,claim.claimRevision,effect);
if(stage==='called'||stage==='observed')await pool.query('INSERT INTO lifecycle_external_calls(operation_id) VALUES($1)',[operationId]);
if(stage==='observed')await store.recordEffect(ref,operationId,claim.claimRevision,{...effect,phase:'confirmed'});
process.send?.(stage);
// The parent kills this recorded child at the committed boundary, without a graceful release.
setInterval(()=>{},1000);
