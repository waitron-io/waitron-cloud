CREATE TABLE installation_error_reports (
  installation_id uuid NOT NULL REFERENCES installations(id),
  operation_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 128),
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 160),
  version_major integer NOT NULL CHECK (version_major >= 0),
  version_minor integer NOT NULL CHECK (version_minor >= 0),
  version_patch integer NOT NULL CHECK (version_patch >= 0),
  reported_at timestamptz NOT NULL,
  occurrences integer NOT NULL CHECK (occurrences BETWEEN 1 AND 1000000),
  logs jsonb NOT NULL CHECK (jsonb_typeof(logs) = 'array' AND jsonb_array_length(logs) <= 8),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, operation_id)
);
CREATE INDEX installation_error_reports_version ON installation_error_reports(environment,version_major,version_minor,version_patch,installation_id) INCLUDE (code,occurrences);
