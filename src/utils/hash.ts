import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

const walk = async (root: string, current = ''): Promise<string[]> => {
  const absolute = resolve(root, current);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(root, relative)));
    if (entry.isFile()) files.push(relative);
  }

  return files;
};

export const hashPath = async (path: string): Promise<string> => {
  try {
    const info = await stat(path);
    if (info.isFile()) return sha256(await readFile(path));
    if (!info.isDirectory()) return sha256('');
  } catch {
    return sha256('');
  }

  const hash = createHash('sha256');
  for (const file of await walk(path)) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(resolve(path, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
};

export const hashDirectory = hashPath;

export const hashPaths = async (paths: string[]): Promise<string> => {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    hash.update(basename(path));
    hash.update('\0');
    hash.update(await hashPath(path));
    hash.update('\0');
  }
  return hash.digest('hex');
};
