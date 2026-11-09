import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {BillingStore,BillingError,assertBillingTransaction,type BillingScope,type BusinessBillingView,type PaymentMethodKind} from '@waitron-cloud/registration';
import {parseTestBillingProviderAccount} from './config.ts';

export type MethodSetup=BillingScope&{id:string;ownerId:string;kind:PaymentMethodKind;providerAccountId:string;methodId:string;createdAt:string;customerId:string|null;providerReference:string|null};
function conflict():never{throw new BillingError('billing_state_conflict');}
function row(value:Record<string,unknown>):MethodSetup{
 return {organisationId:value.organisation_id as string,legalBusinessId:value.legal_business_id as string,
  id:value.id as string,ownerId:value.owner_id as string,kind:value.kind as PaymentMethodKind,
  providerAccountId:value.provider_account_id as string,methodId:value.method_id as string,
  createdAt:(value.created_at as Date).toISOString(),customerId:value.customer_id as string|null,providerReference:value.provider_reference as string|null};
}
export class BillingMethodSetups{
 private readonly store:BillingStore;
 constructor(pool:Pool){this.store=new BillingStore(pool);}
 private async lock(client:PoolClient,scope:BillingScope):Promise<void>{
  await assertBillingTransaction(client);
  if(!(await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[scope.organisationId])).rowCount)conflict();
  if(!(await client.query('SELECT id FROM legal_businesses WHERE organisation_id=$1 AND id=$2 FOR NO KEY UPDATE',[scope.organisationId,scope.legalBusinessId])).rowCount)conflict();
 }
 async readOn(client:PoolClient,scope:BillingScope):Promise<MethodSetup|null>{
  await this.lock(client,scope);
  const found=(await client.query('SELECT * FROM billing_method_setups WHERE organisation_id=$1 AND legal_business_id=$2 FOR UPDATE',[scope.organisationId,scope.legalBusinessId])).rows[0];
  return found?row(found):null;
 }
 async createOn(client:PoolClient,scope:BillingScope,ownerId:string,kind:PaymentMethodKind,providerAccountId:string):Promise<MethodSetup>{
  const provider=parseTestBillingProviderAccount(providerAccountId).provider;
  if((kind==='card'?provider!=='sumup':kind!=='direct_debit'||provider!=='stripe'))throw new BillingError('invalid_billing_input');
  await this.lock(client,scope);
  await this.store.executeOn(client,scope,{key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal'}},{type:'ensure_business'});
  await client.query(`INSERT INTO billing_method_setups(organisation_id,legal_business_id,id,owner_id,kind,provider_account_id,method_id)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organisation_id,legal_business_id) DO UPDATE SET
   id=EXCLUDED.id,owner_id=EXCLUDED.owner_id,kind=EXCLUDED.kind,provider_account_id=EXCLUDED.provider_account_id,
   method_id=EXCLUDED.method_id,created_at=EXCLUDED.created_at,customer_id=NULL,provider_reference=NULL`,
   [scope.organisationId,scope.legalBusinessId,randomUUID(),ownerId,kind,providerAccountId,randomUUID()]);
  return (await this.readOn(client,scope))!;
 }
 async bindOn(client:PoolClient,expected:MethodSetup,value:{customerId:string;providerReference:string}):Promise<MethodSetup>{
  await this.current(client,expected);
  if(expected.customerId!==null||expected.providerReference!==null)conflict();
  await client.query('UPDATE billing_method_setups SET customer_id=$3,provider_reference=$4 WHERE organisation_id=$1 AND legal_business_id=$2',
   [expected.organisationId,expected.legalBusinessId,value.customerId,value.providerReference]);
  return (await this.readOn(client,expected))!;
 }
 async completeOn(client:PoolClient,expected:MethodSetup,value:{methodId:string;mandateId:string|null}):Promise<BusinessBillingView>{
  await this.current(client,expected);
  if(!expected.customerId||!expected.providerReference)conflict();
  const provider=parseTestBillingProviderAccount(expected.providerAccountId).provider;
  const result=await this.store.executeOn(client,{organisationId:expected.organisationId,legalBusinessId:expected.legalBusinessId},
   {key:expected.id,occurredAt:expected.createdAt,source:{kind:'internal'}},
   {type:'set_method',method:{id:expected.methodId,kind:expected.kind,provider,providerAccountId:expected.providerAccountId,
    customerId:expected.customerId,methodId:value.methodId,mandateId:value.mandateId}});
  return result.value as BusinessBillingView;
 }
 private async current(client:PoolClient,expected:MethodSetup):Promise<void>{
  const saved=await this.readOn(client,expected);
  if(!saved||Object.keys(saved).some(key=>saved[key as keyof MethodSetup]!==expected[key as keyof MethodSetup]))conflict();
 }
}
