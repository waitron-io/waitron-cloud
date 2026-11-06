export interface Oklch {
  L: number;
  C: number;
  /** Hue in radians. */
  H: number;
}

type Rgb = [number, number, number];

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const unlin = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** `lin` of each channel byte scaled as `hexToRgb` scales it, so a lookup gives the same number. */
const LIN = Array.from({ length: 256 }, (_, byte) => lin(byte / 255));

function bytes(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new RangeError(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export function hexToRgb(hex: string): Rgb {
  return bytes(hex).map((byte) => byte / 255) as Rgb;
}

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

const rgbToHex = (rgb: number[]) =>
  "#" + rgb.map((v) => HEX[Math.round(Math.min(1, Math.max(0, v)) * 255)]).join("");

export function toOklch(hex: string): Oklch {
  const [r, g, b] = bytes(hex).map((byte) => LIN[byte]!) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}

/** Linear sRGB, which may fall outside 0..1. */
function toLinearRgb(L: number, A: number, B: number): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function fromOklch({ L, C, H }: Oklch): string {
  const cos = Math.cos(H);
  const sin = Math.sin(H);
  let chroma = C;
  for (let i = 0; i < 60; i++) {
    const rgb = toLinearRgb(L, chroma * cos, chroma * sin);
    if (rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return rgbToHex(rgb.map(unlin));
    chroma *= 0.95;
  }
  return rgbToHex(toLinearRgb(L, 0, 0).map(unlin));
}

export function withLightness(hex: string, L: number): string {
  return fromOklch({ ...toOklch(hex), L });
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = bytes(hex);
  return 0.2126 * LIN[r]! + 0.7152 * LIN[g]! + 0.0722 * LIN[b]!;
}

/** The contrast ratio of two relative luminances, given in either order. */
export function luminanceRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function contrastRatio(a: string, b: string): number {
  return luminanceRatio(relativeLuminance(a), relativeLuminance(b));
}
