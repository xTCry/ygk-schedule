import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYgkCalendarConfig } from './config.ts';

describe('YGK calendar config', () => {
  it('loads profiles and explicit group bindings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.json');
    await writeFile(
      path,
      JSON.stringify({
        timezone: 'Europe/Moscow',
        term: {
          start: '2026-09-01',
          end: '2027-06-30',
          referenceDate: '2026-09-07',
          referenceWeekType: 'numerator',
        },
        profiles: {
          known: {
            lessonTimes: {
              1: { start: '09:20', end: '10:50' },
            },
            lessonTimesByDay: {
              Суббота: { 1: null },
            },
          },
        },
        groupProfiles: { 'СТ1-11': 'known' },
      }),
    );

    await expect(loadYgkCalendarConfig(path)).resolves.toMatchObject({
      profiles: {
        known: {
          lessonTimesByDay: {
            Суббота: { 1: null },
          },
        },
      },
      groupProfiles: { 'СТ1-11': 'known' },
    });
  });

  it('rejects an invalid time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.json');
    await writeFile(
      path,
      JSON.stringify({
        timezone: 'Europe/Moscow',
        term: {
          start: '2026-09-01',
          end: '2027-06-30',
          referenceDate: '2026-09-07',
          referenceWeekType: 'numerator',
        },
        profiles: {
          known: {
            lessonTimes: {
              1: { start: '10:50', end: '09:20' },
            },
          },
        },
        groupProfiles: { 'СТ1-11': 'known' },
      }),
    );

    await expect(loadYgkCalendarConfig(path)).rejects.toThrow(
      /end after start/,
    );
  });

  it('rejects a binding to an unknown profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.json');
    await writeFile(
      path,
      JSON.stringify({
        timezone: 'Europe/Moscow',
        term: {
          start: '2026-09-01',
          end: '2027-06-30',
          referenceDate: '2026-09-07',
          referenceWeekType: 'numerator',
        },
        profiles: {
          known: {
            lessonTimes: {
              1: { start: '09:20', end: '10:50' },
            },
          },
        },
        groupProfiles: { 'СТ1-11': 'missing' },
      }),
    );

    await expect(loadYgkCalendarConfig(path)).rejects.toThrow(
      /profile "missing".*was not found/,
    );
  });
});
