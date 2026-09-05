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
        first: { start: '09-01', end: '12-31' },
        second: { start: '01-12', end: '06-30' },
        fallback_week_anchor: {
          date: '2026-09-07',
          week_type: 'numerator',
        },
        group_ranges: {
          'СТ1-11': {
            first: { start: '09-01', end: '12-20' },
          },
        },
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
          Спортзал: {
            kind: 'sport',
            profile: 'known',
            aliases: ['Сп.зал'],
          },
        },
      },
    } satisfies CalendarConfigDocument);

    await expect(
      loadYgkCalendarConfig(path, new Date('2026-09-05T12:00:00Z')),
    ).resolves.toMatchObject({
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
        specialRooms: {
          ДОТ: { kind: 'remote' },
          'СП.ЗАЛ': { kind: 'sport', profile: 'known' },
        },
      },
      term: {
        semester: 'first',
        start: '2026-09-01',
        end: '2026-12-31',
        weekAnchor: {
          date: '2026-09-07',
          weekType: 'numerator',
        },
        groupRanges: {
          'СТ1-11': { start: '2026-09-01', end: '2026-12-20' },
        },
      },
    });
  });

  it('rejects an invalid time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.yaml');
    await writeCalendarConfig(path, {
      timezone: 'Europe/Moscow',
      term: {
        first: { start: '09-01', end: '12-31' },
        second: { start: '01-12', end: '06-30' },
        fallback_week_anchor: {
          date: '2026-09-07',
          week_type: 'numerator',
        },
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
        first: { start: '09-01', end: '12-31' },
        second: { start: '01-12', end: '06-30' },
        fallback_week_anchor: {
          date: '2026-09-07',
          week_type: 'numerator',
        },
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
    const config = await loadYgkCalendarConfig(
      undefined,
      new Date('2026-09-05T12:00:00Z'),
    );

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
    expect(config.roomProfiles.specialRooms['СПОРТ.ЗАЛ']).toEqual({
      kind: 'sport',
      profile: 'a-m',
    });
    expect(config.term).toMatchObject({
      semester: 'first',
      start: '2026-09-01',
      end: '2026-12-31',
      groupRanges: {},
    });
  });

  it('rejects a term boundary with a year', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.yaml');
    await writeCalendarConfig(path, {
      timezone: 'Europe/Moscow',
      term: {
        first: { start: '2026-09-01', end: '12-31' },
        second: { start: '01-12', end: '06-30' },
        fallback_week_anchor: {
          date: '2026-09-07',
          week_type: 'numerator',
        },
      },
      profiles: {
        known: {
          lesson_times: {
            1: { start: '09:20', end: '10:50' },
          },
        },
      },
      room_profiles: { buildings: { А: { profile: 'known' } } },
    } satisfies CalendarConfigDocument);

    await expect(loadYgkCalendarConfig(path)).rejects.toThrow(
      /requires MM-DD at term.first.start/,
    );
  });

  it('derives both spring term boundaries from the reference year', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ygk-calendar-config-'));
    const path = join(directory, 'calendar.yaml');
    await writeCalendarConfig(path, {
      timezone: 'Europe/Moscow',
      term: {
        first: { start: '09-01', end: '12-31' },
        second: { start: '01-12', end: '06-30' },
        fallback_week_anchor: {
          date: '2027-01-18',
          week_type: 'denominator',
        },
      },
      profiles: {
        known: {
          lesson_times: {
            1: { start: '09:20', end: '10:50' },
          },
        },
      },
      room_profiles: { buildings: { А: { profile: 'known' } } },
    } satisfies CalendarConfigDocument);

    await expect(
      loadYgkCalendarConfig(path, new Date('2027-01-18T12:00:00Z')),
    ).resolves.toMatchObject({
      term: {
        semester: 'second',
        start: '2027-01-12',
        end: '2027-06-30',
        weekAnchor: {
          date: '2027-01-18',
          weekType: 'denominator',
        },
      },
    });
  });
});
