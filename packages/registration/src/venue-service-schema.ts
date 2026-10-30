import type {PoolClient} from 'pg';

// Only a schema with neither authority nor its committed migration is historical.
// A missing current table must surface as an error rather than restore legacy grants.
export async function venueServiceAuthorityInstalled(client:PoolClient):Promise<boolean>{
 return (await client.query(`SELECT to_regclass('billing_service_authority') IS NOT NULL
  OR EXISTS(SELECT 1 FROM schema_migrations WHERE name='046_venue_service_authority.sql') AS installed`)).rows[0].installed;
}
