import colors from "./colors.css?inline";
import structure from "./structure.css?inline";

let sheet: CSSStyleSheet | undefined;

function tokenSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(`${colors}\n${structure}`);
  }
  return sheet;
}

/**
 * Marks `root` as a theme root and makes the token layer available to it
 * and everything beneath it. Call once per app host.
 */
export function applyTokens(root: HTMLElement): void {
  root.setAttribute("data-wt-theme-root", "");
  const doc = root.getRootNode() as Document | ShadowRoot;
  const target = "adoptedStyleSheets" in doc ? doc : document;
  if (!target.adoptedStyleSheets.includes(tokenSheet())) {
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, tokenSheet()];
  }
}
