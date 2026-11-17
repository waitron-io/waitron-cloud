import {Pool} from 'pg';
import {ConsoleAuth, initializeConsole} from './auth.ts';
const [action,name] = process.argv.slice(2);
if (!['create','disable','reissue'].includes(action ?? '') || !name || process.argv.length !== 4 || !process.env.DATABASE_URL) {
  console.error('Usage: DATABASE_URL=… node packages/account-http/src/worldwide/admin-cli.ts create|disable|reissue "Admin name"');
  process.exitCode = 1;
} else {
  const pool = new Pool({connectionString:process.env.DATABASE_URL});
  try {
    await initializeConsole(pool);
    const secret = await new ConsoleAuth(pool,'https://console.waitron.io').admin(action as 'create'|'disable'|'reissue',name);
    if (secret) process.stdout.write(secret+'\n');
  } catch (error) {console.error('Console admin command failed:',error instanceof Error ? error.name : 'Error');process.exitCode=1;}
  finally {await pool.end();}
}
