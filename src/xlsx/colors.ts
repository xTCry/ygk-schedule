import type { XlsxColor } from './types.ts';

const indexedColors = [
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'C0C0C0',
  '808080',
  '9999FF',
  '993366',
  'FFFFCC',
  'CCFFFF',
  '660066',
  'FF8080',
  '0066CC',
  'CCCCFF',
  '000080',
  'FF00FF',
  'FFFF00',
  '00FFFF',
  '800080',
  '800000',
  '008080',
  '0000FF',
  '00CCFF',
  'CCFFFF',
  'CCFFCC',
  'FFFF99',
  '99CCFF',
  'FF99CC',
  'CC99FF',
  'FFCC99',
  '3366FF',
  '33CCCC',
  '99CC00',
  'FFCC00',
  'FF9900',
  'FF6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333',
] as const;

const normalizeRgb = (value: string): string => {
  const clean = value.replace(/^#/, '').toUpperCase();
  return clean.length === 8 ? clean.slice(2) : clean.padStart(6, '0').slice(-6);
};

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = normalizeRgb(hex);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
};

const rgbToHex = ([r, g, b]: [number, number, number]): string =>
  [r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

const rgbToHsl = ([r0, g0, b0]: [number, number, number]): [
  number,
  number,
  number,
] => {
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return [(hue / 6) * 360, saturation, lightness];
};

const hueToRgb = (p: number, q: number, t0: number): number => {
  let t = t0;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
};

const hslToRgb = ([h0, s, l]: [number, number, number]): [
  number,
  number,
  number,
] => {
  const h = h0 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3) * 255,
    hueToRgb(p, q, h) * 255,
    hueToRgb(p, q, h - 1 / 3) * 255,
  ];
};

export const applyTint = (rgb: string, tint = 0): string => {
  if (!tint) return normalizeRgb(rgb);
  const hsl = rgbToHsl(hexToRgb(rgb));
  hsl[2] = tint < 0 ? hsl[2] * (1 + tint) : hsl[2] * (1 - tint) + tint;
  return rgbToHex(hslToRgb(hsl));
};

export const resolveColor = (
  color: XlsxColor,
  themeColors: string[],
): XlsxColor => {
  if (color.type === 'rgb' && color.rgb)
    return { ...color, resolvedRgb: normalizeRgb(color.rgb) };
  if (color.type === 'theme' && color.theme !== undefined) {
    const base = themeColors[color.theme];
    return base
      ? { ...color, resolvedRgb: applyTint(base, color.tint ?? 0) }
      : color;
  }
  if (color.type === 'indexed' && color.indexed !== undefined) {
    const rgb = indexedColors[color.indexed];
    return rgb ? { ...color, resolvedRgb: rgb } : color;
  }
  return color;
};

export const isRedLike = (rgb?: string): boolean => {
  if (!rgb) return false;
  const [r, g, b] = hexToRgb(rgb);
  const [h, s, l] = rgbToHsl([r, g, b]);
  const redHue = h <= 25 || h >= 335;
  return redHue && s >= 0.2 && l >= 0.2 && r >= g * 1.15 && r >= b * 1.15;
};
