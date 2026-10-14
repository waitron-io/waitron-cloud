
const fail = () => { throw new Error('Invalid cloud cost replay configuration'); };
const requireThat = value => { if (!value) fail(); };
const exact = (value, keys) => {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  const actual = Reflect.ownKeys(value);
  requireThat(actual.length === keys.length && actual.every(k => keys.includes(k)
    && Object.getOwnPropertyDescriptor(value, k).get === undefined));
};
const endpoints = { s3: ['http:', 's3'], postgres: ['postgresql:', 'postgres'], smtp: ['smtp:', 'mailpit'],
  fiscal: ['http:', 'fiscal'], gateway: ['https:', 'gateway'] };
const senders = { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' };

export function validateReplayConfig(config) {
  try {
    exact(config, ['localEndpoints', 'senders']); exact(config.localEndpoints, Object.keys(endpoints));
    exact(config.senders, Object.keys(senders));
    for (const [key, [protocol, host]] of Object.entries(endpoints)) {
      const value = config.localEndpoints[key]; requireThat(typeof value === 'string');
      const url = new URL(value);
      requireThat(url.protocol === protocol && [host, '127.0.0.1', '[::1]'].includes(url.hostname));
      // Check the spelling too: URL normalization must not admit alternative loopback addresses.
      const authority = value.match(/^[a-z]+:\/\/([^/?#]+)/)?.[1]?.split('@').at(-1);
      requireThat(authority === `${url.hostname}${url.port ? ':' + url.port : protocol === 'https:' ? ':443' : ':80'}`
        || (protocol === 'https:' && authority === url.hostname));
      requireThat(!url.search && !url.hash);
      if (key === 'postgres') {
        requireThat(/^[a-z][a-z0-9_]{0,63}$/.test(url.pathname.slice(1)));
        requireThat(/^[A-Za-z0-9_-]{1,64}$/.test(url.username) && /^[A-Za-z0-9_-]{1,64}$/.test(url.password));
      } else requireThat(!url.username && !url.password && ['/', ''].includes(url.pathname));
      const port = Number(url.port || (protocol === 'https:' ? 443 : protocol === 'http:' ? 80 : 0));
      requireThat(Number.isInteger(port) && port > 0 && port <= 65535);
    }
    for (const key of Object.keys(senders)) requireThat(config.senders[key] === senders[key]);
    return structuredClone(config);
  } catch { fail(); }
}
