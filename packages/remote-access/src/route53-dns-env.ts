import {createRoute53DnsProvider} from './route53-dns.ts';
// The operator supplies one delegated zone; AWS credentials use the SDK's normal environment.
export default createRoute53DnsProvider({zoneId:process.env.CLOUD_DNS_ZONE_ID??'',suffix:process.env.CLOUD_DNS_SUFFIX??''});
