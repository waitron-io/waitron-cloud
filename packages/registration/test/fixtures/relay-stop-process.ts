import {Pool, type PoolClient} from 'pg';
import {RelayWorker} from '../../src/relay-worker.ts';

let worker: RelayWorker;
let pool: Pool;
let resume: (() => void) | undefined;
let pauseClaim = false;
let pauseSending = false;
process.on('message', async (message: any) => {
  try {
    if (message.action === 'init') {
      const config = message.config;
      config.grants.verifyOrigin = async () => {throw new Error('unused');};
      pool = new Pool({connectionString: process.env.TEST_DATABASE_URL, max: 1,
        application_name: message.name, options: `-c search_path=${process.env.RELAY_TEST_SCHEMA} -c statement_timeout=5000`});
      const wrapped = new Proxy(pool, {get(target, property) {
        if (property === 'connect') return async () => {
          const client = await target.connect();
          let claimed = false, sending = false;
          return new Proxy(client, {get(c, p) {
            if (p === 'query') return async (sql: string, values?: unknown[]) => {
              const result = await c.query(sql, values);
              if (sql.startsWith('UPDATE relay_messages SET claim_id=')) claimed = !!result.rowCount;
              if (sql.startsWith("UPDATE relay_messages SET state='sending'")) sending = !!result.rowCount;
              if (sql === 'COMMIT' && claimed && pauseClaim) {
                pauseClaim = false;
                await new Promise<void>(resolve => {resume = resolve; process.send!({event: 'claimed'});});
              }
              if (sql === 'COMMIT' && sending && pauseSending) {
                pauseSending = false;
                await new Promise<void>(resolve => {resume = resolve; process.send!({event: 'sending'});});
              }
              return result;
            };
            const value = Reflect.get(c, p);
            return typeof value === 'function' ? value.bind(c) : value;
          }}) as PoolClient;
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }});
      worker = new RelayWorker(wrapped, config);
      process.send!({id: message.id, result: true});
    } else if (message.action === 'release') {pauseClaim = false; pauseSending = false; resume?.(); resume = undefined;}
    else if (message.action === 'close') {resume?.(); await pool.end(); process.disconnect();}
    else {
      if (message.action === 'run') {pauseClaim = !!message.pauseClaim; pauseSending = !!message.pauseSending;}
      const result = message.action === 'status' ? await worker.status() : await worker.runOnce();
      process.send!({id: message.id, result});
    }
  } catch (error) {process.send!({id: message.id, error: (error as {code?: string}).code ?? 'fixture_failure'});}
});
