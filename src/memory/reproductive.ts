import type { PregnancyDating, ReproductiveDelta, ReproductivePatch, ReproductiveProfile } from './types';

const DAY_MS = 86_400_000;
const line = (value: unknown, max = 120): string => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const cycleTypes = new Set(['human', 'nonhuman', 'unknown']);
const regularities = new Set(['regular', 'irregular', 'unknown']);
const pregnancyStatuses = new Set(['unknown', 'confirmed', 'ended']);
const datingBases = new Set(['ultrasoundDueDate', 'lastPeriod', 'conception']);

/** 公历日期严格校验，不用 Date.parse 猜架空纪年或自动修正 2 月 30 日。 */
export function parseGregorianDate(value: unknown): string | null {
  const match = line(value, 40).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** 取故事时间里的最后一个完整公历日期；架空日期保持未知。 */
export function storyGregorianDate(time: string | undefined): string | null {
  const dates = [...(time ?? '').matchAll(/(\d{4}(?:[-/]\d{1,2}[-/]\d{1,2}|年\d{1,2}月\d{1,2}日))/g)];
  const last = dates.at(-1)?.[1]?.replace(/[年月]/g, '-').replace(/日$/, '');
  return last ? parseGregorianDate(last) : null;
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}
function dayDiff(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function dateMentioned(text: string, date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  return new RegExp(`${year}[-/]0?${month}[-/]0?${day}(?!\\d)`).test(text)
    || new RegExp(`${year}年0?${month}月0?${day}日`).test(text);
}

function cleanDating(raw: unknown): PregnancyDating | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const date = parseGregorianDate(r.date);
  if (!date || !datingBases.has(r.basis as string)) return null;
  return { basis: r.basis as PregnancyDating['basis'], date };
}

export function cleanReproductivePatch(raw: unknown): ReproductivePatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const subject = line(r.subject, 80);
  if (!subject) return null;
  const out: ReproductivePatch = { subject };
  if (cycleTypes.has(r.cycleType as string)) out.cycleType = r.cycleType as ReproductivePatch['cycleType'];
  if (regularities.has(r.regularity as string)) out.regularity = r.regularity as ReproductivePatch['regularity'];
  if (pregnancyStatuses.has(r.pregnancyStatus as string)) out.pregnancyStatus = r.pregnancyStatus as ReproductivePatch['pregnancyStatus'];
  if (r.lastPeriodStart === null) out.lastPeriodStart = null;
  else {
    const date = parseGregorianDate(r.lastPeriodStart);
    if (date) out.lastPeriodStart = date;
  }
  if (r.cycleLengthDays === null) out.cycleLengthDays = null;
  else if (Number.isInteger(r.cycleLengthDays) && Number(r.cycleLengthDays) >= 15 && Number(r.cycleLengthDays) <= 60)
    out.cycleLengthDays = Number(r.cycleLengthDays);
  if (r.periodLengthDays === null) out.periodLengthDays = null;
  else if (Number.isInteger(r.periodLengthDays) && Number(r.periodLengthDays) >= 1 && Number(r.periodLengthDays) <= 10)
    out.periodLengthDays = Number(r.periodLengthDays);
  if (r.dating === null) out.dating = null;
  else {
    const dating = cleanDating(r.dating);
    if (dating) out.dating = dating;
  }
  const source = line(r.source, 160);
  if (source) out.source = source;
  return Object.keys(out).some(key => key !== 'subject' && key !== 'source') ? out : null;
}

export function cleanReproductiveDelta(raw: unknown): ReproductiveDelta {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const upsert = (Array.isArray(r.upsert) ? r.upsert.slice(0, 30) : [])
    .map(cleanReproductivePatch).filter((p): p is ReproductivePatch => !!p);
  const remove = (Array.isArray(r.remove) ? r.remove.slice(0, 30) : [])
    .map(x => line(x, 80)).filter(Boolean);
  return { ...(upsert.length ? { upsert } : {}), ...(remove.length ? { remove } : {}) };
}

/** 参考资料只能确认人类/非人类生理类别；经期锚点与怀孕状态必须来自已发生正文。 */
export function groundedReproductive(raw: unknown, story: string, references: string): ReproductiveDelta {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const upsert: ReproductivePatch[] = [];
  const storyFlat = story.replace(/\s+/g, ' ');
  const refFlat = references.replace(/\s+/g, ' ');
  for (const item of Array.isArray(r.upsert) ? r.upsert.slice(0, 12) : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const evidence = line(record.evidence, 240);
    const patch = cleanReproductivePatch(record);
    if (!patch || evidence.length < 4) continue;
    const storyAt = storyFlat.indexOf(evidence);
    const refAt = refFlat.indexOf(evidence);
    const inStory = storyAt >= 0;
    if (!inStory && refAt < 0) continue;
    const sectionStart = Math.max(storyFlat.lastIndexOf('【角色·', storyAt), storyFlat.lastIndexOf('【用户·', storyAt), 0);
    const nextRole = storyFlat.slice(storyAt + evidence.length).search(/【(?:角色|用户)·/);
    const storySection = inStory ? storyFlat.slice(sectionStart,
      nextRole < 0 ? undefined : storyAt + evidence.length + nextRole) : '';
    // 私密事实必须在同一句明确指向该角色；仅凭邻近段落或代词容易串到别人。
    if (!evidence.includes(patch.subject)) continue;
    if (!inStory) {
      // 角色卡/世界书可能是旧设定或物种通则，不能覆盖当下经期或确认怀孕。
      if (!patch.cycleType || patch.cycleType === 'unknown' || !/人类|human|非人类|非人族|精灵|兽人|机器人|妖|魔族|吸血鬼|龙族/i.test(evidence)) continue;
      upsert.push({ subject: patch.subject, cycleType: patch.cycleType, source: '角色卡/世界书' });
      continue;
    }
    if (patch.lastPeriodStart && !/月经|经期|例假|生理期|period|menstrual/i.test(evidence)) delete patch.lastPeriodStart;
    if (patch.lastPeriodStart && /预计|预估|可能|下次|预计会|expected|might/i.test(evidence)) delete patch.lastPeriodStart;
    if (patch.lastPeriodStart && /没有来|没来|未到|停经|迟经|月经推迟|并未开始|no period|missed period/i.test(evidence)) delete patch.lastPeriodStart;
    if (patch.lastPeriodStart && !dateMentioned(storySection, patch.lastPeriodStart)) delete patch.lastPeriodStart;
    if (patch.dating && !dateMentioned(storySection, patch.dating.date)) delete patch.dating;
    if (patch.dating && !/怀孕|妊娠|受孕|预产期|超声|pregnan|conception|due date|ultrasound/i.test(evidence)) delete patch.dating;
    if (patch.cycleLengthDays && (!/周期|cycle/i.test(evidence) || !evidence.includes(String(patch.cycleLengthDays)))) delete patch.cycleLengthDays;
    if (patch.periodLengthDays && (!/经期|月经|例假|生理期|period|menstrual/i.test(evidence)
      || !evidence.includes(String(patch.periodLengthDays)))) delete patch.periodLengthDays;
    if (patch.regularity && patch.regularity !== 'unknown' && !/规律|稳定|不规律|紊乱|regular|irregular/i.test(evidence)) delete patch.regularity;
    if (patch.cycleType && !/人类|human|非人类|非人族|精灵|兽人|机器人|妖|魔族|吸血鬼|龙族/i.test(evidence)) delete patch.cycleType;
    if (patch.cycleType === 'unknown') delete patch.cycleType;
    if (patch.regularity === 'unknown') delete patch.regularity;
    if (patch.pregnancyStatus === 'unknown') delete patch.pregnancyStatus;
    if (patch.pregnancyStatus === 'ended' && !/妊娠结束|流产|分娩|生产|生下|引产|miscarriage|gave birth|delivered/i.test(evidence))
      delete patch.pregnancyStatus;
    if (patch.pregnancyStatus === 'confirmed' && !/怀孕|有孕|妊娠|孕检|验孕|阳性|喜脉|pregnan|positive test/i.test(evidence))
      delete patch.pregnancyStatus;
    if (patch.pregnancyStatus === 'confirmed' && /没有怀孕|没怀孕|未怀孕|并非怀孕|可能|怀疑|担心|梦见|猜测|perhaps|might|suspect|negative test/i.test(evidence))
      delete patch.pregnancyStatus;
    if (Object.keys(patch).some(k => k !== 'subject' && k !== 'source')) upsert.push(patch);
  }
  return upsert.length ? { upsert } : {};
}

export function applyReproductive(target: ReproductiveProfile[], delta: ReproductiveDelta | undefined): void {
  if (!delta) return;
  for (const name of delta.remove ?? []) {
    const index = target.findIndex(p => p.subject.toLowerCase() === name.toLowerCase());
    if (index >= 0) target.splice(index, 1);
  }
  for (const patch of delta.upsert ?? []) {
    let profile = target.find(p => p.subject.toLowerCase() === patch.subject.toLowerCase());
    if (!profile) {
      profile = { subject: patch.subject, cycleType: 'unknown', regularity: 'unknown', pregnancyStatus: 'unknown' };
      target.push(profile);
    }
    if (patch.cycleType !== undefined) profile.cycleType = patch.cycleType;
    if (patch.regularity !== undefined) profile.regularity = patch.regularity;
    if (patch.lastPeriodStart !== undefined) {
      profile.lastPeriodStart = patch.lastPeriodStart || undefined;
      if (patch.lastPeriodStart && profile.pregnancyStatus === 'ended' && patch.pregnancyStatus === undefined)
        profile.pregnancyStatus = 'unknown';
    }
    if (patch.cycleLengthDays !== undefined) profile.cycleLengthDays = patch.cycleLengthDays || undefined;
    if (patch.periodLengthDays !== undefined) profile.periodLengthDays = patch.periodLengthDays || undefined;
    if (patch.pregnancyStatus !== undefined) {
      profile.pregnancyStatus = patch.pregnancyStatus;
      if (patch.pregnancyStatus === 'ended') {
        // 产后/妊娠结束不能沿用孕前日期预测下一次排卵。
        profile.lastPeriodStart = undefined;
        profile.cycleLengthDays = undefined;
        profile.periodLengthDays = undefined;
        profile.regularity = 'unknown';
        profile.dating = undefined;
      }
      if (patch.pregnancyStatus === 'unknown') profile.dating = undefined;
    }
    if (patch.dating !== undefined) profile.dating = profile.pregnancyStatus === 'confirmed' ? patch.dating || undefined : undefined;
    if (patch.source) profile.source = patch.source;
  }
  if (target.length > 40) target.splice(0, target.length - 40);
}

export type ReproductiveProjection =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'pregnancy'; gestationWeeks: number; gestationDays: number; dueDate: string; basis: PregnancyDating['basis'] }
  | { kind: 'cycle'; cycleDay: number; nextPeriodStart: string; periodEnd?: string;
      ovulationFrom: string; ovulationTo: string; possibleFertileFrom: string; possibleFertileTo: string;
      phase: 'estimated-period' | 'possible-fertile' | 'outside-window' };

export function projectReproductive(profile: ReproductiveProfile, storyDate: string | null): ReproductiveProjection {
  if (!storyDate) return { kind: 'unavailable', reason: '故事时间没有完整公历日期' };
  if (profile.cycleType === 'nonhuman') return { kind: 'unavailable', reason: '角色适用非人类生理规则，不能套用人类周期公式' };
  if (profile.cycleType !== 'human') return { kind: 'unavailable', reason: '尚未确认适用人类生理日期算法' };
  if (profile.pregnancyStatus === 'confirmed') {
    const dating = profile.dating;
    if (!dating) return { kind: 'unavailable', reason: '已确认怀孕，但缺少末次月经、受孕日期或超声预产期' };
    const dueDate = dating.basis === 'ultrasoundDueDate' ? dating.date
      : addDays(dating.date, dating.basis === 'lastPeriod' ? 280 : 266);
    const days = 280 - dayDiff(storyDate, dueDate);
    if (days < 0 || days > 294) return { kind: 'unavailable', reason: '孕周超出可用范围，需根据剧情重新确认日期' };
    return { kind: 'pregnancy', gestationWeeks: Math.floor(days / 7), gestationDays: days % 7, dueDate, basis: dating.basis };
  }
  if (profile.pregnancyStatus === 'ended') return { kind: 'unavailable', reason: '妊娠结束后需重新记录实际经期，并重新确认周期是否规律；不能沿用孕前周期' };
  if (!profile.lastPeriodStart || !profile.cycleLengthDays) return { kind: 'unavailable', reason: '缺少已发生的末次月经开始日或周期长度' };
  if (profile.regularity !== 'regular') return { kind: 'unavailable', reason: '周期未确认规律，日历无法可靠推算排卵窗口' };
  if (profile.cycleLengthDays < 26 || profile.cycleLengthDays > 32)
    return { kind: 'unavailable', reason: '周期不在标准日法适用的 26–32 天内，避免标注错误的受孕窗口' };
  const cycleDay = dayDiff(profile.lastPeriodStart, storyDate) + 1;
  if (cycleDay < 1) return { kind: 'unavailable', reason: '故事日期早于记录的月经开始日' };
  if (cycleDay > profile.cycleLengthDays) return { kind: 'unavailable', reason: '已超过预计下次月经日，需记录新的实际经期，不能自动假定已来月经' };
  const nextPeriodStart = addDays(profile.lastPeriodStart, profile.cycleLengthDays);
  // NHS 给出下次月经前约 10–16 天的排卵范围；与 CDC 第 8–19 天取并集，避免虚假“安全日”。
  const ovulationFrom = addDays(nextPeriodStart, -16);
  const ovulationTo = addDays(nextPeriodStart, -10);
  const possibleFertileFrom = dayNumber(addDays(profile.lastPeriodStart, 7)) < dayNumber(addDays(ovulationFrom, -5))
    ? addDays(profile.lastPeriodStart, 7) : addDays(ovulationFrom, -5);
  const possibleFertileTo = dayNumber(addDays(profile.lastPeriodStart, 18)) > dayNumber(addDays(ovulationTo, 1))
    ? addDays(profile.lastPeriodStart, 18) : addDays(ovulationTo, 1);
  const periodEnd = profile.periodLengthDays ? addDays(profile.lastPeriodStart, profile.periodLengthDays - 1) : undefined;
  const phase = periodEnd && storyDate <= periodEnd ? 'estimated-period'
    : storyDate >= possibleFertileFrom && storyDate <= possibleFertileTo ? 'possible-fertile' : 'outside-window';
  return { kind: 'cycle', cycleDay, nextPeriodStart, periodEnd, ovulationFrom, ovulationTo,
    possibleFertileFrom, possibleFertileTo, phase };
}

export function formatReproductiveForModel(profiles: readonly ReproductiveProfile[], storyTime: string): string {
  if (!profiles.length) return '';
  const date = storyGregorianDate(storyTime);
  const rows = profiles.slice(0, 12).map(profile => {
    const parts = [`${profile.subject}:`];
    if (profile.lastPeriodStart) parts.push(`已记录经期首日 ${profile.lastPeriodStart}`);
    if (profile.cycleLengthDays) parts.push(`周期 ${profile.cycleLengthDays} 天(${profile.regularity === 'regular' ? '规律' : '规律性未确认'})`);
    if (profile.pregnancyStatus === 'confirmed') parts.push('正文已确认怀孕');
    else if (profile.pregnancyStatus === 'ended') parts.push('正文已确认妊娠结束');
    const projection = projectReproductive(profile, date);
    if (projection.kind === 'pregnancy') parts.push(`按${projection.basis === 'ultrasoundDueDate' ? '超声预产期' : '日期估算'}孕 ${projection.gestationWeeks}周${projection.gestationDays}天，预产期约 ${projection.dueDate}`);
    if (projection.kind === 'cycle') parts.push(`本周期第${projection.cycleDay}天，可能排卵 ${projection.ovulationFrom}～${projection.ovulationTo}，可能受孕窗口 ${projection.possibleFertileFrom}～${projection.possibleFertileTo}`);
    return parts.join(' ');
  });
  return `【角色生理时间线｜叙述者私密参考】\n${rows.join('\n')}\n仅供相关情节保持时间一致；以上日期为有条件估算，不是诊断、确定排卵日或避孕“安全期”。未明确确认怀孕绝不能因性行为或月经延迟自行判定。此信息不自动成为其他角色已知，遵守角色认知边界，也不要每回合刻意提及。`;
}
