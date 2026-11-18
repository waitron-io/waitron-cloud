import {constants} from 'node:crypto';
import {createServer, type Server, type TLSSocket} from 'node:tls';
import {readChallengeFolder} from './challenge-files.ts';

const protocol = 'acme-tls/1';

export class AlpnResponder {
  readonly #server: Server;
  readonly #folder: string;
  readonly #routeNames: () => ReadonlySet<string>;
  readonly #now: () => number;
  #checks: Awaited<ReturnType<typeof readChallengeFolder>> = new Map();

  constructor({folder, routeNames, now = Date.now}: {folder: string; routeNames: () => ReadonlySet<string>; now?: () => number}) {
    this.#folder = folder;
    this.#routeNames = routeNames;
    this.#now = now;
    const responder = this;
    // Without a default certificate, clients which omit ALPN cannot complete TLS.
    this.#server = createServer({handshakeTimeout: 3000, secureOptions: constants.SSL_OP_NO_TICKET,
      ALPNCallback(this: TLSSocket, {servername, protocols}) {
        const check = responder.#checks.get(servername);
        if (!check || check.expiresAt <= now() || !routeNames().has(servername) || !protocols.includes(protocol)) return;
        this.setKeyCert(check.context);
        return protocol;
      },
    }, socket => socket.end());
  }

  async refresh() {
    try {
      this.#checks = await readChallengeFolder(this.#folder, this.#routeNames(), this.#now(), this.#checks);
    } catch (error) {
      this.#checks.clear();
      throw error;
    }
  }

  answerable() {
    const names = this.#routeNames(), now = this.#now();
    return [...this.#checks].filter(([name, check]) => check.expiresAt > now && names.has(name)).map(([name]) => name).sort();
  }

  async listen(port: number) {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(port, '127.0.0.1', () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
    return (this.#server.address() as {port: number}).port;
  }

  async close() {
    await new Promise<void>(resolve => this.#server.close(() => resolve()));
  }
}
