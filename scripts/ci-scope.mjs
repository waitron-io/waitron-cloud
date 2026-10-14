import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {relative, resolve} from 'node:path';

export function loadWorkspace(root = process.cwd()) {
  const members = JSON.parse(execFileSync('pnpm', ['ls','-r','--depth','-1','--json'], {cwd:root, encoding:'utf8'}));
  if (!Array.isArray(members) || members.length < 2) throw new Error('Workspace discovery selected no packages');
  const packages = members.filter(member => resolve(member.path) !== resolve(root)).map(member => ({
    ...JSON.parse(readFileSync(`${member.path}/package.json`, 'utf8')),
    directory:relative(root,member.path),
  }));
  if (!packages.length || new Set(packages.map(pkg=>pkg.name)).size !== packages.length) throw new Error('Invalid workspace members');
  return packages;
}

export function scopeForPaths(paths, workspace) {
  const all = workspace.map(pkg=>pkg.name).sort();
  const full = () => ({full:true, packages:all});
  if (!paths.length || paths.some(path => !path)) return full();
  const selected = new Set();
  for (const path of paths) {
    const owner = workspace.find(pkg=>path.startsWith(`${pkg.directory}/`));
    if (!owner) return full();
    selected.add(owner.name);
  }
  let previous;
  do {
    previous = selected.size;
    for (const pkg of workspace) {
      const dependencies = {...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies};
      if (Object.keys(dependencies).some(name=>selected.has(name))) selected.add(pkg.name);
    }
  } while (previous !== selected.size);
  return {full:false, packages:[...selected].sort()};
}

export const receiptSuites = ['test:two-venue-milestone-receipt','test:backup-capacity','test:public-gateway-limits','test:local-stack','test:database-recovery-receipt'];
const shards = {'@waitron-cloud/registration':7, '@waitron-cloud/account-http':3, '@waitron-cloud/backups':2, '@waitron-cloud/portal':3};
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
  // Receipt fixtures import backend packages and deployment helpers. Any backend change
  // runs all receipts, including ones whose inputs are assembled dynamically.
  const backend = scope.packages.some(name=>workspace.find(pkg=>pkg.name===name).directory.startsWith('packages/') && name !== '@waitron-cloud/ui-smoke');
  return {packages, receipts:scope.full || backend ? receiptSuites : scope.packages.includes('@waitron-cloud/portal') ? ['test:local-stack'] : [], typecheck:true};
}
