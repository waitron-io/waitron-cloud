// Match Waitron's apps/server/src/accept-language.ts so both readers rank the same header entries.
export function parseAcceptLanguage(
  header: string | undefined,
): { range: string; weight: number; index: number }[] {
  const kept = new Map<string, { range: string; weight: number; index: number }>();
  for (const [index, entry] of (header ?? "").split(",", 32).entries()) {
    const match =
      /^([a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/i.exec(
        entry.trim(),
      );
    if (!match) continue;
    const range = match[1]!.toLowerCase();
    const weight = Number(match[2] ?? 1);
    if ((kept.get(range)?.weight ?? -1) < weight) kept.set(range, { range, weight, index });
  }
  return [...kept.values()].sort((a, b) => b.weight - a.weight || a.index - b.index);
}

export function guestMenuPreferences(header:string|undefined):string[]{
 return parseAcceptLanguage(header).filter(({range,weight})=>weight>0&&range!=='*').map(({range})=>range);
}
