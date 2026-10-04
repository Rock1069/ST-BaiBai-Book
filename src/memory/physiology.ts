/**
 * 柏宝书 RP 生理状态。确定性重放，所有时间来自故事，不使用现实时间。
 * 孕期分段参考 BS-BioTracker (Liuuuu54, Apache-2.0)，本模块为适配叶子账本的重写。
 */
export const NEED_LABELS = { hunger: '饥饿', thirst: '口渴', fatigue: '疲劳' } as const;
export type NeedKey = keyof typeof NEED_LABELS;
export type BioEventKind = 'meal' | 'drink' | 'sleep' | 'exertion' | 'discomfort' | 'recovery' | 'cycle_start' | 'pregnancy_confirm' | 'birth' | 'pregnancy_end' | 'note';
export const BIO_EVENT_LABELS: Record<BioEventKind, string> = {
  meal: '进食', drink: '饮水', sleep: '睡眠', exertion: '劳累', discomfort: '身体不适',
  recovery: '恢复', cycle_start: '经期开始', pregnancy_confirm: '确认怀孕', birth: '分娩', pregnancy_end: '孕期结束', note: '身体记录',
};
export interface BioTimelineEntry { id: string; time: string; kind: string; text: string; source: 'story' | 'manual' | 'clock' }
export interface BioProfile {
  /** user 指主角，其余为 NPC 名册中的确切名字。 */
  subject: string;
  enabled: boolean;
  notes: string;
  cycle: { enabled: boolean; lengthDays: number; periodDays: number; day: number | null };
  pregnancy: { enabled: boolean; status: 'none' | 'pregnant' | 'postpartum'; days: number | null; dueDays: number };
  needs: Record<NeedKey, number | null>;
  autoNeeds: boolean;
  clock: string;
  /** 相对时间已结算、尚未被绝对时间追上的分钟数，避免同一段时间重复推进。 */
  clockDebt: number;
  timeline: BioTimelineEntry[];
}
export type BioPatch = Partial<Pick<BioProfile, 'enabled' | 'notes' | 'autoNeeds'>> & {
  cycle?: Partial<BioProfile['cycle']>; pregnancy?: Partial<BioProfile['pregnancy']>; needs?: Partial<BioProfile['needs']>;
};
export interface BioObservation { subject: string; kind: BioEventKind; text?: string; days?: number; evidence: string }
export interface BioSummary { elapsedMinutes?: number; elapsedEvidence?: string; events?: BioObservation[] }
export type BioOp =
  | { op: 'configure'; subject: string; patch: BioPatch }
  | { op: 'remove'; subject: string }
  | { op: 'rename'; subject: string; name: string }
  | { op: 'restore'; profile: BioProfile }
  | { op: 'advance'; minutes: number }
  | { op: 'event'; subject: string; kind: BioEventKind; text?: string; days?: number; source: 'story' | 'manual' };
export interface BioDelta { elapsedMinutes?: number; ops?: BioOp[] }
const norm = (s: string): string => s.trim().toLowerCase();
export const sameBioSubject = (a: string, b: string): boolean => norm(a) === norm(b);
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 800): string => typeof v === 'string' ? v.trim().slice(0, max) : '';
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
export function emptyBioProfile(subject: string, time = ''): BioProfile {
  return { subject, enabled: true, notes: '', cycle: { enabled: false, lengthDays: 28, periodDays: 5, day: null },
    pregnancy: { enabled: false, status: 'none', days: null, dueDays: 280 }, needs: { hunger: null, thirst: null, fatigue: null },
    autoNeeds: true, clock: time, clockDebt: 0, timeline: [] };
}
export function cleanBioPatch(raw: unknown): BioPatch {
  if (!record(raw)) return {};
  const p: BioPatch = {};
  for (const key of ['enabled', 'autoNeeds'] as const) if (typeof raw[key] === 'boolean') p[key] = raw[key];
  if (typeof raw.notes === 'string') p.notes = str(raw.notes);
  if (record(raw.cycle)) {
    const c = raw.cycle; p.cycle = {};
    if (typeof c.enabled === 'boolean') p.cycle.enabled = c.enabled;
    if (num(c.lengthDays) !== undefined) p.cycle.lengthDays = clamp(Math.round(c.lengthDays as number), 2, 365);
    if (num(c.periodDays) !== undefined) p.cycle.periodDays = clamp(Math.round(c.periodDays as number), 1, 365);
    if (c.day === null || num(c.day) !== undefined) p.cycle.day = c.day === null ? null : clamp(c.day as number, 1, 365);
  }
  if (record(raw.pregnancy)) {
    const g = raw.pregnancy; p.pregnancy = {};
    if (typeof g.enabled === 'boolean') p.pregnancy.enabled = g.enabled;
    if (g.status === 'none' || g.status === 'pregnant' || g.status === 'postpartum') p.pregnancy.status = g.status;
    if (g.days === null || num(g.days) !== undefined) p.pregnancy.days = g.days === null ? null : clamp(g.days as number, 0, 36500);
    if (num(g.dueDays) !== undefined) p.pregnancy.dueDays = clamp(Math.round(g.dueDays as number), 1, 1000);
  }
  if (record(raw.needs)) {
    p.needs = {};
    for (const key of Object.keys(NEED_LABELS) as NeedKey[]) {
      const n = raw.needs[key]; if (n === null || num(n) !== undefined) p.needs[key] = n === null ? null : clamp(n as number, 0, 100);
    }
  }
  return p;
}
function patchProfile(p: BioProfile, patch: BioPatch): void {
  if (patch.enabled !== undefined) p.enabled = patch.enabled;
  if (patch.autoNeeds !== undefined) p.autoNeeds = patch.autoNeeds;
  if (patch.notes !== undefined) p.notes = patch.notes;
  Object.assign(p.cycle, patch.cycle); Object.assign(p.pregnancy, patch.pregnancy); Object.assign(p.needs, patch.needs);
  p.cycle.periodDays = Math.min(p.cycle.periodDays, p.cycle.lengthDays);
  if (p.cycle.day !== null) p.cycle.day = 1 + (p.cycle.day - 1) % p.cycle.lengthDays;
  if (p.pregnancy.status === 'none') p.pregnancy.days = null;
}
export function cleanBioDelta(raw: unknown): BioDelta {
  if (!record(raw)) return {};
  const out: BioDelta = {};
  if (num(raw.elapsedMinutes) !== undefined && (raw.elapsedMinutes as number) > 0) out.elapsedMinutes = clamp(raw.elapsedMinutes as number, 0, 5256000);
  if (!Array.isArray(raw.ops)) return out;
  const ops: BioOp[] = [];
  for (const r of raw.ops) {
    if (!record(r)) continue;
    const subject = str(r.subject, 160);
    if (r.op === 'configure' && subject) ops.push({ op: 'configure', subject, patch: cleanBioPatch(r.patch) });
    if (r.op === 'remove' && subject) ops.push({ op: 'remove', subject });
    if (r.op === 'rename' && subject && str(r.name, 160)) ops.push({ op: 'rename', subject, name: str(r.name, 160) });
    if (r.op === 'advance' && num(r.minutes) !== undefined && (r.minutes as number) > 0) ops.push({ op: 'advance', minutes: clamp(r.minutes as number, 0, 5256000) });
    if (r.op === 'event' && subject && typeof r.kind === 'string' && Object.hasOwn(BIO_EVENT_LABELS, r.kind)) {
      ops.push({ op: 'event', subject, kind: r.kind as BioEventKind, text: str(r.text), days: num(r.days) === undefined ? undefined : clamp(r.days as number, 0, 36500), source: r.source === 'manual' ? 'manual' : 'story' });
    }
    if (r.op === 'restore' && record(r.profile) && str(r.profile.subject, 160)) {
      const p = emptyBioProfile(str(r.profile.subject, 160), str(r.profile.clock));
      patchProfile(p, cleanBioPatch(r.profile));
      p.clockDebt = clamp(num(r.profile.clockDebt) ?? 0, 0, 5256000);
      p.timeline = Array.isArray(r.profile.timeline) ? r.profile.timeline.filter(record).slice(-100).map(e => ({ id: str(e.id), time: str(e.time), kind: str(e.kind), text: str(e.text), source: e.source === 'manual' ? 'manual' : e.source === 'clock' ? 'clock' : 'story' })) : [];
      ops.push({ op: 'restore', profile: p });
    }
  }
  if (ops.length) out.ops = ops;
  return out;
}

/** 仅数值年月日可安全做时间运算；架空纪年按同一前缀匹配，月份名/时辰不猜。 */
export function bioClock(time: string): { minute: number; calendar: string; precision: string } | null {
  const match = time.trim().match(/^(.*?)(\d{1,4})(?:年|[\/.-])(\d{1,2})(?:月|[\/.-])(\d{1,2})(?:日)?(?:[\sT]+(\d{1,2}):(\d{2}))?(?:\s*(?:周[一二三四五六日天]|星期[一二三四五六日天]))?$/);
  if (!match) return null;
  const [, prefix, y, m, d, h, min] = match;
  const year = Number(y), month = Number(m), day = Number(d), hour = Number(h ?? 0), minute = Number(min ?? 0);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { minute: date.getTime() / 60000, calendar: prefix.trim(), precision: h === undefined ? 'day' : 'minute' };
}
export function cyclePhase(p: BioProfile): string {
  if (!p.cycle.enabled) return '未启用';
  if (p.pregnancy.enabled && p.pregnancy.status !== 'none') return '暂停（孕期／产后）';
  if (p.cycle.day === null) return '待校准';
  const day = Math.floor(p.cycle.day);
  if (day <= p.cycle.periodDays) return '月经期';
  const ovulation = Math.max(p.cycle.periodDays + 1, p.cycle.lengthDays - 14);
  if (day < ovulation) return '卵泡期';
  if (day <= ovulation + 1) return '排卵期';
  return '黄体期';
}
export function pregnancyPhase(p: BioProfile): string {
  if (!p.pregnancy.enabled) return '未启用';
  if (p.pregnancy.status === 'none') return '未登记怀孕';
  if (p.pregnancy.status === 'postpartum') return '产后';
  const day = p.pregnancy.days;
  if (day === null) return '孕期天数待校准';
  // 将 BioTracker 的 14/28/37/40 周分段按用户设置的孕期长度缩放。
  const scaled = day * 280 / p.pregnancy.dueDays;
  return scaled < 98 ? '孕早期' : scaled < 196 ? '孕中期' : scaled < 259 ? '孕晚期' : scaled <= 280 ? '临产期' : '逾期';
}
function stage(p: BioProfile): string { return `${cyclePhase(p)}／${pregnancyPhase(p)}`; }
function advance(p: BioProfile, minutes: number): void {
  if (!p.enabled || minutes <= 0) return;
  const days = minutes / 1440;
  if (p.pregnancy.enabled && p.pregnancy.status !== 'none') {
    if (p.pregnancy.days !== null) p.pregnancy.days = Math.min(36500, p.pregnancy.days + days);
  } else if (p.cycle.enabled && p.cycle.day !== null) p.cycle.day = 1 + (p.cycle.day - 1 + days) % p.cycle.lengthDays;
  if (p.autoNeeds) for (const key of Object.keys(NEED_LABELS) as NeedKey[]) {
    if (p.needs[key] !== null) p.needs[key] = clamp(p.needs[key]! + minutes / 60 * ({ hunger: 4, thirst: 6, fatigue: 3 }[key]), 0, 100);
  }
}
function applyEvent(p: BioProfile, e: Extract<BioOp, { op: 'event' }>): boolean {
  if (!p.enabled) return false;
  switch (e.kind) {
    case 'meal': p.needs.hunger = 10; break;
    case 'drink': p.needs.thirst = 10; break;
    case 'sleep': p.needs.fatigue = 10; break;
    case 'exertion': if (p.needs.fatigue !== null) p.needs.fatigue = clamp(p.needs.fatigue + 20, 0, 100); break;
    case 'recovery': if (p.needs.fatigue !== null) p.needs.fatigue = clamp(p.needs.fatigue - 20, 0, 100); break;
    case 'cycle_start':
      if (!p.cycle.enabled || (p.pregnancy.enabled && p.pregnancy.status === 'pregnant')) return false;
      p.cycle.day = 1; if (p.pregnancy.status === 'postpartum') { p.pregnancy.status = 'none'; p.pregnancy.days = null; } break;
    case 'pregnancy_confirm':
      if (!p.pregnancy.enabled) return false;
      if (p.pregnancy.status !== 'pregnant') { p.pregnancy.status = 'pregnant'; p.pregnancy.days = e.days ?? null; }
      else if (e.days !== undefined) p.pregnancy.days = e.days; break;
    case 'birth':
      if (!p.pregnancy.enabled || p.pregnancy.status !== 'pregnant') return false;
      p.pregnancy.status = 'postpartum'; p.pregnancy.days = 0; break;
    case 'pregnancy_end':
      if (!p.pregnancy.enabled || p.pregnancy.status === 'none') return false;
      p.pregnancy.status = 'none'; p.pregnancy.days = null; p.cycle.day = null; break;
  }
  return true;
}

/** 按叶子顺序施加自动时间与操作；同一叶子反复重放不会累计。 */
export function applyBioDelta(profiles: BioProfile[], raw: BioDelta | undefined, time: string, leafId: string, knownSubjects: string[]): void {
  const delta = cleanBioDelta(raw);
  // 名册分桶先完成改名；同叶子的档案仍按操作顺序重放，允许初始化旧名再迁移。
  const admissible = new Set(knownSubjects.map(norm));
  for (const op of [...(delta.ops ?? [])].reverse()) {
    if (op.op === 'rename' && admissible.has(norm(op.name))) admissible.add(norm(op.subject));
  }
  let seq = 0;
  const log = (p: BioProfile, kind: string, text: string, source: BioTimelineEntry['source']): void => {
    p.timeline.push({ id: `bio:${leafId}:${seq++}`, time, kind, text, source }); p.timeline = p.timeline.slice(-100);
  };
  for (const p of profiles) {
    const before = stage(p);
    const old = bioClock(p.clock), next = bioClock(time);
    let elapsed = 0;
    const comparable = old && next && old.calendar === next.calendar && old.precision === next.precision;
    if (comparable && next.minute > old.minute) {
      const diff = next.minute - old.minute;
      elapsed = Math.max(0, diff - p.clockDebt); p.clockDebt = Math.max(0, p.clockDebt - diff);
    } else if (comparable && next.minute < old.minute) {
      // 故事倒叙/改纪年仅换锚点，不能把生理状态反向计时。
      p.clockDebt = 0;
    } else if (delta.elapsedMinutes && (!comparable || next.minute === old.minute)) {
      elapsed = delta.elapsedMinutes; p.clockDebt += elapsed;
    }
    if (next) {
      if (!comparable) p.clockDebt = 0;
      p.clock = time;
    }
    if (p.enabled) advance(p, elapsed); else p.clockDebt = 0;
    if (before !== stage(p)) log(p, 'stage', `${before} → ${stage(p)}（推进约${Math.round(elapsed / 60 * 10) / 10}小时）`, 'clock');
    else if (elapsed >= 1440 && p.enabled && (p.cycle.enabled || p.pregnancy.enabled)) log(p, 'time', `故事时间推进约${Math.round(elapsed / 1440 * 10) / 10}天；${bioStatus(p)}`, 'clock');
  }
  for (const op of delta.ops ?? []) {
    if (op.op === 'restore') {
      const at = profiles.findIndex(p => sameBioSubject(p.subject, op.profile.subject));
      const restored = structuredClone(op.profile); if (at < 0) profiles.push(restored); else profiles[at] = restored; continue;
    }
    if (op.op === 'advance') {
      for (const p of profiles.filter(p => p.enabled)) { advance(p, op.minutes); p.clockDebt += op.minutes; log(p, 'time', `手动推进${Math.round(op.minutes / 60 * 10) / 10}小时；${bioStatus(p)}`, 'manual'); } continue;
    }
    let p = profiles.find(x => sameBioSubject(x.subject, op.subject));
    if (op.op === 'remove') { if (p) profiles.splice(profiles.indexOf(p), 1); continue; }
    if (op.op === 'rename') { if (p) p.subject = op.name; continue; }
    if (op.op === 'configure') {
      if (!p) {
        if (!admissible.has(norm(op.subject))) continue;
        p = emptyBioProfile(op.subject, time); profiles.push(p);
      }
      patchProfile(p, op.patch); log(p, 'profile', `手动校准档案；${bioStatus(p)}`, 'manual'); continue;
    }
    if (p && applyEvent(p, op)) log(p, op.kind, op.text || BIO_EVENT_LABELS[op.kind], op.source);
  }
}

/** 仅从本轮正文核验逐字证据，且 AI 无权创建/开启档案或写自由数值补丁。 */
export function groundedBioDelta(raw: unknown, source: string, profiles: BioProfile[]): BioDelta {
  if (!record(raw) || !profiles.some(p => p.enabled)) return {};
  const out: BioDelta = {};
  const grounded = (e: unknown): boolean => { const s = str(e); return s.length >= 4 && source.includes(s); };
  if (num(raw.elapsedMinutes) !== undefined && (raw.elapsedMinutes as number) > 0 && grounded(raw.elapsedEvidence)) out.elapsedMinutes = clamp(raw.elapsedMinutes as number, 0, 5256000);
  if (Array.isArray(raw.events)) {
    const seen = new Set<string>();
    out.ops = raw.events.filter(record).flatMap(e => {
      const p = profiles.find(p => p.enabled && sameBioSubject(p.subject, str(e.subject, 160)));
      if (!p || !grounded(e.evidence) || typeof e.kind !== 'string' || !Object.hasOwn(BIO_EVENT_LABELS, e.kind)) return [];
      const evidence = str(e.evidence);
      // 重大身体事件的猜测/计划不能被模型写成既成事实。
      if (['pregnancy_confirm', 'birth', 'pregnancy_end'].includes(e.kind)
        && /可能|疑似|怀疑|如果|假如|也许|将会|计划|打算|梦见|梦中|推演|建议|希望|想让|might|maybe|suspect|would|plans? to|dream/i.test(evidence)) return [];
      // 明确提及另一个已开启人物、却未提及当前人物时，拒绝跨人物移植。
      if (p.subject !== 'user' && !evidence.toLowerCase().includes(norm(p.subject))
        && profiles.some(other => other.subject !== 'user' && !sameBioSubject(other.subject, p.subject) && evidence.toLowerCase().includes(norm(other.subject)))) return [];
      const key = `${norm(p.subject)}:${e.kind}:${str(e.evidence)}`; if (seen.has(key)) return []; seen.add(key);
      // 天数仅在证据确有相同数值时采纳；缺少天数的确认事件保持未知。
      const days = num(e.days);
      const explicitDays = days !== undefined && e.kind === 'pregnancy_confirm'
        && [...evidence.matchAll(/(\d+(?:\.\d+)?)\s*(?:天|日|days?)/gi)].some(m => Number(m[1]) === days) ? clamp(days, 0, 36500) : undefined;
      return [{ op: 'event' as const, subject: p.subject, kind: e.kind as BioEventKind, text: str(e.text) || evidence, days: explicitDays, source: 'story' as const }];
    });
    if (!out.ops.length) delete out.ops;
  }
  return out;
}
export function bioStatus(p: BioProfile): string {
  const bits: string[] = [];
  if (p.cycle.enabled) bits.push(`周期${p.cycle.day === null ? '天数未知' : `第${Math.floor(p.cycle.day)}天/${p.cycle.lengthDays}天`}·${cyclePhase(p)}`);
  if (p.pregnancy.enabled) {
    let g = pregnancyPhase(p);
    if (p.pregnancy.status !== 'none' && p.pregnancy.days !== null) g += `第${Math.floor(p.pregnancy.days)}天`;
    if (p.pregnancy.status === 'pregnant' && p.pregnancy.days !== null) g += `（距预计孕期结束${Math.max(0, Math.ceil(p.pregnancy.dueDays - p.pregnancy.days))}天）`;
    bits.push(g);
  }
  for (const key of Object.keys(NEED_LABELS) as NeedKey[]) bits.push(`${NEED_LABELS[key]}:${p.needs[key] === null ? '未知' : `${Math.round(p.needs[key]!)} /100`}`);
  return bits.join('；');
}
export function formatBioProfiles(profiles: BioProfile[], user = '主角'): string {
  return profiles.filter(p => p.enabled).map(p => `- ${p.subject === 'user' ? user : p.subject} [subject=${p.subject}]：${bioStatus(p)}${p.notes ? `；档案:${p.notes.replace(/\s+/g, ' ')}` : ''}`).join('\n');
}
