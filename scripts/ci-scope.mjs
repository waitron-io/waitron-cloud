import {groupShortPackages} from './ci-package-groups.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, realpathSync} from 'node:fs';
import {dirname, join, posix, relative, resolve} from 'node:path';

export function* quotedReferences(source) {
  // Generated fixture programs contain nested quoted paths. The broad scan keeps
  // those readers while the matching-delimiter scan also handles mixed quotes.
  for (const match of source.matchAll(/['"`]([^'"`\n]+)['"`]/g)) yield match[1];
  for (const match of source.matchAll(/(['"`])((?:\\[^\n]|(?!\1)[^\\\n])+)\1/g)) yield match[2];
}

export function sourceDependencies(pkg, packages, sources, root = process.cwd()) {
  const dependencies = new Set();
  for (const {path, source} of sources) {
    for (const value of quotedReferences(source)) {
      const prefix=value.split('${')[0];
      const relativePath=prefix.startsWith('./') || prefix.startsWith('../');
      const target=relativePath ? relative(root,resolve(root,dirname(path),prefix)) : posix.normalize(prefix);
      const owner=packages.find(other=>target===other.directory || target.startsWith(`${other.directory}/`) || prefix===other.name || prefix.startsWith(`${other.name}/`));
      if (owner && owner.name!==pkg.name) dependencies.add(owner.name);
      else if ((relativePath || /^(?:packages|apps)\//.test(prefix)) && value.includes('${') && !target.startsWith(`${pkg.directory}/`)) {
        for (const other of packages) dependencies.add(other.name);
      }
    }
  }
  return Object.fromEntries([...dependencies].map(name=>[name,'file']));
}

export function loadWorkspace(root = process.cwd()) {
  root=realpathSync(root);
  const members = JSON.parse(execFileSync('pnpm', ['ls','-r','--depth','-1','--json'], {cwd:root, encoding:'utf8'}));
  if (!Array.isArray(members) || members.length < 2) throw new Error('Workspace discovery selected no packages');
  const packages = members.filter(member => resolve(member.path) !== resolve(root)).map(member => ({
    ...JSON.parse(readFileSync(`${member.path}/package.json`, 'utf8')),
    directory:relative(root,member.path),
  }));
  if (!packages.length || new Set(packages.map(pkg=>pkg.name)).size !== packages.length) throw new Error('Invalid workspace members');
  // Tests may import sibling source and fixtures directly rather than through manifests.
  // Include those file consumers so a scoped PR cannot hide a broken sibling fixture.
  for (const pkg of packages) {
    const sources = [];
    const visit = directory => {
      for (const entry of readdirSync(directory,{withFileTypes:true})) {
        const file=join(directory,entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules','dist','.git','coverage'].includes(entry.name)) visit(file);
        } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
          sources.push({path:relative(root,file), source:readFileSync(file,'utf8')});
        }
      }
    };
    visit(join(root,pkg.directory));
    pkg.pathDependencies=sourceDependencies(pkg,packages,sources,root);
    pkg.sources = sources;
  }
  return packages;
}

function readsTestPath(pkg, path, workspace) {
  const values = value => typeof value === 'string' ? [value] :
    value && typeof value === 'object' ? Object.values(value).flatMap(values) : [];
  const matches = (target, uncertain = false) => {
    target = posix.normalize(target).replace(/\/$/, '');
    return path === target || (uncertain && (target === '.' || path.startsWith(target))) ||
      [target.replace(/\.js$/, '.ts'), target.replace(/\.mjs$/, '.mts'), target.replace(/\.cjs$/, '.cts'), target.replace(/\.jsx?$/, '.tsx'),
        ...['.mjs', '.cjs', '.js', '.ts', '.mts', '.cts', '.tsx', '.jsx'].flatMap(ext => [target + ext, posix.join(target, 'index' + ext)])].includes(path);
  };
  for (const {path: sourcePath, source, references = []} of pkg.sources) {
    const directoryInputs = new Set([...source.matchAll(/\b(?:readdirSync|readdir|opendirSync|opendir|globSync|glob)\s*\(\s*(?:new\s+URL\s*\(\s*)?(['"`])([^'"`\n]+)\1/g)].map(match => match[2]));
    for (const value of [...quotedReferences(source), ...references]) {
      const prefix = value.split('${')[0];
      if (!prefix) continue;
      const named = workspace.find(other => prefix === other.name || prefix.startsWith(`${other.name}/`));
      if (named) {
        const exports = values(named.exports ?? named.main ?? './index.js');
        if (exports.some(entry => matches(posix.join(named.directory, entry.split('*')[0]), entry.includes('*')))) return true;
        if (prefix !== named.name && matches(posix.join(named.directory, prefix.slice(named.name.length + 1)), value.includes('${'))) return true;
      } else if ((prefix.startsWith('./') || prefix.startsWith('../') || prefix === '.' || prefix === '..' || /^(?:packages|apps)(?:\/|$)/.test(prefix)) &&
        matches(prefix.startsWith('.') ? posix.join(posix.dirname(sourcePath), prefix) : prefix,
          value.includes('${') || directoryInputs.has(value))) return true;
    }
  }
  return false;
}

export function scopeForPaths(paths, workspace, {direct = false} = {}) {
  const all = workspace.map(pkg=>pkg.name).sort();
  const full = () => ({full:true, packages:all});
  if (!paths.length || paths.some(path => !path)) return full();
  const selected = new Set();
  const changed = new Map();
  for (const path of paths) {
    const owner = workspace.find(pkg=>path.startsWith(`${pkg.directory}/`));
    if (!owner) return full();
    selected.add(owner.name);
    if (!changed.has(owner.name)) changed.set(owner.name, []);
    changed.get(owner.name).push(path);
  }
  if (direct) {
    // Only diff owners seed the next level. A consumer selected here must not
    // become another seed, even when workspace order or dependency cycles vary.
    for (const pkg of workspace) {
      const dependencies = {...pkg.pathDependencies, ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies};
      for (const [name, inputs] of changed) {
        const owner = workspace.find(other => other.name === name);
        const ownTests = inputs.every(path => path.startsWith(`${owner.directory}/test/`));
        const consumes = ownTests && Array.isArray(pkg.sources)
          ? inputs.some(path => readsTestPath(pkg, path, workspace)) : Object.hasOwn(dependencies, name);
        if (consumes) {
          selected.add(pkg.name);
        }
      }
    }
    return {full: false, packages: [...selected].sort()};
  }
  let previous;
  do {
    previous = selected.size;
    for (const pkg of workspace) {
      const dependencies = {...pkg.pathDependencies, ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies};
      if (Object.keys(dependencies).some(name=>selected.has(name))) selected.add(pkg.name);
    }
  } while (previous !== selected.size);
  return {full:false, packages:[...selected].sort()};
}

export const receiptSuites = ['test:two-venue-milestone-receipt','test:backup-capacity','test:public-gateway-limits','test:local-stack','test:database-recovery-receipt','test:cloud-cost'];
const shards = {'@waitron-cloud/registration':6, '@waitron-cloud/account-http':3, '@waitron-cloud/backups':7, '@waitron-cloud/portal':6, '@waitron-cloud/remote-access':4};
export function workPlan(scope, workspace, root = process.cwd()) {
  const packages = [];
  for (const name of scope.packages) {
    const pkg = workspace.find(pkg=>pkg.name === name);
    if (!pkg?.scripts?.test) throw new Error(`Selected package ${name} declares no tests`);
    const count = shards[name];
    if (count) {
      const files = readdirSync(`${root}/${pkg.directory}/test`).filter(file=>file.endsWith('.test.ts'));
      if (files.length < count) throw new Error(`${name} has an empty test shard`);
      for (let shard = 1; shard <= count; shard++) packages.push({package:name,shard,shards:count});
    } else packages.push({package:name,shard:1});
  }
  if (!packages.length) throw new Error('Scope selected no tests');
  // The baseline covers unbounded backend and deployment inputs. The PR planner
  // may omit a receipt only with unchanged audited inputs in both revisions.
  const backend = scope.packages.some(name=>workspace.find(pkg=>pkg.name===name).directory.startsWith('packages/') && name !== '@waitron-cloud/ui-smoke');
  return {packages:groupShortPackages(packages), receipts:scope.full || backend ? receiptSuites : scope.packages.includes('@waitron-cloud/portal') ? ['test:local-stack'] : [], typecheck:true};
}
