CREATE TABLE billing_method_setups (
 organisation_id uuid NOT NULL,
 legal_business_id uuid NOT NULL,
 id uuid NOT NULL UNIQUE,
 owner_id uuid NOT NULL REFERENCES cloud_accounts(id),
 kind text NOT NULL CHECK(kind IN ('card','direct_debit')),
 provider_account_id billing_reference NOT NULL,
 method_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 customer_id billing_reference,
 provider_reference billing_reference,
 PRIMARY KEY(organisation_id,legal_business_id),
 FOREIGN KEY(organisation_id,legal_business_id) REFERENCES billing_businesses,
 CHECK((kind='card' AND provider_account_id ~ '^sumup-sandbox:[A-Za-z0-9_]+$') OR
       (kind='direct_debit' AND provider_account_id ~ '^stripe-test:[A-Za-z0-9_]+$')),
 CHECK((customer_id IS NULL)=(provider_reference IS NULL))
);
