import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../../account-http/test/fixtures.ts';
export async function guestMenuFixture(existing?:Awaited<ReturnType<typeof database>>){
 const db=existing??await database(),email=`menu-${randomUUID()}@example.test`,password='A long synthetic menu password';
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const store=new RegistrationStore(db.pool),input={operationId:randomUUID(),installationKey:'menu-test-key',venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await store.start(input);await store.approveCloud(input,owner.accountId);await store.approveLocal(input,randomUUID());
 const installed=await store.complete(input);
 const seed=async(pages:Record<string,string>={'en':'<h1>Menu</h1>','es':'<h1>Menú</h1>'})=>db.pool.query(`INSERT INTO guest_menus(venue_id,revision,state,source_installation_id,body_sha256,default_language,received_at,pages)
  VALUES($1,1,'current',$2,$3,'en','2026-11-01T12:00:00Z',$4)`,[installed.venueId,installed.installationId,'a'.repeat(64),pages]);
 return {db,email,password,owner,...installed,seed};
}
