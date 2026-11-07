import type {PoolClient} from 'pg';
import {BillingError} from './billing-types.ts';

// A savepoint requires an explicit transaction without changing the caller's isolation level.
export async function assertBillingTransaction(client:PoolClient):Promise<void>{
 try{await client.query('SAVEPOINT billing_caller_transaction');}catch(error){
  if((error as {code?:string}).code==='25P01')throw new BillingError('invalid_billing_input');throw error;
 }
 await client.query('RELEASE SAVEPOINT billing_caller_transaction');
}
