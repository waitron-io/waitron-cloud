import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';

// The backup-state venue uses its own CA; the routed staff certificate does not establish upstream trust.
export function requestIntegrationVenue(origin, path, options, response) {
  const target = new URL(path, origin);
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return request(target, {...options, headers: {...options.headers, host: target.host}}, response);
}
