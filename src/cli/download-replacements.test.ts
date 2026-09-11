import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  downloadReplacementPages,
  parseDownloadReplacementPagesArgs,
} from './download-replacements.ts';

describe('replacement page download CLI', () => {
  it('uses the local timetable directory and official URLs by default', () => {
    expect(parseDownloadReplacementPagesArgs([])).toMatchObject({
      outputDir: '.tmp/timetable',
      firstUrl: 'https://menu.sttec.yar.ru/timetable/rasp_first.html',
      secondUrl: 'https://menu.sttec.yar.ru/timetable/rasp_second.html',
    });
  });

  it('archives pages by Moscow download date and keeps stable local paths', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'ygk-replacements-html-'));
    let revision = 'first';
    vi.stubGlobal('fetch', (input: string | URL) => {
      const url = String(input);
      if (url === 'https://example.test/first')
        return Promise.resolve(new Response(`<html>first-${revision}</html>`));
      if (url === 'https://example.test/second')
        return Promise.resolve(new Response(`<html>second-${revision}</html>`));
      throw new Error(`Unexpected URL: ${url}`);
    });

    try {
      const options = {
        outputDir,
        firstUrl: 'https://example.test/first',
        secondUrl: 'https://example.test/second',
      };
      const first = await downloadReplacementPages(
        options,
        new Date('2026-09-11T10:15:16.000Z'),
      );
      const same = await downloadReplacementPages(
        options,
        new Date('2026-09-11T11:15:16.000Z'),
      );
      revision = 'second';
      const changed = await downloadReplacementPages(
        options,
        new Date('2026-09-11T11:20:21.000Z'),
      );

      expect(first.pages).toEqual([
        expect.objectContaining({
          shift: 'first',
          archivePath: join(outputDir, 'rasp_first-11.09.2026.html'),
          archiveChanged: true,
          latestPath: join(outputDir, 'rasp_first.html'),
          latestChanged: true,
        }),
        expect.objectContaining({
          shift: 'second',
          archivePath: join(outputDir, 'rasp_second-11.09.2026.html'),
          archiveChanged: true,
          latestPath: join(outputDir, 'rasp_second.html'),
          latestChanged: true,
        }),
      ]);
      expect(same.pages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            archiveChanged: false,
            latestChanged: false,
          }),
        ]),
      );
      expect(changed.pages).toEqual([
        expect.objectContaining({
          archivePath: join(outputDir, 'rasp_first-11.09.2026-14-20-21.html'),
          archiveChanged: true,
          latestChanged: true,
        }),
        expect.objectContaining({
          archivePath: join(outputDir, 'rasp_second-11.09.2026-14-20-21.html'),
          archiveChanged: true,
          latestChanged: true,
        }),
      ]);
      await expect(
        readFile(join(outputDir, 'rasp_first.html'), 'utf8'),
      ).resolves.toBe('<html>first-second</html>');
      await expect(
        readFile(join(outputDir, 'rasp_second.html'), 'utf8'),
      ).resolves.toBe('<html>second-second</html>');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
