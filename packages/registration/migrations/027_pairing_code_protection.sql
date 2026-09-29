ALTER TABLE pairing_requests DROP CONSTRAINT pairing_requests_code_hash_check;
ALTER TABLE pairing_requests ADD CONSTRAINT pairing_requests_code_hash_check
  CHECK (code_hash ~ '^([0-9a-f]{64}|v1:[A-Za-z0-9_-]{1,64}:[0-9a-f]{64})$');
