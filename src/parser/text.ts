const dashPattern = /[‐‑‒–—―−]/g;

export const normalizeText = (value: unknown): string => {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean')
  ) {
    return '';
  }
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
};

export const normalizeSingleLine = (value: unknown): string =>
  normalizeText(value).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

export const normalizeDashes = (value: string): string =>
  value.replace(dashPattern, '-');
