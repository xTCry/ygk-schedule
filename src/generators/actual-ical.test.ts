import { describe, expect, it } from 'vitest';
import { generateActualIcal } from './actual-ical.ts';
import type {
  ActualGroupSchedule,
  ActualSchedule,
  AppliedReplacement,
  CanonicalSchedule,
  Replacement,
  ScheduleSource,
  ScheduleVersion,
} from '../types.ts';

const source: ScheduleSource = {
  id: 'test.xlsx',
  fileName: 'test.xlsx',
  sha256: 'source',
  fetchedAt: '2026-09-04T00:00:00.000Z',
};

const version: ScheduleVersion = {
  schemaVersion: 5,
  sourceSetHash: 'source',
  parserHash: 'parser',
  configHash: 'config',
  value: 'base-version',
};

const replacement = (
  type: Replacement['type'],
  lessonNumber: number,
  raw: string,
): AppliedReplacement => ({
  lessonNumber,
  strategy: type === 'add' ? 'add' : 'exact-subject',
  replacement: {
    date: '2026-09-04',
    group: 'СТ1-11',
    lessonNumbers: [lessonNumber],
    type,
    original: type === 'add' ? null : { raw: 'Исходная дисциплина' },
    replacement: type === 'cancel' ? null : { raw, room: 'А201' },
    source: {
      shift: 'first',
      row: lessonNumber + 1,
      rawGroupName: 'СТ1-11',
      rawLessonNumbers: String(lessonNumber),
      rawOriginal: 'Исходная дисциплина',
      rawReplacement: raw,
      rawRoom: 'А201',
    },
  },
});

const makeSchedule = (): CanonicalSchedule => ({
  schemaVersion: 5,
  provider: 'ygk',
  generatedAt: '2026-09-04T00:00:00.000Z',
  sources: [source],
  version,
  semanticHash: 'semantic',
  diagnostics: [],
  groups: {
    'СТ1-11': {
      group: 'СТ1-11',
      sourceGroups: ['СТ1-11'],
      sourceBlocks: [
        { sheet: 'Лист', rowStart: 1, rowEnd: 10, rawGroupName: 'СТ1-11' },
      ],
      days: [
        {
          day: 'Пятница',
          lessons: [0, 2, 4, 6].map((number) => ({
            number,
            source: {
              sheet: 'Лист',
              rowStart: number + 1,
              rowEnd: number + 1,
              rawGroupName: 'СТ1-11',
            },
            variants: [
              {
                subject:
                  number === 2
                    ? 'Математика'
                    : number === 6
                      ? 'Новая базовая пара'
                      : `Базовая пара ${number}`,
                teacher: '',
                room: '',
                weekType: 'both' as const,
                sourceRow: number + 1,
              },
            ],
          })),
        },
      ],
    },
  },
});

const makeActualGroup = (): ActualGroupSchedule => ({
  group: 'СТ1-11',
  date: '2026-09-04',
  day: 'Пятница',
  lessons: [
    {
      number: 0,
      variants: [],
      source: null,
      status: 'cancelled',
      replacements: [replacement('cancel', 0, '')],
    },
    {
      number: 2,
      variants: [
        {
          subject: 'История',
          teacher: 'Петров П.П.',
          room: 'А201',
          weekType: 'both',
          sourceRow: 3,
        },
      ],
      source: null,
      status: 'scheduled',
      replacements: [replacement('replace', 2, 'История')],
    },
    {
      number: 4,
      variants: [
        {
          subject: 'Базовая пара 4',
          teacher: '',
          room: '',
          weekType: 'both',
          sourceRow: 5,
        },
        {
          subject: 'Биология',
          teacher: '',
          room: 'А201',
          weekType: 'both',
          sourceRow: 5,
        },
      ],
      source: null,
      status: 'scheduled',
      replacements: [replacement('add', 4, 'Биология')],
    },
  ],
  unresolvedReplacements: [
    {
      lessonNumber: 6,
      reason: 'lesson-not-found',
      replacement: replacement('replace', 6, 'Свободный текст').replacement,
      event: {
        summary: 'Необработанная замена',
        description: 'Опубликованный свободный текст',
      },
    },
  ],
});

const makeActual = (group: ActualGroupSchedule): ActualSchedule => ({
  schemaVersion: 5,
  provider: 'ygk',
  generatedAt: '2026-09-04T00:00:00.000Z',
  sources: [source],
  version,
  baseScheduleVersion: version.value,
  replacementVersion: 'replacement-version',
  dates: {
    '2026-09-04': {
      date: '2026-09-04',
      day: 'Пятница',
      weekType: 'both',
      groups: { 'СТ1-11': group },
    },
  },
  diagnostics: [],
  semanticHash: 'actual-semantic',
});

const options = {
  group: 'СТ1-11',
  termStart: '2026-09-01',
  termEnd: '2026-10-01',
  referenceDate: '2026-09-07',
  lessonTimes: {
    0: { start: '08:00', end: '09:10' },
    2: { start: '11:00', end: '12:30' },
    4: { start: '15:05', end: '16:35' },
    6: { start: '18:45', end: '19:55' },
  },
} as const;

describe('actual iCalendar generator', () => {
  it('excludes replaced and cancelled base events, without hiding add/unresolved', () => {
    const ical = generateActualIcal(
      makeSchedule(),
      makeActual(makeActualGroup()),
      options,
    );

    expect(ical).toContain('EXDATE;TZID=Europe/Moscow:20260904T080000');
    expect(ical).toContain('EXDATE;TZID=Europe/Moscow:20260904T110000');
    expect(ical).not.toContain('EXDATE;TZID=Europe/Moscow:20260904T150500');
    expect(ical).toContain('SUMMARY:История');
    expect(ical).toContain('SUMMARY:Биология');
    expect(ical).toContain('SUMMARY:Необработанная замена');
    expect(ical).toContain('SUMMARY:Базовая пара 4');
  });

  it('materializes a finalized date and excludes every current base pair', () => {
    const group = makeActualGroup();
    group.frozenBase = {
      scheduleVersion: 'past-base-version',
      dataRevision: 'data-revision',
      lessons: group.lessons,
    };
    const ical = generateActualIcal(makeSchedule(), makeActual(group), options);

    for (const time of ['080000', '110000', '150500', '184500'])
      expect(ical).toContain(`EXDATE;TZID=Europe/Moscow:20260904T${time}`);
    expect(ical).toContain('SUMMARY:История');
    expect(ical).toContain('SUMMARY:Базовая пара 4');
    expect(ical).not.toContain('SUMMARY:Новая базовая пара\\r\\n');
  });
});
