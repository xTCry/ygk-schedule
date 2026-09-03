export interface XlsxColor {
  type: 'rgb' | 'theme' | 'indexed' | 'auto' | 'none';
  rgb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
  resolvedRgb?: string;
}

export interface XlsxFill {
  patternType?: string;
  foreground: XlsxColor;
}

export interface XlsxCell {
  address: string;
  row: number;
  column: number;
  value: string | number | boolean | null;
  fill?: XlsxFill;
}

export interface XlsxMerge {
  ref: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface XlsxRow {
  index: number;
  hidden: boolean;
}

export interface XlsxWorksheet {
  name: string;
  rows: Map<number, XlsxRow>;
  cells: Map<string, XlsxCell>;
  merges: XlsxMerge[];
}

export interface XlsxWorkbook {
  sheets: XlsxWorksheet[];
}
