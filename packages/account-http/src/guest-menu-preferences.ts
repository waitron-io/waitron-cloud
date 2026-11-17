// Range/q grammar follows Waitron's apps/server/src/accept-language.ts; the plan records the adopted release.
export function parseAcceptLanguage(
  header: string | undefined,
): { range: string; weight: number; index: number }[] {
  return (header ?? "")
    .split(",")
    .flatMap((entry, index) => {
      const match =
        /^([a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/i.exec(
          entry.trim(),
        );
      if (!match) return [];
      return [{ range: match[1]!.toLowerCase(), weight: Number(match[2] ?? 1), index }];
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
}

export function guestMenuPreferences(header:string|undefined):string[]{
 return parseAcceptLanguage(header).filter(({range,weight})=>weight>0&&range!=='*').map(({range})=>range);
}
