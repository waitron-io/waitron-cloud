import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {createLeaseIssuer,RelayMessages} from '@waitron-cloud/registration';
const {schema,issuerKey,config,origin,envelope}=JSON.parse(readFileSync(0,'utf8'));
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
try{
 const relay=new RelayMessages(pool,createLeaseIssuer(issuerKey),origin,{...config,grants:{...config.grants,verifyOrigin:async()=>{throw Error('no reapproval');}}});
 process.stdout.write(JSON.stringify(await relay.execute('email-submit',envelope)));
}finally{await pool.end();}
