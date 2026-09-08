import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getRawSourceArtifactRelativePath,
  writeRawSourceArtifact,
} from './sources.ts';

describe('raw source artifacts', () => {
  it('keeps a stable path and writes only changed source bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-source-artifacts-'));

    expect(
      getRawSourceArtifactRelativePath('replacements', 'rasp_first.html'),
    ).toBe('sources/replacements/rasp_first.html');

    await expect(
      writeRawSourceArtifact(
        root,
        'replacements',
        'rasp_first.html',
        '<html>first</html>',
      ),
    ).resolves.toBe(true);
    await expect(
      writeRawSourceArtifact(
        root,
        'replacements',
        'rasp_first.html',
        '<html>first</html>',
      ),
    ).resolves.toBe(false);
    await expect(
      writeRawSourceArtifact(
        root,
        'replacements',
        'rasp_first.html',
        '<html>second</html>',
      ),
    ).resolves.toBe(true);

    await expect(
      readFile(
        join(root, 'sources', 'replacements', 'rasp_first.html'),
        'utf8',
      ),
    ).resolves.toBe('<html>second</html>');
  });
});
