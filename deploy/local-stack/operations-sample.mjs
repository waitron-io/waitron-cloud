import {checkConsumerDatabase,loadRuntime,runtimeEnvironment} from './runtime.mjs';

// Each new sample checks the complete release ledger before invoking the existing
// status command. A failed inspection must never refresh the last healthy sample.
try{
 const {DATABASE_URL}=runtimeEnvironment('usage',await loadRuntime('/run/local-stack'));
 process.env.DATABASE_URL=DATABASE_URL;
 process.env.CLOUD_CONTROL_API_URL='http://localhost:3000';
 await checkConsumerDatabase(DATABASE_URL,process.cwd());
 await import('../../packages/operations/src/cli.ts');
}catch{console.error('Local operations inspection failed');process.exitCode=1;}
