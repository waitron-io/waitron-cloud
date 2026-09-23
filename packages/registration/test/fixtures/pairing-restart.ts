import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {PairingStore} from '../../src/pairing.ts';
const schema=process.env.PAIRING_SCHEMA!;if(!/^http_[a-f0-9]+$/.test(schema))throw new Error('Invalid test schema');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`});
try{console.log(JSON.stringify(await new PairingStore(pool).complete(JSON.parse(readFileSync(0,'utf8')))));}finally{await pool.end();}
