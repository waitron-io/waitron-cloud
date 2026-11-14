CREATE TABLE guest_menus (
 venue_id uuid PRIMARY KEY REFERENCES venues(id),
 revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
 state text NOT NULL CHECK (state IN ('off','current','blocked')),
 source_installation_id uuid REFERENCES installations(id),
 body_sha256 text CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
 default_language text CHECK (default_language IN ('en','es','ca','gl')),
 received_at timestamptz,
 pages jsonb,
 CHECK ((state='current' AND source_installation_id IS NOT NULL AND body_sha256 IS NOT NULL
  AND default_language IS NOT NULL AND received_at IS NOT NULL AND pages IS NOT NULL
  AND jsonb_typeof(pages)='object' AND jsonb_typeof(pages->default_language)='string')
  OR (state<>'current' AND source_installation_id IS NULL AND body_sha256 IS NULL
   AND default_language IS NULL AND received_at IS NULL AND pages IS NULL))
);
