import assert from 'node:assert/strict';

// Only the expression forms exercised by these workflow gates are admitted.
export function evaluateExpression(source, context) {
  source = source.replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim();
  const tokens = source.match(/'[^']*'|&&|\|\||==|!=|[!(),]|[A-Za-z_][A-Za-z0-9_.-]*/g) ?? [];
  assert.equal(tokens.join(''), source.replace(/\s+(?=(?:[^']*'[^']*')*[^']*$)/g, ''), `Unsupported expression: ${source}`);
  let at = 0;
  const primary = () => {
    const token = tokens[at++]; assert.ok(token, 'Missing expression operand');
    if (token === '!') return !primary();
    if (token === '(') {const value = or(); assert.equal(tokens[at++], ')'); return value;}
    if (token.startsWith("'")) return token.slice(1, -1);
    if (token === 'true' || token === 'false') return token === 'true';
    if (tokens[at] === '(') {
      assert.ok(['always', 'toJSON', 'contains', 'fromJSON'].includes(token), `Unsupported function ${token}`);
      at++; const args = [];
      if (tokens[at] !== ')') {args.push(or()); while (tokens[at] === ',') {at++; args.push(or());}}
      assert.equal(tokens[at++], ')');
      if (token === 'always') {assert.equal(args.length, 0); return true;}
      if (token === 'toJSON') {assert.equal(args.length, 1); return JSON.stringify(args[0]);}
      if (token === 'fromJSON') {assert.equal(args.length, 1); return JSON.parse(args[0]);}
      assert.equal(args.length, 2); return args[0].includes(args[1]);
    }
    assert.match(token, /^(needs|steps|inputs|github)(\.[A-Za-z0-9_-]+)*$/, `Unsupported identifier ${token}`);
    return token.split('.').reduce((value, key) => value?.[key], context) ?? '';
  };
  const compare = () => {let left = primary(); if (['==', '!='].includes(tokens[at])) {const op = tokens[at++], right = primary(); left = op === '==' ? left === right : left !== right;} return left;};
  const and = () => {let left = compare(); while (tokens[at] === '&&') {at++; const right = compare(); left = left && right;} return left;};
  const or = () => {let left = and(); while (tokens[at] === '||') {at++; const right = and(); left = left || right;} return left;};
  const value = or(); assert.equal(at, tokens.length, 'Unconsumed expression syntax'); return value;
}
export function condition(source, context, success = true) {
  if (!source) return success;
  return (source.includes('always()') || success) && Boolean(evaluateExpression(source, context));
}
