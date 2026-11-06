import {readFileSync, realpathSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const requiredCases = () => JSON.parse(readFileSync(new URL('./ci-required-cases.json', import.meta.url), 'utf8'));

// Case receipts come from the test process; source text alone cannot prove execution.
function tracker(requirements, root) {
  const files = new Map(Object.entries(requirements).map(([file, patterns]) => {
    if (!patterns.length || new Set(patterns).size !== patterns.length) throw Error(`Invalid required cases: ${file}`);
    const path = realpathSync(resolve(root, file));
    if (!statSync(path).isFile()) throw Error(`Required test file is missing: ${file}`);
    return [path, patterns.map(pattern => ({pattern, expression: new RegExp(pattern), passed: 0}))];
  }));
  const selected = new Set();
  return {
    observe({type, data}) {
      if (!data.file) return;
      const cases = files.get(realpathSync(data.file));
      if (!cases) return;
      selected.add(cases);
      if (type === 'test:pass' && !data.skip && !data.todo && data.details?.type !== 'suite') {
        for (const item of cases) if (item.expression.test(data.name)) item.passed++;
      }
    },
    finish() {
      let count = 0;
      const failures = [];
      // File events also identify empty files, whose synthetic pass is not a case.
      for (const [file, cases] of files) if (selected.has(cases)) {
        for (const item of cases) {
          if (item.passed !== 1) failures.push(`Required case did not pass exactly once: ${file}: ${item.pattern} (${item.passed})`);
          else count++;
        }
      }
      return {count, failures};
    },
  };
}

export function createRequiredCaseReporter(requirements, {root}) {
  return async function* reporter(events) {
    const receipt = tracker(requirements, root);
    for await (const event of events) receipt.observe(event);
    const {count, failures} = receipt.finish();
    for (const failure of failures) {process.exitCode = 1; yield `# ${failure}\n`;}
    yield `# Required cases: ${count} passed\n`;
  };
}

export async function* requiredCaseEvents(events, {requirements = requiredCases(), root = repositoryRoot} = {}) {
  const receipt = tracker(requirements, root);
  for await (const event of events) {receipt.observe(event); yield event;}
  const {failures} = receipt.finish();
  if (failures.length) throw Error(failures.join('\n'));
}

export default async function* reporter(events) {
  yield* createRequiredCaseReporter(requiredCases(), {root: repositoryRoot})(events);
}
