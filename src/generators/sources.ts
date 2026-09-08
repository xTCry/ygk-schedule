import { join, resolve } from 'node:path';
import { getGroupFileName } from './group-file-name.ts';
import { writeFileIfChangedAtomic } from '../utils/fs.ts';

export type RawSourceKind = 'replacements' | 'schedule';

/**
 * Возвращает относительный путь текущего raw-снимка источника в data-ветке.
 *
 * Git хранит предыдущие версии этого же пути по commit history, поэтому один
 * стабильный файл на источник позволяет открыть точный снимок по SHA commit.
 */
export const getRawSourceArtifactRelativePath = (
  kind: RawSourceKind,
  fileName: string,
): string => `sources/${kind}/${getGroupFileName(fileName)}`;

/**
 * Сохраняет raw HTML или XLSX по стабильному пути, только если изменились
 * байты. Старые версии остаются доступны через историю ветки data.
 */
export const writeRawSourceArtifact = (
  outputDirectory: string,
  kind: RawSourceKind,
  fileName: string,
  content: string | Buffer,
): Promise<boolean> =>
  writeFileIfChangedAtomic(
    join(
      resolve(outputDirectory),
      getRawSourceArtifactRelativePath(kind, fileName),
    ),
    content,
  );
