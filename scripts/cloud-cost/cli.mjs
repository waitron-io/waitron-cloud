const fail = () => { throw Error('Invalid cloud cost local command'); };
function argumentsFor(argv) {
  if (argv.length !== 7 || argv[0] !== 'local') fail();
  const options = {};
  for (let i = 1; i < argv.length; i += 2) {
    const name = argv[i];
    if (!['--private-config', '--cadence', '--window-seconds'].includes(name)
      || Object.hasOwn(options, name) || !argv[i + 1]) fail();
    options[name] = argv[i + 1];
  }
  if (!['original', 'accelerated'].includes(options['--cadence'])
    || !/^(?:[1-9]\d*)(?:\.\d+)?$/.test(options['--window-seconds'])) fail();
  const windowSeconds = Number(options['--window-seconds']);
  if (!Number.isFinite(windowSeconds) || windowSeconds > 7200) fail();
  return { privateConfig: options['--private-config'], cadence: options['--cadence'], windowSeconds };
}

async function main(argv) {
  let abort;
  try {
    if (['build', 'verify'].includes(argv[0])) {
      if (argv.length !== 1) fail();
      const { runPublicCommand } = await import('./publication.mjs');
      process.stdout.write(JSON.stringify(await runPublicCommand(argv[0])) + '\n');
      return;
    }
    const options = argumentsFor(argv);
    const { runLocal } = await import('./run-local.mjs');
    const controller = new AbortController(); abort = () => controller.abort();
    process.on('SIGINT', abort); process.on('SIGTERM', abort);
    const result = await runLocal({ ...options, signal: controller.signal });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    process.stderr.write(['build', 'verify'].includes(argv[0]) ? 'Cloud cost public command refused.\n' : 'Cloud cost local command refused.\n'); process.exitCode = 1;
  } finally {
    if (abort) { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
  }
}

if (import.meta.main) await main(process.argv.slice(2));
