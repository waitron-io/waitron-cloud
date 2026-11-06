import {readFileSync, realpathSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const requiredCases = () => JSON.parse(readFileSync(new URL('./ci-required-cases.json', import.meta.url), 'utf8'));

// Case receipts come from the test process; source text alone cannot prove execution.
function tracker(requirements, root) {
  const files = new Map(Object.entries(requirements).map(([file, patterns]) => {
    if (!patterns.length || new Set(patterns).size !== patterns.length) throw Error(`Invalid required cases: ${file}`);
    let path;
    try {path = realpathSync(resolve(root, file));}
    catch (error) {throw new Error(`Required test file is missing: ${file}`, {cause: error});}
    if (!statSync(path).isFile()) throw Error(`Required test file is not regular: ${file}`);
    return [path, patterns.map(pattern => ({pattern, expression: new RegExp(pattern), passed: 0}))];
  }));
  const selected = new Set();
  let fileSummarySeen = false, fileTests = 0, totalTests;
  return {
    observe({type, data}) {
      if (type === 'test:summary') {
        if (data.file) {fileSummarySeen = true; fileTests += data.counts?.tests;}
        else totalTests = data.counts?.tests;
      }
      if (!data.file) return;
      let path = resolve(data.file);
      // Generated tests may name virtual files outside the declared case inventory.
      if (!files.has(path)) {
        try {path = realpathSync(path);} catch {return;}
      }
      const cases = files.get(path);
      if (!cases) return;
      selected.add(cases);
      if (type === 'test:pass' && [data.skip, data.todo, data.expectFailure].every(value => value === undefined || value === false) && data.details?.type !== 'suite') {
        for (const item of cases) if (item.expression.test(data.name)) item.passed++;
      }
    },
    finish() {
      let count = 0;
      const failures = [];
      // A file wrapper can pass after selecting no real cases; use its file counts.
      const tests = fileSummarySeen ? fileTests : totalTests;
      if (!Number.isSafeInteger(tests) || tests < 1) failures.push('Required case did not pass exactly once: invocation selected no test cases');
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
