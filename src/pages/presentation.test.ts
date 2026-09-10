import { describe, expect, it } from 'vitest';
import type { YgkCalendarConfig } from '../calendar/config.ts';
import type {
  ActualGroupScheduleArtifact,
  GroupScheduleArtifact,
} from '../types.ts';
import {
  presentActualGroupScheduleArtifact,
  presentGroupScheduleArtifact,
} from './presentation.ts';

const config: YgkCalendarConfig = {
  timezone: 'Europe/Moscow',
  term: {
    semester: 'first',
    start: '2026-09-01',
    end: '2026-12-31',
    weekAnchor: { date: '2026-09-07', weekType: 'numerator' },
    groupRanges: {},
  },
  profiles: {
    'a-m': {
      lessonTimes: {
        1: { start: '09:20', end: '10:50' },
        2: { start: '11:00', end: '11:45' },
      },
      lessonTimesByDay: {},
    },
    'b-v': {
      lessonTimes: {
        2: { start: '11:00', end: '12:30' },
      },
      lessonTimesByDay: {},
    },
  },
  roomProfiles: {
    buildings: {
      А: { profile: 'a-m', courseProfiles: {}, groupOverrides: {} },
      Б: { profile: 'b-v', courseProfiles: {}, groupOverrides: {} },
    },
    specialRooms: {},
  },
};

const artifact: GroupScheduleArtifact = {
  schemaVersion: 1,
  provider: 'ygk',
  group: {
    group: 'СТ1-11',
    sourceGroups: ['СТ1-11'],
    sourceBlocks: [],
    days: [
      {
        day: 'Понедельник',
        lessons: [
          {
            number: 1,
            source: {
              sheet: 'Лист',
              rowStart: 1,
              rowEnd: 1,
              rawGroupName: 'СТ1-11',
            },
            variants: [
              {
                subject: 'Математика',
                teacher: 'Преподаватель',
                room: 'А 101',
                weekType: 'both',
                sourceRow: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  diagnostics: [],
  semanticHash: 'semantic',
};

describe('Pages presentation', () => {
  it('reuses the calendar room resolver for lesson time and following break', () => {
    const result = presentGroupScheduleArtifact(artifact, config);
    expect(result.group.days[0]?.lessons[0]?.variants[0]?.timing).toEqual({
      profile: 'a-m',
      slots: [{ start: '09:20', end: '10:50' }],
      breakAfterMinutes: 10,
    });
  });

  it('keeps the original room time for a room-only actual replacement', () => {
    const base: GroupScheduleArtifact = {
      ...artifact,
      group: {
        ...artifact.group,
        days: [
          {
            day: 'Понедельник',
            lessons: [
              {
                ...artifact.group.days[0]!.lessons[0]!,
                number: 2,
                variants: [
                  {
                    subject: 'МДК.06.01',
                    teacher: 'Преподаватель',
                    room: 'Б406',
                    weekType: 'denominator',
                    subgroup: '2',
                    sourceRow: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const actual: ActualGroupScheduleArtifact = {
      schemaVersion: 1,
      provider: 'ygk',
      group: 'СТ1-11',
      diagnostics: [],
      semanticHash: 'actual',
      dates: {
        '2026-09-11': {
          date: '2026-09-11',
          day: 'Понедельник',
          weekType: 'denominator',
          groups: {
            'СТ1-11': {
              group: 'СТ1-11',
              date: '2026-09-11',
              day: 'Понедельник',
              lessons: [
                {
                  number: 2,
                  source: null,
                  status: 'scheduled',
                  replacements: [
                    {
                      lessonNumber: 2,
                      strategy: 'scheduled-room',
                      replacement: {
                        date: '2026-09-11',
                        group: 'СТ1-11',
                        lessonNumbers: [2],
                        type: 'replace',
                        original: null,
                        replacement: { raw: 'по расписанию', room: 'ДОТ' },
                        source: {
                          shift: 'first',
                          row: 1,
                          rawGroupName: 'СТ1-11',
                          rawLessonNumbers: '2',
                          rawOriginal: '',
                          rawReplacement: 'по расписанию',
                          rawRoom: 'ДОТ',
                        },
                      },
                    },
                  ],
                  variants: [
                    {
                      subject: 'МДК.06.01',
                      teacher: 'Преподаватель',
                      room: 'ДОТ',
                      weekType: 'denominator',
                      subgroup: '2',
                      sourceRow: 1,
                    },
                  ],
                },
              ],
              unresolvedReplacements: [],
            },
          },
        },
      },
    };

    expect(
      presentActualGroupScheduleArtifact(actual, base, config).dates[
        '2026-09-11'
      ]!.groups['СТ1-11']!.lessons[0]!.variants[0]!.timing,
    ).toMatchObject({
      profile: 'b-v',
      slots: [{ start: '11:00', end: '12:30' }],
    });
  });
});
