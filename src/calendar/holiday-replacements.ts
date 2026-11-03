interface HolidayVariant {
  subject: string;
  room: string;
  subgroup?: string;
  rawSubject?: string;
}

interface HolidayReplacement {
  type: string;
  raw: string;
  strategy?: string;
}

/** Выбирает варианты, явно подтверждённые текстом замены, не угадывая подгруппу. */
export const selectHolidayVariants = <T extends HolidayVariant>(
  variants: readonly T[],
  baseVariants: readonly HolidayVariant[],
  replacements: readonly HolidayReplacement[],
): { variants: T[]; unmatched: HolidayReplacement[] } => {
  const selected = new Set<T>();
  const unmatched: HolidayReplacement[] = [];
  for (const replacement of replacements) {
    if (replacement.type !== 'add' && replacement.type !== 'replace') continue;
    const candidates = variants.filter((variant) => {
      if (replacement.strategy === 'scheduled-room') {
        const before = baseVariants.filter(
          (item) =>
            item.subject === variant.subject &&
            item.subgroup === variant.subgroup,
        );
        return before.length === 1 && before[0]!.room !== variant.room;
      }
      return (
        variant.subject === replacement.raw ||
        variant.rawSubject === replacement.raw
      );
    });
    if (candidates.length === 1) selected.add(candidates[0]!);
    else unmatched.push(replacement);
  }
  return { variants: [...selected], unmatched };
};
