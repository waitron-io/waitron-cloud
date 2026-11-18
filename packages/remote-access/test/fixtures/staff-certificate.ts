import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {crypto as acmeCrypto} from 'acme-client';

// Worker tests seed the exchange boundary; signed submission belongs to the HTTP tests.
export async function seedStaffCertificate(pool:Pool,id:string,csr:string,certificate:string|null=null,requestId=randomUUID()){
 await pool.query(`INSERT INTO staff_certificate_exchange(installation_id,request_id,request_digest,revision,hostname,csr,certificate,certificate_request_id)
  SELECT i.id,$2,$3,i.configuration_revision,h.hostname,$4,$5,CASE WHEN $5::text IS NULL THEN NULL ELSE $2::uuid END
  FROM installations i JOIN remote_hostnames h ON h.venue_id=i.venue_id AND h.kind='staff' WHERE i.id=$1
  ON CONFLICT(installation_id) DO UPDATE SET request_id=EXCLUDED.request_id,request_digest=EXCLUDED.request_digest,revision=EXCLUDED.revision,hostname=EXCLUDED.hostname,csr=EXCLUDED.csr,certificate=EXCLUDED.certificate,certificate_request_id=EXCLUDED.certificate_request_id`,[id,requestId,createHash('sha256').update(csr).digest('hex'),csr,certificate]);
}

export async function seedCurrentStaffRequest(pool:Pool,id:string){
 const {hostname}=(await pool.query("SELECT h.hostname FROM installations i JOIN remote_hostnames h ON h.venue_id=i.venue_id AND h.kind='staff' WHERE i.id=$1",[id])).rows[0];
 const [,csr]=await acmeCrypto.createCsr({commonName:hostname,altNames:[hostname]});await seedStaffCertificate(pool,id,csr.toString());
}
