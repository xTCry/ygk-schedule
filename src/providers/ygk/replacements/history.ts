import { createDiagnostic } from '../../../diagnostics/index.ts';
import type {
  CanonicalReplacements,
  Diagnostic,
  ParsedReplacements,
  ReplacementDate,
  ReplacementPageSource,
  ReplacementShift,
  ReplacementSnapshot,
} from '../../../types.ts';
import { sha256 } from '../../../utils/hash.ts';

export interface ReplacementPageSnapshotInput {
  parsed: ParsedReplacements;
  source: ReplacementPageSource;
}

export interface ReplacementHistoryMergeResult {
  dates: CanonicalReplacements['dates'];
  diagnostics: Diagnostic[];
}

const shiftOrder: readonly ReplacementShift[] = ['first', 'second'];

const compareSnapshots = (
  left: ReplacementSnapshot,
  right: ReplacementSnapshot,
): number => shiftOrder.indexOf(left.shift) - shiftOrder.indexOf(right.shift);

const cloneSnapshot = (snapshot: ReplacementSnapshot): ReplacementSnapshot => ({
  ...snapshot,
  source: { ...snapshot.source },
  replacements: [...snapshot.replacements],
  diagnostics: [...snapshot.diagnostics],
  ...(snapshot.finalizedBy ? { finalizedBy: { ...snapshot.finalizedBy } } : {}),
});

const sourceForLegacyShift = (
  replacements: CanonicalReplacements,
  shift: ReplacementShift,
): ReplacementPageSource => {
  const source = replacements.sources.find((item) => item.shift === shift);
  if (source) return { ...source };

  return {
    id: `legacy-${shift}`,
    fileName: `legacy-${shift}.html`,
    sha256: sha256(`legacy\0${shift}`),
    fetchedAt: replacements.generatedAt,
    shift,
  };
};

/**
 * Преобразует старую агрегированную запись даты в независимые mutable-снимки.
 *
 * До schema v5 raw-замены первой и второй смены находились только в одном
 * массиве `replacements`; при первом новом запуске они не должны пропасть.
 */
const migrateLegacyDate = (
  replacements: CanonicalReplacements,
  date: ReplacementDate,
): ReplacementDate => {
  if (date.shifts) {
    const shifts = Object.fromEntries(
      Object.entries(date.shifts).map(([shift, snapshot]) => [
        shift,
        snapshot ? cloneSnapshot(snapshot) : snapshot,
      ]),
    ) as NonNullable<ReplacementDate['shifts']>;
    return {
      ...date,
      shifts,
      replacements: [...date.replacements],
    };
  }

  const shifts = Object.fromEntries(
    shiftOrder.flatMap((shift) => {
      const shiftReplacements = date.replacements.filter(
        (replacement) => replacement.source.shift === shift,
      );
      if (!shiftReplacements.length) return [];
      const source = sourceForLegacyShift(replacements, shift);
      return [
        [
          shift,
          {
            date: date.date,
            day: date.day,
            weekType: date.weekType,
            shift,
            status: 'mutable',
            source,
            replacements: shiftReplacements,
            diagnostics: replacements.diagnostics.filter(
              (diagnostic) => diagnostic.sourceId === source.id,
            ),
          } satisfies ReplacementSnapshot,
        ],
      ];
    }),
  ) as ReplacementDate['shifts'];

  return shifts
    ? {
        ...date,
        shifts,
        replacements: [...date.replacements],
      }
    : { ...date, replacements: [...date.replacements] };
};

const migrateLegacyDates = (
  replacements: CanonicalReplacements | null,
): CanonicalReplacements['dates'] => {
  if (!replacements) return {};
  return Object.fromEntries(
    Object.entries(replacements.dates).map(([date, value]) => [
      date,
      migrateLegacyDate(replacements, value),
    ]),
  );
};

const snapshotFromPage = (
  input: ReplacementPageSnapshotInput,
): ReplacementSnapshot | null => {
  const { parsed, source } = input;
  if (!parsed.date || !parsed.day) return null;
  return {
    date: parsed.date,
    day: parsed.day,
    weekType: parsed.weekType,
    shift: parsed.shift,
    status: 'mutable',
    source: { ...source },
    replacements: [...parsed.replacements],
    diagnostics: parsed.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      sourceId: source.id,
      ...(source.url ? { sourceUrl: source.url } : {}),
    })),
  };
};

const snapshotReappearanceDiagnostic = (
  snapshot: ReplacementSnapshot,
  next: ReplacementSnapshot,
): Diagnostic =>
  createDiagnostic({
    code: 'REPLACEMENT_FINALIZED_SNAPSHOT_REAPPEARED',
    severity: 'warning',
    message:
      'Страница замен снова указала дату уже финализированного снимка; история не перезаписана',
    sheet: `Замены: ${next.shift === 'first' ? 'Первая смена' : 'Вторая смена'}`,
    context: {
      date: next.date,
      shift: next.shift,
      finalizedSourceSha256: snapshot.source.sha256,
      receivedSourceSha256: next.source.sha256,
    },
    fingerprintContext: [
      'replacements',
      'finalized-snapshot-reappeared',
      next.date,
      next.shift,
      snapshot.source.sha256,
      next.source.sha256,
    ],
  });

const staleSnapshotDiagnostic = (
  latest: ReplacementSnapshot,
  next: ReplacementSnapshot,
): Diagnostic =>
  createDiagnostic({
    code: 'REPLACEMENT_STALE_SNAPSHOT',
    severity: 'warning',
    message:
      'Страница замен указала более раннюю дату, чем уже опубликованный снимок этой смены; данные не применены',
    sheet: `Замены: ${next.shift === 'first' ? 'Первая смена' : 'Вторая смена'}`,
    context: {
      latestDate: latest.date,
      receivedDate: next.date,
      shift: next.shift,
    },
    fingerprintContext: [
      'replacements',
      'stale-snapshot',
      latest.date,
      next.date,
      next.shift,
    ],
  });

const crossShiftDiagnostic = (
  selected: ReplacementSnapshot,
  candidate: ReplacementSnapshot,
): Diagnostic =>
  createDiagnostic({
    code: 'UNKNOWN_REPLACEMENT_LAYOUT',
    severity: 'error',
    message:
      'Снимки замен одной даты содержат несовместимые день недели или тип недели',
    sheet: `Замены: ${candidate.shift === 'first' ? 'Первая смена' : 'Вторая смена'}`,
    rawValue: `${selected.day} / ${selected.weekType}; ${candidate.day} / ${candidate.weekType}`,
    context: {
      date: candidate.date,
      selectedShift: selected.shift,
      candidateShift: candidate.shift,
    },
    fingerprintContext: [
      'replacements',
      'cross-shift-layout',
      candidate.date,
      selected.shift,
      selected.day,
      selected.weekType,
      candidate.shift,
      candidate.day,
      candidate.weekType,
    ],
  });

const dateSnapshots = (date: ReplacementDate): ReplacementSnapshot[] =>
  Object.values(date.shifts ?? {})
    .filter((snapshot): snapshot is ReplacementSnapshot => Boolean(snapshot))
    .sort(compareSnapshots);

/**
 * Пересобирает агрегированное legacy-поле `replacements` и общую диагностику.
 *
 * `shifts` — источник истины. Агрегированный массив остается для простого
 * потребления JSON и обратной совместимости клиентов.
 */
const rebuildDateViews = (
  dates: CanonicalReplacements['dates'],
  mergeDiagnostics: readonly Diagnostic[],
): { dates: CanonicalReplacements['dates']; diagnostics: Diagnostic[] } => {
  const diagnostics = [...mergeDiagnostics];
  const result: CanonicalReplacements['dates'] = {};

  for (const [date, value] of Object.entries(dates).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const snapshots = dateSnapshots(value);
    const selected = snapshots[0];
    if (!selected) continue;

    const accepted = snapshots.filter((snapshot) => {
      const compatible =
        snapshot.day === selected.day &&
        snapshot.weekType === selected.weekType;
      if (!compatible)
        diagnostics.push(crossShiftDiagnostic(selected, snapshot));
      return compatible;
    });

    for (const snapshot of snapshots)
      diagnostics.push(...snapshot.diagnostics.map((item) => ({ ...item })));

    result[date] = {
      date,
      day: selected.day,
      weekType: selected.weekType,
      shifts: Object.fromEntries(
        snapshots.map((snapshot) => [snapshot.shift, cloneSnapshot(snapshot)]),
      ),
      replacements: accepted.flatMap((snapshot) => snapshot.replacements),
    };
  }

  return { dates: result, diagnostics };
};

/**
 * Объединяет опубликованную историю со свежими HTML-страницами.
 *
 * Интерфейс модуля намеренно мал: вызывающий код передает прошлую выгрузку и
 * два разобранных снимка, а здесь остаются миграция legacy-формата,
 * финализация, защита от stale-страниц и агрегация для публичного JSON.
 */
export const mergeReplacementHistory = (
  previous: CanonicalReplacements | null,
  pages: readonly ReplacementPageSnapshotInput[],
): ReplacementHistoryMergeResult => {
  const dates = migrateLegacyDates(previous);
  const mergeDiagnostics: Diagnostic[] = [];

  for (const page of pages) {
    const next = snapshotFromPage(page);
    if (!next) continue;

    const currentDate = dates[next.date] ?? {
      date: next.date,
      day: next.day,
      weekType: next.weekType,
      shifts: {},
      replacements: [],
    };
    const existing = currentDate.shifts?.[next.shift];

    if (existing?.status === 'finalized') {
      mergeDiagnostics.push(snapshotReappearanceDiagnostic(existing, next));
      continue;
    }

    const sameShiftSnapshots = Object.values(dates)
      .flatMap((date) => dateSnapshots(date))
      .filter((snapshot) => snapshot.shift === next.shift);
    const latest = sameShiftSnapshots
      .filter((snapshot) => snapshot.date > next.date)
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    if (latest) {
      mergeDiagnostics.push(staleSnapshotDiagnostic(latest, next));
      continue;
    }

    // Повторное чтение неизменной локальной или удаленной страницы не должно
    // менять групповые артефакты только из-за нового времени загрузки.
    if (existing?.source.sha256 === next.source.sha256)
      next.source.fetchedAt = existing.source.fetchedAt;

    currentDate.shifts = {
      ...currentDate.shifts,
      [next.shift]: next,
    };
    dates[next.date] = currentDate;

    for (const [date, value] of Object.entries(dates)) {
      if (date >= next.date) continue;
      const older = value.shifts?.[next.shift];
      if (!older || older.status === 'finalized') continue;
      older.status = 'finalized';
      older.finalizedBy = {
        date: next.date,
        sourceId: next.source.id,
        sourceSha256: next.source.sha256,
      };
    }
  }

  return rebuildDateViews(dates, mergeDiagnostics);
};

/**
 * Возвращает снимки даты, которые можно безопасно накладывать на базовую
 * неделю. Несовместимая вторая смена остается в raw-history и diagnostics,
 * но не меняет actual-расписание.
 */
export const compatibleReplacementSnapshots = (
  date: ReplacementDate,
): ReplacementSnapshot[] => {
  const snapshots = dateSnapshots(date);
  const selected = snapshots[0];
  if (!selected) return [];
  return snapshots.filter(
    (snapshot) =>
      snapshot.day === selected.day && snapshot.weekType === selected.weekType,
  );
};
