import {Pool} from 'pg';
import {recoveryCodeKeysFromEnv,upgradeRecoveryCodes} from './recovery-codes.ts';
let pool:Pool|undefined;
try {
  const keys=recoveryCodeKeysFromEnv(process.env);
  if(process.argv.length!==3||process.argv[2]!=='--once'||!keys||!process.env.DATABASE_URL)throw Error();
  pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
  console.log(JSON.stringify({upgraded:await upgradeRecoveryCodes(pool,keys)}));
}catch{console.error('Recovery code upgrade failed; check database, migrations and key configuration');process.exitCode=1;}
finally{await pool?.end();}
