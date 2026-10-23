export function cliEnvironment(overrides:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv {
 const env:NodeJS.ProcessEnv={...process.env,...overrides};
 // Strict diagnostic checks need colorless children even when a test runner forces color.
 delete env.FORCE_COLOR;
 return env;
}
