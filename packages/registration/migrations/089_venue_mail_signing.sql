-- Keep the provider identity reachable for retirement after the venue is removed.
CREATE TABLE venue_mail_signing (
  venue_id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  domain text NOT NULL CHECK (domain = lower(domain)),
  selector uuid NOT NULL,
  public_key text NOT NULL,
  ses_region text NOT NULL,
  zone_id text NOT NULL,
  dns_suffix text NOT NULL,
  tag uuid NOT NULL UNIQUE,
  UNIQUE (ses_region, domain)
);
