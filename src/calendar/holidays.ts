/** Определяет вид календарной даты по ежегодным праздникам MM-DD. */
export const calendarDayKind = (
  isoDate: string,
  holidays: readonly string[],
): 'holiday' | 'preholiday' | 'regular' => {
  if (holidays.includes(isoDate.slice(5))) return 'holiday';
  const next = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(next.getTime())) throw new Error(`Invalid date: ${isoDate}`);
  next.setUTCDate(next.getUTCDate() + 1);
  return holidays.includes(next.toISOString().slice(5, 10))
    ? 'preholiday'
    : 'regular';
};
