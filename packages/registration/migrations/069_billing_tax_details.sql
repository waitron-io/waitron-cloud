ALTER TABLE legal_businesses
  ADD COLUMN billing_address text CHECK (length(btrim(billing_address)) BETWEEN 1 AND 600),
  ADD COLUMN tax_number text CHECK (length(btrim(tax_number)) BETWEEN 1 AND 32);
