import type {Pool} from 'pg';

interface ReportRow {
 installation_id:string;venue_id:string;operation_id:string;version_major:number;version_minor:number;version_patch:number;
 reported_at:Date;received_at:Date;logs:{code:string}[];details:unknown;description:string|null;
}
interface GroupRow {code:string;version_major:number;version_minor:number;version_patch:number;automatic_occurrences:string;staff_reports:number}
/** Owner-only inspection: descriptions never enter monitoring status, metrics or public responses. */
export async function staffProblemReports(pool:Pick<Pool,'query'>,environment:'test'|'production'){
 if(environment!=='test'&&environment!=='production')throw new Error('invalid_staff_report_environment');
 const rows=(await pool.query<ReportRow>(`SELECT r.installation_id,i.venue_id,r.operation_id,r.version_major,r.version_minor,r.version_patch,
  r.reported_at,r.received_at,r.logs,r.details,r.description FROM installation_error_reports r JOIN installations i ON i.id=r.installation_id
  WHERE r.environment=$1 AND r.kind='staff' ORDER BY r.received_at DESC,r.installation_id,r.operation_id LIMIT 100`,[environment])).rows;
 const reports=rows.map(r=>({installationId:r.installation_id,venueId:r.venue_id,reportId:r.operation_id,version:[r.version_major,r.version_minor,r.version_patch].join('.'),
  reportedAt:r.reported_at.toISOString(),receivedAt:r.received_at.toISOString(),codes:[...new Set(r.logs.map(l=>l.code))].sort(),details:r.details,description:r.description}));
 const wanted=[...new Map(rows.flatMap(r=>r.logs.map(l=>{
  const key={code:l.code,version_major:r.version_major,version_minor:r.version_minor,version_patch:r.version_patch};return [JSON.stringify(key),key] as const;
 }))).values()];
 if(!wanted.length)return {environment,reports,groups:[]};
 const groups=(await pool.query<GroupRow>(`WITH wanted AS (
  SELECT * FROM jsonb_to_recordset($2::jsonb) AS w(code text,version_major integer,version_minor integer,version_patch integer)
 ), versions AS MATERIALIZED (
  SELECT DISTINCT version_major,version_minor,version_patch FROM wanted
 ), automatic AS MATERIALIZED (
  SELECT r.code,r.version_major,r.version_minor,r.version_patch,sum(r.occurrences)::text AS n
  FROM installation_error_reports r JOIN versions v USING(version_major,version_minor,version_patch)
  WHERE r.environment=$1 AND r.kind='automatic' GROUP BY r.code,r.version_major,r.version_minor,r.version_patch
 ), staff_codes AS MATERIALIZED (
  SELECT DISTINCT r.installation_id,r.operation_id,r.version_major,r.version_minor,r.version_patch,entry->>'code' AS code
  FROM installation_error_reports r JOIN versions v USING(version_major,version_minor,version_patch)
  CROSS JOIN LATERAL jsonb_array_elements(r.logs) entry WHERE r.environment=$1 AND r.kind='staff'
 ), staff_counts AS (
  SELECT code,version_major,version_minor,version_patch,count(*)::integer AS n FROM staff_codes GROUP BY code,version_major,version_minor,version_patch
 ) SELECT w.code,w.version_major,w.version_minor,w.version_patch,COALESCE(a.n,'0') AS automatic_occurrences,COALESCE(s.n,0) AS staff_reports
 FROM wanted w LEFT JOIN automatic a USING(code,version_major,version_minor,version_patch)
 LEFT JOIN staff_counts s USING(code,version_major,version_minor,version_patch)
 ORDER BY w.code,w.version_major,w.version_minor,w.version_patch`,[environment,JSON.stringify(wanted)])).rows;
 return {environment,reports,groups:groups.map(g=>({code:g.code,version:[g.version_major,g.version_minor,g.version_patch].join('.'),automaticOccurrences:g.automatic_occurrences,staffReports:g.staff_reports}))};
}
