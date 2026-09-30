import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {RelayGrantStore} from '../../src/relay-grants.ts';
import {transaction} from '../../src/transaction.ts';
const {config,authenticated,input}=JSON.parse(readFileSync(0,'utf8'));
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:process.env.TEST_DATABASE_OPTIONS});
try{
 const store=new RelayGrantStore(pool,{...config,verifyOrigin:async()=>{throw Error('restart must not reapprove');}});
 process.stdout.write(JSON.stringify(await transaction(pool,c=>store.reserve(c,authenticated,input))));
}finally{await pool.end();}
