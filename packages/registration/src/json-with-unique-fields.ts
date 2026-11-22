export function parseJsonWithUniqueFields(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  const refuse = (): never => { throw new SyntaxError('Invalid JSON object'); };
  // Shape checks would only see the last value of a repeated field.
  const scopes: (Set<string>|null)[] = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g;
  for (const token of value.matchAll(tokens)) {
    const text = token[0];
    if (text === '{' || text === '[') {
      scopes.push(text === '{' ? new Set() : null);
      if (scopes.length > 32) refuse();
    } else if (text === '}' || text === ']') {
      scopes.pop();
    } else if (/^\s*:/.test(value.slice(token.index + text.length))) {
      const keys = scopes.at(-1);
      const key = JSON.parse(text) as string;
      if (!keys || keys.has(key)) return refuse();
      keys.add(key);
    }
  }
  return parsed;
}
