import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
// Management tests start after verification; the proof store owns verification and refusal tests.
export async function openProofWindow(pool:Pool,token:string){
 const hash=createHash('sha256').update(token).digest('hex');
 const password=(await pool.query('SELECT c.password_hash FROM cloud_credentials c JOIN cloud_sessions s ON s.account_id=c.account_id WHERE s.token_hash=$1',[hash])).rows[0].password_hash;
 await pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp(),action_proof_method='recovery',action_credential_fingerprint=$2 WHERE token_hash=$1",[hash,createHash('sha256').update(password).digest('hex')]);
}

export async function prepareConnectionProof(pool:Pool,accountId:string,token:string){
 await pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING',[accountId,randomBytes(32)]);
 await pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
  VALUES($1,$2,$3,$4,0,'multiDevice',true)`,[randomUUID(),accountId,randomUUID(),Buffer.from([1,2,3])]);
 await openProofWindow(pool,token);
}
