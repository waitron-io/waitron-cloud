import {Pool} from 'pg';
import {pairingCodeKeysFromEnv,upgradePairingCodes} from './pairing-codes.ts';
let pool:Pool|undefined;
try {
  const keys=pairingCodeKeysFromEnv(process.env);
  if(process.argv.length!==3||process.argv[2]!=='--once'||!keys||!process.env.DATABASE_URL)throw Error();
  pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
  console.log(JSON.stringify({upgraded:await upgradePairingCodes(pool,keys)}));
}catch{console.error('Pairing code upgrade failed; check database, migrations and key configuration');process.exitCode=1;}
finally{await pool?.end();}
