import { describe, expect, it } from 'vitest';
import { generateIcal, generateIcalWithReport } from './ical.ts';
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
  fetchedAt: '2026-09-03T00:00:00.000Z',
};
const version: ScheduleVersion = {
  schemaVersion: 3,
  sourceSetHash: 'source',
  parserHash: 'parser',
  configHash: 'config',
  value: 'version',
};

const makeSchedule = (): CanonicalSchedule => ({
  schemaVersion: 3,
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

  it('generates a subgroup calendar with common and matching subgroup variants', () => {
    const schedule = makeSchedule();
    schedule.groups['СТ1-11']!.days[0]!.lessons[0]!.variants = [
      {
        subject: 'Общая пара',
        teacher: '',
        room: '',
        weekType: 'both',
        sourceRow: 3,
      },
      {
        subject: 'Пара подгруппы 1',
        teacher: '',
        room: '',
        weekType: 'both',
        subgroup: '1',
        sourceRow: 4,
      },
      {
        subject: 'Пара подгруппы 2',
        teacher: '',
        room: '',
        weekType: 'both',
        subgroup: '2',
        sourceRow: 5,
      },
    ];

    const ical = generateIcal(schedule, {
      group: 'СТ1-11',
      subgroup: '1',
      termStart: '2026-09-01',
      termEnd: '2026-10-01',
      referenceDate: '2026-09-07',
      lessonTimes: { 1: { start: '09:20', end: '10:50' } },
      excludedDatesByVariant: [
        { lessonNumber: 1, subgroup: '1', dates: ['2026-09-07'] },
      ],
    });

    expect(ical).toContain('SUMMARY:Общая пара');
    expect(ical).toContain('SUMMARY:Пара подгруппы 1');
    expect(ical).not.toContain('SUMMARY:Пара подгруппы 2');
    expect(ical.match(/EXDATE;TZID=Europe\/Moscow/g)).toHaveLength(1);
  });

  it('selects time for every lesson by its room and reports an unknown place', () => {
    const schedule = makeSchedule();
    schedule.groups['СТ1-11']!.days[0]!.lessons[0]!.variants[0]!.room = 'А101';
    schedule.groups['СТ1-11']!.days[0]!.lessons[1]!.variants[0]!.room = 'Б201';
    schedule.groups['СТ1-11']!.days[0]!.lessons[2]!.variants[0]!.room = 'ДОТ';

    const result = generateIcalWithReport(schedule, {
      group: 'СТ1-11',
      termStart: '2026-09-01',
      termEnd: '2026-10-01',
      referenceDate: '2026-09-07',
      lessonTimeResolver: ({ room }) => {
        if (room === 'А101')
          return { slots: [{ start: '09:20', end: '10:50' }] };
        if (room === 'Б201')
          return { slots: [{ start: '11:00', end: '12:30' }] };
        return { slots: [], reason: 'Неизвестное место' };
      },
    });

    expect(result.content).toContain(
      'DTSTART;TZID=Europe/Moscow:20260907T092000',
    );
    expect(result.content).toContain(
      'DTSTART;TZID=Europe/Moscow:20260907T110000',
    );
    expect(result.content).not.toContain('SUMMARY:Знаменатель');
    expect(result.skippedEvents).toEqual([
      expect.objectContaining({
        lessonNumber: 3,
        room: 'ДОТ',
        reason: 'Неизвестное место',
      }),
    ]);
  });

  it('uses multiple slots, Saturday overrides and stable exclusions', () => {
    const schedule = makeSchedule();
    schedule.groups['СТ1-11']!.days.push({
      day: 'Суббота',
      lessons: [
        {
          number: 5,
          source: {
            sheet: 'Лист',
            rowStart: 11,
            rowEnd: 12,
            rawGroupName: 'СТ1-11',
          },
          variants: [
            {
              subject: 'Субботняя пара',
              teacher: '',
              room: '',
              weekType: 'both',
              sourceRow: 11,
            },
          ],
        },
      ],
    });
    const options = {
      group: 'СТ1-11',
      termStart: '2026-09-01',
      termEnd: '2026-10-01',
      referenceDate: '2026-09-07',
      lessonTimes: {
        2: [
          { start: '11:00', end: '11:45' },
          { start: '12:25', end: '13:10' },
        ],
        5: { start: '15:05', end: '16:35' },
      },
      lessonTimesByDay: {
        Суббота: {
          5: { start: '16:45', end: '18:15' },
        },
      },
      excludedDates: { 2: ['2026-09-07'] },
      additionalEvents: [
        {
          date: '2026-09-05',
          lessonNumber: 5,
          key: 'unresolved',
          summary: 'Необработанная замена',
        },
      ],
    } as const;
    const first = generateIcal(schedule, options);
    const second = generateIcal(schedule, options);

    expect(first).toBe(second);
    expect(first.match(/SUMMARY:Числитель/g) ?? []).toHaveLength(2);
    expect(first).toContain('EXDATE;TZID=Europe/Moscow:20260907T110000');
    expect(first).toContain('EXDATE;TZID=Europe/Moscow:20260907T122500');
    expect(first).toContain('DTSTART;TZID=Europe/Moscow:20260905T164500');
    expect(first).toContain('DTEND;TZID=Europe/Moscow:20260905T181500');
    expect(first).toContain('DTSTAMP:20000101T000000Z');
  });
});
