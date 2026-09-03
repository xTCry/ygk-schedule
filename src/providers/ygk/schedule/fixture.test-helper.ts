import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const fixturePath = fileURLToPath(
  new URL('./fixtures/2026-09-so.xlsx', import.meta.url),
);
export const readFixture = () => readFile(fixturePath);
