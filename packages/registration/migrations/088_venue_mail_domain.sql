ALTER TABLE venues
 ADD COLUMN waitron_mail_from text,
 ADD COLUMN waitron_mail_dns_token uuid UNIQUE,
 ADD CONSTRAINT venues_mail_domain_pair CHECK ((waitron_mail_from IS NULL) = (waitron_mail_dns_token IS NULL));
