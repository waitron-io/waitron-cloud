import { readFileSync } from 'node:fs';
import { writeStatusPageBundle } from './status-page-bundle.ts';
import { publishInvestigatingUpdate } from './status-page-publisher.ts';

try {
  const [input, destination, ...extra] = process.argv.slice(2);
  if (!input || !destination || extra.length) throw new Error();
  const incident: unknown = JSON.parse(readFileSync(input, 'utf8'));

  await publishInvestigatingUpdate(incident, async (pages) => {
    writeStatusPageBundle(destination, pages);
  });
  console.log('Wrote local status update bundle');
} catch {
  console.error('Status update rehearsal failed. Check the input and use a new output directory.');
  process.exitCode = 1;
}
