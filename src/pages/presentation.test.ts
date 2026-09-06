import { describe, expect, it } from 'vitest';
import type { YgkCalendarConfig } from '../calendar/config.ts';
import type { GroupScheduleArtifact } from '../types.ts';
import { presentGroupScheduleArtifact } from './presentation.ts';

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
  },
  roomProfiles: {
    buildings: {
      А: { profile: 'a-m', courseProfiles: {}, groupOverrides: {} },
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
});
