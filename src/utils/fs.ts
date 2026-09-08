import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const readJsonIfExists = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

/**
 * Проверяет наличие файла, не скрывая ошибки доступа к существующему пути.
 */
export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

export const writeFileAtomic = async (
  path: string,
  content: string | Buffer,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content);
  await rename(temporary, path);
};

/**
 * Атомарно обновляет файл только при фактическом изменении байтов.
 *
 * Это нужно для raw-источников: повторная загрузка одинакового HTML/XLSX не
 * должна создавать ложный Git diff только из-за времени запуска workflow.
 */
export const writeFileIfChangedAtomic = async (
  path: string,
  content: string | Buffer,
): Promise<boolean> => {
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
  try {
    const previous = await readFile(path);
    if (previous.equals(next)) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeFileAtomic(path, next);
  return true;
};
