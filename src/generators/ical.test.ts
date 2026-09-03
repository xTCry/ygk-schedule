import { describe, expect, it } from 'vitest';
import { generateIcal } from './ical.ts';
import { serializeSchedule } from './json.ts';
import type {
  CanonicalSchedule,
  ScheduleSource,
  ScheduleVersion,
} from '../types.ts';

const source: ScheduleSource = {
  id: 'test.xlsx',
  fileName: 'test.xlsx',
  sha256: 'source',
};
const version: ScheduleVersion = {
  schemaVersion: 2,
  sourceSetHash: 'source',
  parserHash: 'parser',
  configHash: 'config',
  value: 'version',
};

const makeSchedule = (): CanonicalSchedule => ({
  schemaVersion: 2,
  provider: 'ygk',
  generatedAt: '2026-09-02T00:00:00.000Z',
  sources: [source],
  version,
  semanticHash: 'semantic',
  diagnostics: [],
  groups: {
    'СТ1-11': {
      group: 'СТ1-11',
      sourceGroups: ['СТ1-11'],
      sourceBlocks: [
        { sheet: 'Лист', rowStart: 1, rowEnd: 20, rawGroupName: 'СТ1-11' },
      ],
      days: [
        {
          day: 'Понедельник',
          lessons: [
            {
              number: 1,
              source: {
                sheet: 'Лист',
                rowStart: 3,
                rowEnd: 4,
                rawGroupName: 'СТ1-11',
              },
              variants: [
                {
                  subject: 'Общий, предмет',
                  teacher: 'Иванов И.И.',
                  room: '101;A',
                  weekType: 'both',
                  sourceRow: 3,
                },
              ],
            },
            {
              number: 2,
              source: {
                sheet: 'Лист',
                rowStart: 5,
                rowEnd: 6,
                rawGroupName: 'СТ1-11',
              },
              variants: [
                {
                  subject: 'Числитель',
                  teacher: '',
                  room: '',
                  weekType: 'numerator',
                  sourceRow: 5,
                },
              ],
            },
            {
              number: 3,
              source: {
                sheet: 'Лист',
                rowStart: 7,
                rowEnd: 8,
                rawGroupName: 'СТ1-11',
              },
              variants: [
                {
                  subject: 'Знаменатель',
                  teacher: '',
                  room: '',
                  weekType: 'denominator',
                  sourceRow: 7,
                },
              ],
            },
            {
              number: 4,
              source: {
                sheet: 'Лист',
                rowStart: 9,
                rowEnd: 10,
                rawGroupName: 'СТ1-11',
              },
              variants: [
                {
                  subject: 'Неизвестно',
                  teacher: '',
                  room: '',
                  weekType: 'unknown',
                  sourceRow: 9,
                },
              ],
            },
          ],
        },
      ],
    },
  },
});

describe('schedule generators', () => {
  it('serializes formatted JSON with a trailing newline', () => {
    const serialized = serializeSchedule(makeSchedule());
    const parsed = JSON.parse(serialized) as CanonicalSchedule;
    expect(serialized.endsWith('\n')).toBe(true);
    expect(parsed.groups['СТ1-11']?.group).toBe('СТ1-11');
  });

  it('creates weekly and biweekly events and skips an unknown week', () => {
    const ical = generateIcal(makeSchedule(), {
      group: 'СТ1-11',
      termStart: '2026-09-01',
      termEnd: '2026-10-01',
      referenceDate: '2026-09-07',
      referenceWeekType: 'numerator',
      lessonTimes: {
        1: { start: '08:30', end: '10:00' },
        2: { start: '10:10', end: '11:40' },
        3: { start: '12:00', end: '13:30' },
        4: { start: '13:40', end: '15:10' },
      },
    });
    expect(ical).toMatch(/SUMMARY:Общий\\, предмет/);
    expect(ical).toMatch(/LOCATION:101\\;A/);
    expect(ical).toMatch(/DTSTART;TZID=Europe\/Moscow:20260907T083000/);
    expect(ical).toMatch(/DTSTART;TZID=Europe\/Moscow:20260907T101000/);
    expect(ical).toMatch(/DTSTART;TZID=Europe\/Moscow:20260914T120000/);
    expect(ical).toMatch(/RRULE:FREQ=WEEKLY;INTERVAL=1;/);
    expect((ical.match(/RRULE:FREQ=WEEKLY;INTERVAL=2;/g) ?? []).length).toBe(2);
    expect(ical).not.toMatch(/Неизвестно/);
    expect(ical.endsWith('\r\n')).toBe(true);
  });

  it('rejects unknown groups', () => {
    expect(() =>
      generateIcal(makeSchedule(), {
        group: 'НЕТ',
        termStart: '2026-09-01',
        termEnd: '2026-10-01',
        referenceDate: '2026-09-07',
        lessonTimes: {},
      }),
    ).toThrow(/Group not found/);
  });
});
