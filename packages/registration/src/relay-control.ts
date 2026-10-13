import type {Pool, PoolClient} from 'pg';
import {RelayError} from './relay-grants.ts';
import {messageError} from './relay-payload.ts';
import {transaction} from './transaction.ts';

export interface RelayControlStatus {stopped: boolean}

export class RelayControl {
  readonly #pool: Pool;
  constructor(pool: Pool) {this.#pool = pool;}

  async lock(client: PoolClient): Promise<RelayControlStatus> {
    try {await client.query('SAVEPOINT relay_control_transaction');}
    catch (error) {
      if ((error as {code?: string}).code === '25P01') throw new RelayError('transaction_required');
      throw error;
    }
    await client.query('RELEASE SAVEPOINT relay_control_transaction');
    // Hold SHARE through the caller's commit so acknowledged stop cannot overtake its work.
    const row = (await client.query<RelayControlStatus>('SELECT stopped FROM relay_control WHERE singleton FOR SHARE')).rows[0];
    if (!row) messageError('relay_unavailable');
    return {stopped: row.stopped};
  }

  async status(): Promise<RelayControlStatus> {
    const row = (await this.#pool.query<RelayControlStatus>('SELECT stopped FROM relay_control WHERE singleton')).rows[0];
    if (!row) messageError('relay_unavailable');
    return {stopped: row.stopped};
  }

  async #set(stopped: boolean): Promise<RelayControlStatus> {
    return transaction(this.#pool, async client => {
      const row = (await client.query<RelayControlStatus>('SELECT stopped FROM relay_control WHERE singleton FOR UPDATE')).rows[0];
      if (!row) messageError('relay_unavailable');
      await client.query('UPDATE relay_control SET stopped=$1 WHERE singleton', [stopped]);
      return {stopped};
    });
  }

  stop(): Promise<RelayControlStatus> {return this.#set(true);}
  resume(): Promise<RelayControlStatus> {return this.#set(false);}
}
