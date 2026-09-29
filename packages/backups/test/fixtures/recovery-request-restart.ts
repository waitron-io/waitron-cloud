import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {RecoveryRequests} from '../../src/recovery-request.ts';
import {BackupKeyVault} from '../../src/keys.ts';
const schema=process.env.RECOVERY_SCHEMA!;if(!/^http_[a-f0-9]+$/.test(schema))throw new Error('Invalid test schema');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
try{console.log(JSON.stringify(await new RecoveryRequests(pool,new BackupKeyVault(Buffer.alloc(32,1)),'https://cloud.test').machine('status',JSON.parse(readFileSync(0,'utf8')))));}finally{await pool.end();}
