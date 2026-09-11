import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYgkReplacementAliases } from './config.ts';
import {
  buildActualSchedule,
  semanticActualScheduleHash,
  semanticReplacementHash,
} from './resolve.ts';
import type {
  CanonicalReplacements,
  CanonicalSchedule,
  Replacement,
  ReplacementSnapshot,
  SourceReference,
} from '../../../types.ts';

const source: SourceReference = {
  sheet: 'Тест',
  rowStart: 1,
  rowEnd: 1,
  rawGroupName: 'СТ1-11',
};

const baseSchedule: CanonicalSchedule = {
  schemaVersion: 3,
  provider: 'ygk',
  generatedAt: '2026-09-03T12:00:00.000Z',
  sources: [],
  version: {
    schemaVersion: 3,
    sourceSetHash: 'source',
    parserHash: 'parser',
    configHash: 'config',
    value: 'base-version',
  },
  groups: {
    'СТ1-11': {
      group: 'СТ1-11',
      sourceGroups: ['СТ1-11'],
      sourceBlocks: [source],
      days: [
        {
          day: 'Пятница',
          lessons: [
            {
              number: 0,
              variants: [
                {
                  subject: 'Разг. о важном',
                  teacher: '',
                  room: '',
                  weekType: 'both',
                  sourceRow: 1,
                },
              ],
              source,
            },
            {
              number: 2,
              variants: [
                {
                  subject: 'Математика',
                  teacher: '',
                  room: '',
                  weekType: 'numerator',
                  sourceRow: 2,
                },
              ],
              source,
            },
            {
              number: 4,
              variants: [
                {
                  subject: 'Физика',
                  teacher: '',
                  room: '',
                  weekType: 'both',
                  sourceRow: 3,
                },
              ],
              source,
            },
          ],
        },
      ],
    },
  },
  diagnostics: [],
  semanticHash: 'base-semantic',
};

const replacement = (
  lessonNumbers: number[],
  type: Replacement['type'],
  original: string | null,
  next: string | null,
): Replacement => ({
  date: '2026-09-04',
  group: 'СТ1-11',
  lessonNumbers,
  type,
  original: original ? { raw: original } : null,
  replacement: next ? { raw: next, room: 'А201' } : null,
  source: {
    shift: 'first',
    row: lessonNumbers[0] ?? 0,
    rawGroupName: 'СТ1-11',
    rawLessonNumbers: lessonNumbers.join(','),
    rawOriginal: original ?? '',
    rawReplacement: next ?? '',
    rawRoom: 'А201',
  },
});

const replacements: CanonicalReplacements = {
  schemaVersion: 3,
  provider: 'ygk',
  generatedAt: '2026-09-03T12:30:00.000Z',
  sources: [
    {
      id: 'first',
      fileName: 'rasp_first.html',
      sha256: 'source-hash',
      fetchedAt: '2026-09-03T12:30:00.000Z',
      shift: 'first',
    },
  ],
  version: {
    schemaVersion: 3,
    sourceSetHash: 'replacement-source',
    parserHash: 'parser',
    configHash: 'config',
    value: 'replacement-version',
  },
  dates: {
    '2026-09-04': {
      date: '2026-09-04',
      day: 'Пятница',
      weekType: 'numerator',
      replacements: [
        replacement([0], 'cancel', 'Разг. о важном', 'Снято'),
        replacement([2], 'replace', 'Математика', 'История'),
        replacement([4], 'add', null, 'Биология'),
        replacement([5], 'replace', 'Неизвестный предмет', 'История'),
      ],
    },
  },
  diagnostics: [],
  semanticHash: 'replacement-semantic',
};

describe('actual YGK schedule', () => {
  it('applies only unambiguous replacements and preserves unresolved ones', () => {
    const actual = buildActualSchedule(
      baseSchedule,
      replacements,
      'actual-parser',
      'config',
    );
    const group = actual.dates['2026-09-04']?.groups['СТ1-11'];
    const cancelled = group?.lessons.find((lesson) => lesson.number === 0);
    const replaced = group?.lessons.find((lesson) => lesson.number === 2);
    const added = group?.lessons.find((lesson) => lesson.number === 4);

    expect(cancelled).toMatchObject({
      status: 'cancelled',
      variants: [],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 0 }],
    });
    expect(replaced).toMatchObject({
      status: 'scheduled',
      variants: [{ subject: 'История', room: 'А201' }],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 2 }],
    });
    expect(added).toMatchObject({
      variants: [{ subject: 'Физика' }, { subject: 'Биология', room: 'А201' }],
      replacements: [{ strategy: 'add', lessonNumber: 4 }],
    });
    expect(group?.unresolvedReplacements).toEqual([
      expect.objectContaining({
        lessonNumber: 5,
        reason: 'lesson-not-found',
        event: {
          summary: 'Необработанная замена',
          description:
            'По расписанию: «Неизвестный предмет». По замене: «История». Аудитория: «А201».',
          room: 'А201',
        },
      }),
    ]);
    expect(actual.diagnostics).toEqual([
      expect.objectContaining({
        code: 'UNRESOLVED_REPLACEMENT',
        severity: 'error',
      }),
    ]);
    expect(actual.diagnostics[0]?.context).toMatchObject({
      baseGroup: 'СТ1-11',
    });
  });

  it('continues a two-lesson replacement row marked with an ellipsis', () => {
    const ellipsisReplacement = replacement(
      [2, 3],
      'replace',
      'Математика...',
      'Математика Шереметьева Н.В.',
    );
    const actual = buildActualSchedule(
      baseSchedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [ellipsisReplacement],
          },
        },
      },
      'actual-parser',
      'config',
    );
    const group = actual.dates['2026-09-04']?.groups['СТ1-11'];

    expect(group?.lessons.find((lesson) => lesson.number === 2)).toMatchObject({
      variants: [
        {
          subject: 'Математика',
          teacher: 'Шереметьева Н.В.',
          room: 'А201',
        },
      ],
    });
    expect(group?.lessons.find((lesson) => lesson.number === 3)).toMatchObject({
      source: null,
      variants: [
        {
          subject: 'Математика',
          teacher: 'Шереметьева Н.В.',
          room: 'А201',
        },
      ],
      replacements: [{ strategy: 'ellipsis-continuation', lessonNumber: 3 }],
    });
    expect(group?.unresolvedReplacements).toEqual([]);
  });

  it('does not infer a missing lesson without the ellipsis marker', () => {
    const actual = buildActualSchedule(
      baseSchedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement(
                [2, 3],
                'replace',
                'Математика',
                'Математика Шереметьева Н.В.',
              ),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );
    const group = actual.dates['2026-09-04']?.groups['СТ1-11'];

    expect(
      group?.lessons.find((lesson) => lesson.number === 3),
    ).toBeUndefined();
    expect(group?.unresolvedReplacements).toEqual([
      expect.objectContaining({
        lessonNumber: 3,
        reason: 'lesson-not-found',
      }),
    ]);
  });

  it('distinguishes an absent lesson from a lesson not scheduled for this week', () => {
    const denominatorReplacements: CanonicalReplacements = {
      ...replacements,
      dates: {
        '2026-09-04': {
          ...replacements.dates['2026-09-04']!,
          weekType: 'denominator',
          replacements: [
            replacement([2], 'cancel', 'Математика', 'Снято'),
            replacement([5], 'cancel', 'Неизвестный предмет', 'Снято'),
          ],
        },
      },
    };

    const actual = buildActualSchedule(
      baseSchedule,
      denominatorReplacements,
      'actual-parser',
      'config',
    );
    const group = actual.dates['2026-09-04']?.groups['СТ1-11'];

    expect(group?.lessons.map((lesson) => lesson.number)).toEqual([0, 4]);
    expect(group?.unresolvedReplacements).toEqual([
      expect.objectContaining({
        lessonNumber: 2,
        reason: 'lesson-not-scheduled-for-week',
      }),
      expect.objectContaining({
        lessonNumber: 5,
        reason: 'lesson-not-found',
      }),
    ]);
    const unavailableWeekDiagnostic = actual.diagnostics.find(
      (diagnostic) =>
        diagnostic.context?.reason === 'lesson-not-scheduled-for-week',
    );
    expect(unavailableWeekDiagnostic?.context).toMatchObject({
      reason: 'lesson-not-scheduled-for-week',
      replacementWeekType: 'denominator',
      availableWeekTypes: ['numerator'],
      candidates: [{ subject: 'Математика', sourceRow: 2 }],
    });
  });

  it('changes only the matching subgroup variant of a lesson', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']!.days[0]!.lessons.find(
      (item) => item.number === 2,
    )!;
    lesson.variants = [
      {
        subject: 'Математика',
        teacher: '',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '1',
        sourceRow: 2,
      },
      {
        subject: 'Физика',
        teacher: '',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '2',
        sourceRow: 3,
      },
    ];
    const replaceFirst = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement([2], 'replace', 'Математика', 'История'),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );
    const replacedLesson = replaceFirst.dates['2026-09-04']!.groups[
      'СТ1-11'
    ]!.lessons.find((item) => item.number === 2)!;

    expect(replacedLesson).toMatchObject({
      status: 'scheduled',
      variants: [
        { subject: 'История', subgroup: '1' },
        { subject: 'Физика', subgroup: '2' },
      ],
    });

    const cancelFirst = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [replacement([2], 'cancel', 'Математика', 'Снято')],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      cancelFirst.dates['2026-09-04']!.groups['СТ1-11']!.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      status: 'scheduled',
      variants: [{ subject: 'Физика', subgroup: '2' }],
    });
  });

  it('keeps every scheduled variant and changes only its room for “по расписанию”', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']!.days[0]!.lessons.find(
      (item) => item.number === 2,
    )!;
    lesson.variants = [
      {
        subject: 'МДК.06.01',
        teacher: 'Иванова И.И.',
        room: 'Б406',
        weekType: 'numerator',
        subgroup: '1',
        sourceRow: 2,
      },
      {
        subject: 'Учебная практика',
        teacher: 'Петров П.П.',
        room: 'Б406',
        weekType: 'numerator',
        subgroup: '2',
        sourceRow: 3,
      },
    ];
    const roomOnlyReplacement: Replacement = {
      ...replacement([2], 'replace', null, 'по расписанию'),
      replacement: { raw: 'по расписанию', room: 'ДОТ' },
      source: {
        ...replacement([2], 'replace', null, 'по расписанию').source,
        rawOriginal: '',
        rawReplacement: 'по расписанию',
        rawRoom: 'ДОТ',
      },
    };

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [roomOnlyReplacement],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']!.groups['СТ1-11']!.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      variants: [
        {
          subject: 'МДК.06.01',
          teacher: 'Иванова И.И.',
          room: 'ДОТ',
          subgroup: '1',
        },
        {
          subject: 'Учебная практика',
          teacher: 'Петров П.П.',
          room: 'ДОТ',
          subgroup: '2',
        },
      ],
      replacements: [{ strategy: 'scheduled-room', lessonNumber: 2 }],
    });
  });

  it('uses aliases only for an unambiguous match and preserves raw values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-resolver-aliases-'));
    const directory = join(root, 'config', 'ygk');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'replacements.json'),
      JSON.stringify({
        groups: { 'специальная ст': 'СТ1-11' },
        subjects: { Алгебра: 'Математика' },
        teachers: { 'Петров П. П.': 'Петров П.П.' },
        rooms: { 'а 201': 'А201' },
      }),
    );
    const aliases = await loadYgkReplacementAliases(root);
    const aliasedReplacement: Replacement = {
      ...replacement([2], 'replace', 'Алгебра', 'История Петров П. П.'),
      group: 'специальная СТ',
      replacement: { raw: 'История Петров П. П.', room: 'а 201' },
      source: {
        ...replacement([2], 'replace', 'Алгебра', 'История Петров П. П.')
          .source,
        rawGroupName: 'специальная СТ',
        rawRoom: 'а 201',
      },
    };
    const actual = buildActualSchedule(
      baseSchedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [aliasedReplacement],
          },
        },
      },
      'actual-parser',
      'config',
      aliases,
    );

    expect(actual.dates['2026-09-04']?.groups).toHaveProperty('СТ1-11');
    expect(
      actual.dates['2026-09-04']?.groups['СТ1-11']?.lessons.find(
        (lesson) => lesson.number === 2,
      ),
    ).toMatchObject({
      variants: [
        {
          subject: 'История',
          teacher: 'Петров П.П.',
          room: 'А201',
          rawSubject: 'История Петров П. П.',
          rawTeacher: 'Петров П. П.',
          rawRoom: 'а 201',
        },
      ],
      replacements: [{ strategy: 'subject-alias', lessonNumber: 2 }],
    });

    const ambiguousBase = structuredClone(baseSchedule);
    const ambiguousLesson = ambiguousBase.groups[
      'СТ1-11'
    ]?.days[0]?.lessons.find((lesson) => lesson.number === 2);
    if (!ambiguousLesson) throw new Error('Expected test lesson was not found');
    ambiguousLesson.variants.push({
      ...ambiguousLesson.variants[0]!,
      subject: 'Алгебра',
    });
    const ambiguous = buildActualSchedule(
      ambiguousBase,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [aliasedReplacement],
          },
        },
      },
      'actual-parser',
      'config',
      aliases,
    );

    expect(
      ambiguous.dates['2026-09-04']?.groups['СТ1-11']?.unresolvedReplacements,
    ).toEqual([expect.objectContaining({ reason: 'ambiguous-original' })]);
  });

  it('resolves a numbered specialty group from the base schedule', () => {
    const schedule = structuredClone(baseSchedule);
    const scheduleGroup = schedule.groups['СТ1-11'];
    if (!scheduleGroup) throw new Error('Expected test group was not found');
    delete schedule.groups['СТ1-11'];
    scheduleGroup.group = '36 ЭМЕХ';
    scheduleGroup.sourceGroups = ['36 ЭМЕХ'];
    schedule.groups['36 ЭМЕХ'] = scheduleGroup;

    const namedReplacement: Replacement = {
      ...replacement([2], 'replace', 'Математика', 'История'),
      group: '36 ЭМЕХ',
      source: {
        ...replacement([2], 'replace', 'Математика', 'История').source,
        rawGroupName: '36 ЭМЕХ',
      },
    };
    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [namedReplacement],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']?.groups['36 ЭМЕХ']?.lessons.find(
        (lesson) => lesson.number === 2,
      ),
    ).toMatchObject({
      variants: [{ subject: 'История' }],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 2 }],
    });
  });

  it('uses a parsed subgroup and teacher to replace only one variant', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']!.days[0]!.lessons.find(
      (item) => item.number === 2,
    )!;
    lesson.variants = [
      {
        subject: 'Математика',
        teacher: 'Петрова П.П.',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '1',
        sourceRow: 2,
      },
      {
        subject: 'Математика',
        teacher: 'Петрова П.П.',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '2',
        sourceRow: 3,
      },
    ];
    const subgroupReplacement: Replacement = {
      ...replacement(
        [2],
        'replace',
        'Математика п/гр.2 Петрова П.П.',
        'Инф.технол.п/гр.2 Сердцева О.Д.',
      ),
    };

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [subgroupReplacement],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']!.groups['СТ1-11']!.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      variants: [
        { subject: 'Математика', subgroup: '1', teacher: 'Петрова П.П.' },
        {
          subject: 'Инф.технол.',
          subgroup: '2',
          teacher: 'Сердцева О.Д.',
        },
      ],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 2 }],
    });
  });

  it('applies a replacement with an empty subgroup marker to both subgroups', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']!.days[0]!.lessons.find(
      (item) => item.number === 2,
    )!;
    lesson.variants = [
      {
        subject: 'Математика',
        teacher: '',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '1',
        sourceRow: 2,
      },
      {
        subject: 'Математика',
        teacher: '',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '2',
        sourceRow: 3,
      },
    ];

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement([2], 'replace', 'Математика п/гр', 'Информатика пгр'),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']!.groups['СТ1-11']!.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      variants: [
        { subject: 'Информатика', subgroup: '1' },
        { subject: 'Информатика', subgroup: '2' },
      ],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 2 }],
    });
  });

  it('cancels both explicitly listed subgroups', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']!.days[0]!.lessons.find(
      (item) => item.number === 2,
    )!;
    lesson.variants = [
      {
        subject: 'Математика',
        teacher: '',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '1',
        sourceRow: 2,
      },
      {
        subject: 'Математика',
        teacher: '',
        room: 'А201',
        weekType: 'numerator',
        subgroup: '2',
        sourceRow: 3,
      },
    ];

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement([2], 'cancel', 'Математика пгр1,2', 'Снято'),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']!.groups['СТ1-11']!.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      status: 'cancelled',
      variants: [],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 2 }],
    });
  });

  it('matches listed module codes and conservative subject abbreviations', () => {
    const schedule = structuredClone(baseSchedule);
    const scheduleGroup = schedule.groups['СТ1-11'];
    if (!scheduleGroup) throw new Error('Expected test group was not found');
    delete schedule.groups['СТ1-11'];
    scheduleGroup.group = 'СА1-21';
    scheduleGroup.sourceGroups = ['СА1-21'];
    schedule.groups['СА1-21'] = scheduleGroup;

    const lessons = scheduleGroup.days[0]?.lessons;
    if (!lessons) throw new Error('Expected test day was not found');
    lessons[0]!.variants[0]!.subject = 'МДК.01.01 Компьютерные сети';
    lessons[1]!.variants[0]!.subject =
      'МДК.04.01 Установка, настройка и обслуживание';
    lessons[2]!.variants[0]!.subject = 'Информационные технологии';

    const moduleReplacement: Replacement = {
      ...replacement(
        [0, 2],
        'replace',
        'МДК 01.01 МДК 04.01',
        'Опер.системы Гудкова А.Л.',
      ),
      group: 'СА1-21',
      source: {
        ...replacement(
          [0, 2],
          'replace',
          'МДК 01.01 МДК 04.01',
          'Опер.системы Гудкова А.Л.',
        ).source,
        rawGroupName: 'СА1-21',
      },
    };
    const abbreviatedReplacement: Replacement = {
      ...replacement([4], 'replace', 'Инф.технол.', 'Практика'),
      group: 'СА1-21',
      source: {
        ...replacement([4], 'replace', 'Инф.технол.', 'Практика').source,
        rawGroupName: 'СА1-21',
      },
    };

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [moduleReplacement, abbreviatedReplacement],
          },
        },
      },
      'actual-parser',
      'config',
    );
    const actualLessons = actual.dates['2026-09-04']?.groups['СА1-21']?.lessons;

    expect(actualLessons?.find((lesson) => lesson.number === 0)).toMatchObject({
      variants: [{ subject: 'Опер.системы', teacher: 'Гудкова А.Л.' }],
      replacements: [{ strategy: 'subject-module-code' }],
    });
    expect(actualLessons?.find((lesson) => lesson.number === 2)).toMatchObject({
      variants: [{ subject: 'Опер.системы', teacher: 'Гудкова А.Л.' }],
      replacements: [{ strategy: 'subject-module-code' }],
    });
    expect(actualLessons?.find((lesson) => lesson.number === 4)).toMatchObject({
      variants: [{ subject: 'Практика' }],
      replacements: [{ strategy: 'subject-abbreviation' }],
    });
    expect(
      actual.dates['2026-09-04']?.groups['СА1-21']?.unresolvedReplacements,
    ).toEqual([]);
  });

  it('matches the subject mentioned in a compound manual original value', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']?.days[0]?.lessons.find(
      (item) => item.number === 2,
    );
    if (!lesson) throw new Error('Expected test lesson');
    lesson.variants[0]!.subject =
      'Теория вероятностей и математическая статистика';

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement([2], 'replace', 'Теор.вер. Физкул.', 'Информатика'),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']?.groups['СТ1-11']?.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      variants: [{ subject: 'Информатика' }],
      replacements: [{ strategy: 'subject-word-mention' }],
    });
  });

  it('uses a long abbreviated word mentioned for a neighboring lesson', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']?.days[0]?.lessons.find(
      (item) => item.number === 2,
    );
    if (!lesson) throw new Error('Expected test lesson');
    lesson.variants[0]!.subject = 'Обществознание';

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement([2], 'replace', 'История Общест.', 'Информатика'),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']?.groups['СТ1-11']?.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      variants: [{ subject: 'Информатика' }],
      replacements: [{ strategy: 'subject-word-mention' }],
    });
  });

  it('matches one listed module code across several lesson numbers', () => {
    const schedule = structuredClone(baseSchedule);
    const lessons = schedule.groups['СТ1-11']?.days[0]?.lessons;
    if (!lessons) throw new Error('Expected test lessons');
    lessons[0]!.variants[0]!.subject = 'МДК.01.05 Конструкции зданий';
    lessons[1]!.variants[0]!.subject = 'МДК.01.05 Архитектурные решения';

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement([0, 2], 'replace', 'МДК 01.05 п/гр', 'Практика'),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );

    const actualLessons = actual.dates['2026-09-04']?.groups['СТ1-11']?.lessons;
    expect(actualLessons?.find((lesson) => lesson.number === 0)).toMatchObject({
      variants: [{ subject: 'Практика' }],
      replacements: [{ strategy: 'subject-module-code' }],
    });
    expect(actualLessons?.find((lesson) => lesson.number === 2)).toMatchObject({
      variants: [{ subject: 'Практика' }],
      replacements: [{ strategy: 'subject-module-code' }],
    });
  });

  it('matches a compact practice code before a subgroup marker', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']?.days[0]?.lessons.find(
      (item) => item.number === 2,
    );
    if (!lesson) throw new Error('Expected test lesson');
    lesson.variants[0]!.subject = 'УП.04 Учебная практика п/гр2';

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [replacement([2], 'replace', 'УП 04 пгр', 'История')],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']?.groups['СТ1-11']?.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      variants: [{ subject: 'История' }],
      replacements: [{ strategy: 'subject-module-code' }],
    });
  });

  it.each([
    ['МДК.01.01', 'МДК.01.01 Компьютерные сети'],
    ['МДК01.01', 'МДК.01.01 Компьютерные сети'],
    ['УП.04', 'УП.04 Учебная практика'],
    ['УП04', 'УП.04 Учебная практика'],
  ])(
    'matches a manually compacted subject code %s',
    (originalCode, baseSubject) => {
      const schedule = structuredClone(baseSchedule);
      const lesson = schedule.groups['СТ1-11']?.days[0]?.lessons.find(
        (item) => item.number === 2,
      );
      if (!lesson) throw new Error('Expected test lesson');
      lesson.variants[0]!.subject = baseSubject;

      const actual = buildActualSchedule(
        schedule,
        {
          ...replacements,
          dates: {
            '2026-09-04': {
              ...replacements.dates['2026-09-04']!,
              replacements: [
                replacement([2], 'replace', originalCode, 'История'),
              ],
            },
          },
        },
        'actual-parser',
        'config',
      );

      expect(
        actual.dates['2026-09-04']?.groups['СТ1-11']?.lessons.find(
          (item) => item.number === 2,
        ),
      ).toMatchObject({
        variants: [{ subject: 'История' }],
        replacements: [{ strategy: 'subject-module-code' }],
      });
    },
  );

  it('reports a subgroup that is not scheduled in the replacement week', () => {
    const schedule = structuredClone(baseSchedule);
    const lesson = schedule.groups['СТ1-11']?.days[0]?.lessons.find(
      (item) => item.number === 2,
    );
    if (!lesson) throw new Error('Expected test lesson');
    lesson.variants[0] = {
      ...lesson.variants[0]!,
      subgroup: '1',
    };

    const actual = buildActualSchedule(
      schedule,
      {
        ...replacements,
        dates: {
          '2026-09-04': {
            ...replacements.dates['2026-09-04']!,
            replacements: [
              replacement([2], 'replace', 'Математика п/гр.2', 'История'),
            ],
          },
        },
      },
      'actual-parser',
      'config',
    );

    expect(
      actual.dates['2026-09-04']?.groups['СТ1-11']?.unresolvedReplacements,
    ).toEqual([expect.objectContaining({ reason: 'subgroup-not-matched' })]);
    expect(actual.diagnostics[0]?.context).toMatchObject({
      requestedSubject: 'Математика',
      requestedSubgroups: ['2'],
      candidates: [
        expect.objectContaining({
          subject: 'Математика',
          subgroup: '1',
        }),
      ],
    });
  });

  it('keeps a frozen base for a finalized shift after the XLSX schedule changes', () => {
    const finalizedFirst: ReplacementSnapshot = {
      date: '2026-09-04',
      day: 'Пятница',
      weekType: 'numerator',
      shift: 'first',
      status: 'finalized',
      source: replacements.sources[0]!,
      replacements: [replacement([2], 'replace', 'Математика', 'История')],
      diagnostics: [],
      finalizedBy: {
        date: '2026-09-05',
        sourceId: 'first',
        sourceSha256: 'first-05',
      },
    };
    const mutableSecond: ReplacementSnapshot = {
      date: '2026-09-04',
      day: 'Пятница',
      weekType: 'numerator',
      shift: 'second',
      status: 'mutable',
      source: {
        ...replacements.sources[0]!,
        id: 'second',
        fileName: 'rasp_second.html',
        sha256: 'second-source-hash',
        shift: 'second',
      },
      replacements: [replacement([4], 'add', null, 'Биология')],
      diagnostics: [],
    };
    const history: CanonicalReplacements = {
      ...replacements,
      dates: {
        '2026-09-04': {
          ...replacements.dates['2026-09-04']!,
          shifts: {
            first: finalizedFirst,
            second: mutableSecond,
          },
          replacements: [
            ...finalizedFirst.replacements,
            ...mutableSecond.replacements,
          ],
        },
      },
    };
    const firstActual = buildActualSchedule(
      baseSchedule,
      history,
      'actual-parser',
      'config',
      undefined,
      { baseDataRevision: 'data-base-v1' },
    );
    const frozen = firstActual.dates['2026-09-04']?.groups['СТ1-11'];
    expect(frozen?.frozenBase).toMatchObject({
      scheduleVersion: 'base-version',
      dataRevision: 'data-base-v1',
    });

    const changedBase = structuredClone(baseSchedule);
    changedBase.version.value = 'base-version-v2';
    const lesson = changedBase.groups['СТ1-11']?.days[0]?.lessons.find(
      (item) => item.number === 2,
    );
    if (!lesson) throw new Error('Expected lesson was not found');
    lesson.variants[0]!.subject = 'Алгебра';

    const rebuilt = buildActualSchedule(
      changedBase,
      history,
      'actual-parser',
      'config',
      undefined,
      { previousActual: firstActual, baseDataRevision: 'data-base-v2' },
    );
    expect(
      rebuilt.dates['2026-09-04']?.groups['СТ1-11']?.lessons.find(
        (item) => item.number === 2,
      ),
    ).toMatchObject({
      variants: [{ subject: 'История' }],
      replacements: [{ strategy: 'exact-subject' }],
    });
    expect(
      rebuilt.dates['2026-09-04']?.groups['СТ1-11']?.frozenBase,
    ).toMatchObject({
      scheduleVersion: 'base-version',
      dataRevision: 'data-base-v1',
    });
  });

  it('ignores source and version provenance in replacement and actual semantic hashes', () => {
    const snapshot: ReplacementSnapshot = {
      date: '2026-09-04',
      day: 'Пятница',
      weekType: 'numerator',
      shift: 'first',
      status: 'mutable',
      source: replacements.sources[0]!,
      replacements: [replacement([2], 'replace', 'Математика', 'История')],
      diagnostics: [],
    };
    const replacementHistory: CanonicalReplacements = {
      ...replacements,
      dates: {
        '2026-09-04': {
          ...replacements.dates['2026-09-04']!,
          shifts: { first: snapshot },
          replacements: snapshot.replacements,
        },
      },
    };
    const differentSource = structuredClone(replacementHistory);
    differentSource.generatedAt = '2026-09-05T17:00:00.000Z';
    differentSource.sources[0]!.fetchedAt = '2026-09-05T17:00:00.000Z';
    differentSource.sources[0]!.etag = 'new-etag';
    differentSource.sources[0]!.lastModified = 'Sat, 05 Sep 2026 17:00:00 GMT';
    differentSource.dates['2026-09-04']!.shifts!.first!.source.sha256 =
      'new-source-sha';
    differentSource.dates['2026-09-04']!.shifts!.first!.source.fetchedAt =
      '2026-09-05T17:00:00.000Z';
    expect(semanticReplacementHash(differentSource)).toBe(
      semanticReplacementHash(replacementHistory),
    );

    const actual = buildActualSchedule(
      baseSchedule,
      replacementHistory,
      'actual-parser',
      'config',
      undefined,
      { baseDataRevision: 'data-v1' },
    );
    const differentProvenance = structuredClone(actual);
    differentProvenance.baseScheduleVersion = 'base-version-v2';
    differentProvenance.baseDataRevision = 'data-v2';
    differentProvenance.replacementVersion = 'replacement-version-v2';
    differentProvenance.generatedAt = '2026-09-05T17:00:00.000Z';
    differentProvenance.diagnostics = differentProvenance.diagnostics.map(
      (diagnostic) => ({
        ...diagnostic,
        sourceId: 'different-source',
        sourceUrl: 'https://example.test/different-source.html',
      }),
    );
    expect(semanticActualScheduleHash(differentProvenance)).toBe(
      semanticActualScheduleHash(actual),
    );
  });
});
