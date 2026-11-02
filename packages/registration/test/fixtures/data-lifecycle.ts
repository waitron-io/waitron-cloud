import {randomUUID} from 'node:crypto';
import {after,before,beforeEach} from 'node:test';
import {Pool} from 'pg';
import {migrate} from '../../src/migrate.ts';
import {resetSchema} from './reset-schema.ts';

export function lifecycleFixture(prefix:string){
 const connectionString=process.env.TEST_DATABASE_URL;
 if(!connectionString)throw new Error('Run through scripts/test-postgres.mjs');
 const schema=`${prefix}_${randomUUID().replaceAll('-','')}`;
 const options=`-c search_path=${schema},pg_catalog -c statement_timeout=10000 -c application_name=${schema}`;
 const admin=new Pool({connectionString}),pool=new Pool({connectionString,options});
 const venueId=randomUUID(),foreignVenueId=randomUUID(),organisationId=randomUUID(),businessId=randomUUID();
 before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
 beforeEach(async()=>{
  await resetSchema(pool);
  await pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[businessId,organisationId]);
  await pool.query(`INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment)
   VALUES($1,$3,$4,$1,'test'),($2,$3,$4,$2,'test')`,[venueId,foreignVenueId,organisationId,businessId]);
 });
 after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
 return {pool,venueId,foreignVenueId,connectionString,options,schema};
}
