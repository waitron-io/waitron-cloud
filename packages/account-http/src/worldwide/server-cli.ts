import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {serve} from '@hono/node-server';
import {Pool} from 'pg';
import {createConsoleApp, type ConsoleOptions} from './app.ts';
import {ConsoleAuth, initializeConsole} from './auth.ts';
import {CountryReadiness} from './countries.ts';
import type {PortalAssets} from '../portal.ts';
export async function startConsole(options: ConsoleOptions & {port:number; hostname?:string}) {
  await initializeConsole(options.auth.pool);
  const app = createConsoleApp(options);
  const server = serve({fetch:app.fetch,port:options.port,hostname:options.hostname ?? '127.0.0.1'});
  await new Promise<void>((resolve,reject) => {server.once('listening',resolve);server.once('error',reject);});
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Console did not bind');
  return {port:address.port,async close() {if ('closeIdleConnections' in server) server.closeIdleConnections(); await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));}};
}
export async function loadConsoleAssets(directory: string): Promise<PortalAssets> {
  return new Map(await Promise.all([['worldwide.js','text/javascript; charset=utf-8'],['app.css','text/css; charset=utf-8']].map(async ([name,contentType]) =>
    ['/'+name,{body:await readFile(`${directory}/${name}`),contentType:contentType!}] as const)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = new Pool({connectionString:process.env.DATABASE_URL});
  try {
    if (!process.env.DATABASE_URL || !process.env.CONSOLE_ORIGIN || !process.env.CONSOLE_RATE_KEY || !process.env.CONSOLE_COUNTRIES || !process.env.CLOUD_PORTAL_ASSETS_DIR) throw new Error('Missing console configuration');
    const running = await startConsole({auth:new ConsoleAuth(pool,process.env.CONSOLE_ORIGIN),
      countries:new CountryReadiness(JSON.parse(process.env.CONSOLE_COUNTRIES)),rateKey:process.env.CONSOLE_RATE_KEY,
      assets:await loadConsoleAssets(process.env.CLOUD_PORTAL_ASSETS_DIR),port:Number(process.env.PORT ?? '3000'),hostname:'0.0.0.0'});
    console.log('Console listening');
    const stop = async () => {await running.close();await pool.end();};
    process.once('SIGTERM',() => {void stop();});process.once('SIGINT',() => {void stop();});
  } catch (error) {console.error('Console startup failed:',error instanceof Error ? error.name : 'Error');await pool.end();process.exitCode=1;}
}
