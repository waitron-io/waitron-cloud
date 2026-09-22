import { Pool } from 'pg';
import { testOutbox } from './delivery.ts';
import { SignupStore } from '../../src/index.ts';

const schema = process.env.SIGNUP_TEST_SCHEMA;
if (!schema || !/^signup_[a-f0-9]+$/.test(schema)) throw new Error('Invalid test schema');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
try {
  const store = new SignupStore(pool, testOutbox);
  await store.complete(process.env.SIGNUP_TEST_TOKEN!, JSON.parse(process.env.SIGNUP_TEST_DETAILS!));
} finally { await pool.end(); }
