/** 仅数值年月日可安全做时间运算；架空纪年按同一前缀匹配，月份名/时辰不猜。 */
export function parseStoryClock(time: string): { minute: number; calendar: string; precision: string } | null {
  const match = time.trim().match(/^(.*?)(\d{1,4})(?:年|[\/.-])(\d{1,2})(?:月|[\/.-])(\d{1,2})(?:日)?(?:[\sT]+(\d{1,2}):(\d{2}))?(?:\s*(?:周[一二三四五六日天]|星期[一二三四五六日天]))?$/);
  if (!match) return null;
  const [, prefix, y, m, d, h, min] = match;
  const year = Number(y), month = Number(m), day = Number(d), hour = Number(h ?? 0), minute = Number(min ?? 0);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { minute: date.getTime() / 60000, calendar: prefix.trim(), precision: h === undefined ? 'day' : 'minute' };
}
