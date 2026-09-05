import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeYaml } from '../generators/yaml.ts';
import {
  loadYgkCalendarConfig,
  type CalendarConfigDocument,
} from './config.ts';

const writeCalendarConfig = async (
  path: string,
  config: CalendarConfigDocument,
): Promise<void> => writeFile(path, serializeYaml(config));

describe('YGK calendar config', () => {
  it('loads profiles and room profile rules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.yaml');
    await writeCalendarConfig(path, {
      timezone: 'Europe/Moscow',
      term: {
        start: '2026-09-01',
        end: '2027-06-30',
        reference_date: '2026-09-07',
        reference_week_type: 'numerator',
      },
      profiles: {
        known: {
          lesson_times: {
            1: { start: '09:20', end: '10:50' },
          },
          lesson_times_by_day: {
            Суббота: { 1: null },
          },
        },
      },
      room_profiles: {
        buildings: {
          А: { profile: 'known' },
        },
        special_rooms: {
          ДОТ: 'remote',
        },
      },
    } satisfies CalendarConfigDocument);

    await expect(loadYgkCalendarConfig(path)).resolves.toMatchObject({
      profiles: {
        known: {
          lessonTimesByDay: {
            Суббота: { 1: null },
          },
        },
      },
      roomProfiles: {
        buildings: {
          А: {
            profile: 'known',
            courseProfiles: {},
            groupOverrides: {},
          },
        },
        specialRooms: { ДОТ: 'remote' },
      },
    });
  });

  it('rejects an invalid time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.yaml');
    await writeCalendarConfig(path, {
      timezone: 'Europe/Moscow',
      term: {
        start: '2026-09-01',
        end: '2027-06-30',
        reference_date: '2026-09-07',
        reference_week_type: 'numerator',
      },
      profiles: {
        known: {
          lesson_times: {
            1: { start: '10:50', end: '09:20' },
          },
        },
      },
      room_profiles: { buildings: { А: { profile: 'known' } } },
    } satisfies CalendarConfigDocument);

    await expect(loadYgkCalendarConfig(path)).rejects.toThrow(
      /end after start/,
    );
  });

  it('rejects a room rule pointing to an unknown profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.yaml');
    await writeCalendarConfig(path, {
      timezone: 'Europe/Moscow',
      term: {
        start: '2026-09-01',
        end: '2027-06-30',
        reference_date: '2026-09-07',
        reference_week_type: 'numerator',
      },
      profiles: {
        known: {
          lesson_times: {
            1: { start: '09:20', end: '10:50' },
          },
        },
      },
      room_profiles: { buildings: { А: { profile: 'missing' } } },
    } satisfies CalendarConfigDocument);

    await expect(loadYgkCalendarConfig(path)).rejects.toThrow(
      /profile "missing".*was not found/,
    );
  });

  it('derives the checked profiles from the tracked bell schedule', async () => {
    const config = await loadYgkCalendarConfig();

    expect(config.roomProfiles.buildings.Ф?.groupOverrides['ЮР1-11']).toBe(
      'f-year-1',
    );
    expect(config.roomProfiles.buildings.Т?.courseProfiles[2]).toBe(
      't-years-2-4',
    );
    expect(config.profiles['a-m']?.lessonTimes[2]).toEqual([
      { start: '11:00', end: '11:45' },
      { start: '12:25', end: '13:10' },
    ]);
    expect(config.profiles['f-years-2-4']?.lessonTimesByDay.Суббота?.[0]).toBe(
      null,
    );
    expect(config.publication).toMatchObject({
      sourceUrlTemplate:
        'https://raw.githubusercontent.com/xTCry/ygk-schedule/data/ical/{kind}/{group}.ics',
      refreshInterval: 'PT2H',
    });
    expect(config.term).toMatchObject({
      start: '2026-09-01',
      end: '2026-12-31',
    });
  });
});
