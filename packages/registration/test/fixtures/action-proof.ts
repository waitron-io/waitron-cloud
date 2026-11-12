import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
// Management tests start after verification; the proof store owns verification and refusal tests.
export async function openProofWindow(pool:Pool,token:string){
 const hash=createHash('sha256').update(token).digest('hex');
 const password=(await pool.query('SELECT c.password_hash FROM cloud_credentials c JOIN cloud_sessions s ON s.account_id=c.account_id WHERE s.token_hash=$1',[hash])).rows[0].password_hash;
 await pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp(),action_proof_method='recovery',action_credential_fingerprint=$2 WHERE token_hash=$1",[hash,createHash('sha256').update(password).digest('hex')]);
}
