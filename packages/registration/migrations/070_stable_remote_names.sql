CREATE TABLE remote_country_zones (
 country text CHECK (country='ES'),
 environment text CHECK (environment IN ('test','production')),
 suffix text NOT NULL UNIQUE CHECK (length(suffix) BETWEEN 1 AND 180),
 PRIMARY KEY (country,environment)
);
INSERT INTO remote_country_zones(country,environment,suffix)
 SELECT country,environment,min(suffix) FROM remote_cells GROUP BY country,environment;

ALTER TABLE remote_hostnames ADD COLUMN assigned_hostname text;
UPDATE remote_hostnames h SET assigned_hostname=
 (CASE h.kind WHEN 'staff' THEN 'staff-' ELSE '' END)||'v-'||h.venue_id||'.'||z.suffix
 FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id
 JOIN remote_country_zones z ON z.country=c.country AND z.environment=c.environment
 WHERE p.venue_id=h.venue_id;
UPDATE remote_hostnames h SET hostname=h.assigned_hostname
 FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id
 WHERE p.venue_id=h.venue_id AND h.hostname=
 (CASE h.kind WHEN 'staff' THEN 'staff-' ELSE '' END)||'v-'||h.venue_id||'.'||c.suffix;

WITH changed AS (
 UPDATE installation_services s SET configuration=
 jsonb_set(jsonb_set(s.configuration,'{staffHostname}',to_jsonb(staff.hostname)),'{publicHostname}',to_jsonb(public.hostname))
 FROM remote_placements p
 JOIN remote_hostnames staff ON staff.venue_id=p.venue_id AND staff.kind='staff'
 JOIN remote_hostnames public ON public.venue_id=p.venue_id AND public.kind='public'
 WHERE s.installation_id=p.installation_id AND s.service='remote_access'
 AND (s.configuration->>'staffHostname' IS DISTINCT FROM staff.hostname
   OR s.configuration->>'publicHostname' IS DISTINCT FROM public.hostname)
 RETURNING s.installation_id
)
UPDATE installations SET configuration_revision=configuration_revision+1
 WHERE id IN (SELECT installation_id FROM changed);
ALTER TABLE remote_hostnames ALTER COLUMN assigned_hostname SET NOT NULL;
ALTER TABLE remote_hostnames ADD UNIQUE (assigned_hostname);
