const need = value => { if (!value) throw Error('Invalid cloud cost storage lifetimes'); };

// Only bounded deletion control XML is retained privately; object bodies are never buffered here.
export function deletionXml(body, rootName) {
  need(Buffer.isBuffer(body) && body.length > 0 && body.length <= 1048576);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(body)
    .replace(/^\s*<\?xml version="1\.0"(?: encoding="UTF-8")?\?>/, '');
  need(!/[\ufffe\uffff]/.test(source));
  const stack = [], roots = [];
  const tokens = /<[^>]*>|[^<]+/gy;
  let offset = 0, nodes = 0;
  while (offset < source.length) {
    const match = tokens.exec(source); need(match && match.index === offset); offset = tokens.lastIndex;
    const part = match[0];
    if (!part.startsWith('<')) {
      if (stack.length) stack.at(-1).value += part;
      else need(part.trim() === '');
    } else if (part.startsWith('</')) {
      need(stack.length > 0 && part === `</${stack.at(-1).name}>`); stack.pop();
    } else {
      const tag = /^<([A-Za-z]+)(?: xmlns="http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/")?(\/?)>$/.exec(part);
      need(tag && (stack.length === 0 || !part.includes('xmlns')) && stack.length < 3 && ++nodes <= 10002);
      const node = { name: tag[1], children: [], value: '' };
      (stack.length ? stack.at(-1).children : roots).push(node);
      if (!tag[2]) stack.push(node);
    }
  }
  need(stack.length === 0 && roots.length === 1 && roots[0].name === rootName && roots[0].value.trim() === '');
  return roots[0].children;
}
export function deletionFields(node, allowed) {
  need(node.value.trim() === ''); const result = {};
  for (const child of node.children) {
    need(allowed.includes(child.name) && !Object.hasOwn(result, child.name) && child.children.length === 0);
    result[child.name] = child.value.replace(/&([^;]*);|&/g, (raw, entity) => {
      const named = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
      if (Object.hasOwn(named, entity)) return named[entity];
      need(typeof entity === 'string' && /^(?:#[0-9]+|#x[0-9a-fA-F]+)$/.test(entity));
      const n = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      need(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && n !== 0xfffe && n !== 0xffff);
      return String.fromCodePoint(n);
    });
  }
  return result;
}
