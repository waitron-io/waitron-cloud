CREATE TABLE staff_certificate_exchange (
 installation_id uuid PRIMARY KEY REFERENCES installations(id),
 request_id uuid NOT NULL UNIQUE,
 request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
 revision integer NOT NULL CHECK (revision >= 0),
 hostname text NOT NULL CHECK (length(hostname) BETWEEN 1 AND 253),
 csr text NOT NULL CHECK (octet_length(csr) BETWEEN 1 AND 4096),
 certificate text CHECK (octet_length(certificate) BETWEEN 1 AND 16384),
 certificate_request_id uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((certificate IS NULL) = (certificate_request_id IS NULL))
);
