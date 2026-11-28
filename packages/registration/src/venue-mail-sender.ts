export const testInboxFrom='relay@example.test';

// Both the relay and portal match signing to the saved sender's current ownership and selector.
export const venueMailSigningJoin=`LEFT JOIN venue_mail_signing s ON s.venue_id=v.id
 AND s.organisation_id=v.organisation_id AND s.selector=v.waitron_mail_dns_token AND s.domain=split_part(v.waitron_mail_from,'@',2)`;
