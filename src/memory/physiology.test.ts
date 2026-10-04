import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiSettings } from '@/api/settings';
import * as context from '@/st/context';
import type { STContext, STMessage } from '@/st/context';
import { appendOpToLatestLeaf, deriveMemory, editNpc } from './apply';
import { getSnapshot, query } from '@/public/query';
import { buildStateInjectionText } from './inject';
import { memory, recomputeDerived } from './store';
import { buildSummaryPrompt } from './prompts';
import { applyBioDelta, bioClock, cleanBioDelta, cyclePhase, emptyBioProfile, groundedBioDelta, pregnancyPhase, type BioProfile } from './physiology';
import { createEmptyMemory, type StoredDelta } from './types';
import { createNewChatWithCarryover } from './carryover';
import * as engine from './engine';
import * as notices from '@/st/toast';

function floor(id: string, delta: StoredDelta, swipe = 0): STMessage {
  return { name: '角色', mes: '已经发生的正文', is_user: false, is_system: false, swipe_id: swipe,
    extra: { bbs_leaf: { id, delta, text: '摘要', createdAt: 1, swipe: 0, v: 1 } } };
}
const start = (): STMessage => floor('a', { time: '2026/9/1 10:00', npcs: { add: [{ name: '艾琳', important: true }] },
  physiology: { ops: [{ op: 'configure', subject: '艾琳', patch: { cycle: { enabled: true, day: 1 }, pregnancy: { enabled: true }, needs: { hunger: 20, thirst: 20, fatigue: 20 } } }] } });
function useChat(chat: STMessage[]): void {
  vi.spyOn(context, 'getContext').mockReturnValue({ chat, name1: '主角', name2: '艾琳', getCurrentChatId: () => 'bio-test', saveChat: vi.fn() } as unknown as STContext);
}
afterEach(() => { vi.restoreAllMocks(); Object.assign(memory, createEmptyMemory()); vi.useRealTimers(); });

describe('生理状态确定性时间结算', () => {
  it('仅可靠数值日期、同一纪年与精度计算；拒绝无效日期和时辰', () => {
    expect(bioClock('2026/2/30 10:00')).toBeNull();
    expect(bioClock('2026/9/1 24:00')).toBeNull();
    expect(bioClock('初春三日午时')).toBeNull();
    expect(bioClock('天元历12年3月1日 10:00')?.calendar).toBe('天元历');
    expect(bioClock('12年3月1日')?.minute).toBeLessThan(0);
    const p = emptyBioProfile('user', '天元历12年3月1日 10:00'); p.cycle = { ...p.cycle, enabled: true, day: 1 };
    applyBioDelta([p], undefined, '天元历12年3月2日 10:00', 'x', ['user']); expect(p.cycle.day).toBe(2);
    applyBioDelta([p], undefined, '公历2026年3月3日 10:00', 'y', ['user']); expect(p.cycle.day).toBe(2);
    applyBioDelta([p], undefined, '2026/3/4', 'z', ['user']); expect(p.cycle.day).toBe(2);
  });
  it('周期累计小时并跨周期回绕；需求封顶，未知值不补猜', () => {
    const p = emptyBioProfile('user', '2026/9/1 10:00');
    p.cycle = { enabled: true, lengthDays: 28, periodDays: 5, day: 28 };
    p.needs = { hunger: 98, thirst: null, fatigue: 20 };
    applyBioDelta([p], undefined, '2026/9/2 22:00', 'x', ['user']);
    expect(p.cycle.day).toBe(1.5); expect(cyclePhase(p)).toBe('月经期');
    expect(p.needs).toEqual({ hunger: 100, thirst: null, fatigue: 100 });
    expect(p.timeline[0].source).toBe('clock');
  });
  it('相对/手动时间被后续绝对日期吸收，不重复推进', () => {
    const p = emptyBioProfile('user', '2026/9/1 10:00'); p.cycle = { ...p.cycle, enabled: true, day: 1 };
    applyBioDelta([p], { elapsedMinutes: 120 }, '2026/9/1 10:00', 'x', ['user']);
    const afterTwo = p.cycle.day;
    applyBioDelta([p], undefined, '2026/9/1 11:00', 'y', ['user']); expect(p.cycle.day).toBe(afterTwo);
    applyBioDelta([p], undefined, '2026/9/1 12:00', 'z', ['user']); expect(p.cycle.day).toBe(afterTwo);
    applyBioDelta([p], { ops: [{ op: 'advance', minutes: 1440 }] }, '2026/9/1 12:00', 'a', ['user']);
    applyBioDelta([p], { elapsedMinutes: 1440 }, '2026/9/2 12:00', 'b', ['user']);
    expect(p.cycle.day).toBeCloseTo(afterTwo! + 1); expect(p.clockDebt).toBe(0);
  });
  it('绝对时间优先，暂停不会补算积压时间，倒叙不反向结算', () => {
    const p = emptyBioProfile('user', '2026/9/1 10:00'); p.cycle = { ...p.cycle, enabled: true, day: 1 };
    applyBioDelta([p], { elapsedMinutes: 9999 }, '2026/9/2 10:00', 'x', ['user']); expect(p.cycle.day).toBe(2);
    p.enabled = false; applyBioDelta([p], undefined, '2026/9/5 10:00', 'y', ['user']);
    p.enabled = true; applyBioDelta([p], undefined, '2026/9/6 10:00', 'z', ['user']); expect(p.cycle.day).toBe(3);
    applyBioDelta([p], undefined, '2026/9/3 10:00', 'a', ['user']); expect(p.cycle.day).toBe(3);
    applyBioDelta([p], undefined, '2026/9/4 10:00', 'b', ['user']); expect(p.cycle.day).toBe(4);
  });
  it('架空日期仅明确相对时间推进，未知孕期天数保持未知', () => {
    const p = emptyBioProfile('user', '初春'); p.pregnancy = { enabled: true, status: 'pregnant', days: null, dueDays: 280 };
    applyBioDelta([p], undefined, '第二年冬天', 'x', ['user']); expect(p.pregnancy.days).toBeNull();
    applyBioDelta([p], { elapsedMinutes: 1440 }, '第二年冬天', 'y', ['user']); expect(p.pregnancy.days).toBeNull();
    expect(pregnancyPhase(p)).toContain('待校准');
  });
  it('孕期推进会暂停周期；超过预产长度不会自动分娩，明确分娩进入产后', () => {
    const p = emptyBioProfile('user', '2026/9/1 10:00'); p.cycle = { ...p.cycle, enabled: true, day: 12 };
    p.pregnancy = { enabled: true, status: 'pregnant', days: 97, dueDays: 280 };
    applyBioDelta([p], undefined, '2026/9/2 10:00', 'x', ['user']);
    expect(pregnancyPhase(p)).toBe('孕中期'); expect(p.cycle.day).toBe(12);
    applyBioDelta([p], { ops: [{ op: 'advance', minutes: 200 * 1440 }] }, '2026/9/2 10:00', 'y', ['user']);
    expect(pregnancyPhase(p)).toBe('逾期'); expect(p.pregnancy.status).toBe('pregnant');
    applyBioDelta([p], { ops: [{ op: 'event', subject: 'user', kind: 'birth', source: 'story' }] }, '2026/9/2 10:00', 'z', ['user']);
    expect(p.pregnancy).toMatchObject({ status: 'postpartum', days: 0 });
    applyBioDelta([p], { ops: [{ op: 'event', subject: 'user', kind: 'cycle_start', source: 'manual' }] }, '2026/9/2 10:00', 'a', ['user']);
    expect(p.pregnancy.status).toBe('none'); expect(p.cycle.day).toBe(1);
  });
  it.each([[0, '孕早期'], [98, '孕中期'], [196, '孕晚期'], [259, '临产期'], [281, '逾期']])('分段与自定义孕期长度一致 (%s)', (days, phase) => {
    const p = emptyBioProfile('user'); p.pregnancy = { enabled: true, status: 'pregnant', days: Number(days) / 2, dueDays: 140 };
    expect(pregnancyPhase(p)).toBe(phase);
  });
});

describe('生理档案重放与保存', () => {
  it('只为名册已有角色开启，非法输入受约束', () => {
    const profiles: BioProfile[] = [];
    applyBioDelta(profiles, { ops: [{ op: 'configure', subject: '不存在', patch: {} }] }, '', 'x', ['user']); expect(profiles).toEqual([]);
    const d = cleanBioDelta({ ops: [{ op: 'configure', subject: 'user', patch: { cycle: { lengthDays: -1, periodDays: 900, day: 999 }, needs: { hunger: Infinity, thirst: -4 } } }, { op: 'event', subject: 'user', kind: '__proto__' }] });
    applyBioDelta(profiles, d, '', 'y', ['user']);
    expect(profiles[0].cycle.lengthDays).toBe(2); expect(profiles[0].cycle.periodDays).toBe(2);
    expect(profiles[0].needs).toEqual({ hunger: null, thirst: 0, fatigue: null });
  });
  it('删除/切换/番外楼回退；重算不会重复累积', () => {
    const a = start(), b = floor('b', { time: '2026/9/2 10:00' });
    const state = deriveMemory([a, b]).physiology;
    expect(state[0].cycle.day).toBe(2); expect(deriveMemory([a, b]).physiology).toEqual(state);
    expect(deriveMemory([a]).physiology[0].cycle.day).toBe(1);
    b.swipe_id = 1; expect(deriveMemory([a, b]).physiology[0].cycle.day).toBe(1);
    b.swipe_id = 0; b.extra!.bbs_omit = true; expect(deriveMemory([a, b]).physiology[0].cycle.day).toBe(1);
    expect(deriveMemory([]).physiology).toEqual([]);
  });
  it('需求按实际事件恢复；经期/孕期事件必须开启对应跟踪', () => {
    const p = emptyBioProfile('user');
    applyBioDelta([p], { ops: [
      { op: 'event', subject: 'user', kind: 'pregnancy_confirm', days: 10, source: 'story' },
      { op: 'event', subject: 'user', kind: 'cycle_start', source: 'story' },
      { op: 'event', subject: 'user', kind: 'meal', source: 'story' },
      { op: 'event', subject: 'user', kind: 'drink', source: 'story' },
      { op: 'event', subject: 'user', kind: 'sleep', source: 'story' },
    ] }, '', 'x', ['user']);
    expect(p.pregnancy.status).toBe('none'); expect(p.cycle.day).toBeNull();
    expect(p.needs).toEqual({ hunger: 10, thirst: 10, fatigue: 10 }); expect(p.timeline).toHaveLength(3);
  });
  it('只有本轮逐字证据及已开启人物能结算，同一事件去重', () => {
    const p = emptyBioProfile('艾琳'), paused = emptyBioProfile('李明'); paused.enabled = false;
    const e = { subject: '艾琳', kind: 'meal', evidence: '艾琳吃完了一餐。' };
    const d = groundedBioDelta({ elapsedMinutes: 120, elapsedEvidence: '两小时后两人离开。', events: [e, e,
      { subject: '艾琳', kind: 'pregnancy_confirm', evidence: '推演建议怀孕。' },
      { subject: '李明', kind: 'drink', evidence: '李明喝了一杯水。' },
      { subject: '陌生人', kind: 'drink', evidence: '李明喝了一杯水。' },
    ] }, '艾琳吃完了一餐。两小时后两人离开。李明喝了一杯水。', [p, paused]);
    expect(d.elapsedMinutes).toBe(120); expect(d.ops).toHaveLength(1);
    expect(groundedBioDelta({ elapsedMinutes: 120, elapsedEvidence: '脑补过去两小时' }, '', [p])).toEqual({});
  });
  it('拒绝怀孕猜测和跨人物事件；未明示孕期天数不能填入推算值', () => {
    const p = emptyBioProfile('艾琳'), other = emptyBioProfile('李明');
    const source = '医生说艾琳可能怀孕了。艾琳检查后确认已怀孕。李明喝了一杯水。艾琳已怀孕40天。';
    const d = groundedBioDelta({ events: [
      { subject: '艾琳', kind: 'pregnancy_confirm', days: 1, evidence: '医生说艾琳可能怀孕了。' },
      { subject: '艾琳', kind: 'drink', evidence: '李明喝了一杯水。' },
      { subject: '艾琳', kind: 'pregnancy_confirm', days: 10, evidence: '艾琳检查后确认已怀孕。' },
      { subject: '艾琳', kind: 'pregnancy_confirm', days: 40, evidence: '艾琳已怀孕40天。' },
    ] }, source, [p, other]);
    expect(d.ops).toHaveLength(2);
    expect(d.ops?.[0]).toMatchObject({ days: undefined }); expect(d.ops?.[1]).toMatchObject({ days: 40 });
  });
  it('持久化手动操作、改名和公开快照都按同一账本读取', () => {
    vi.useFakeTimers(); const chat = [start()]; useChat(chat); recomputeDerived();
    expect(appendOpToLatestLeaf({ physiology: { ops: [{ op: 'configure', subject: '艾琳', patch: { notes: '体质记录' } }] } })).toBe(true);
    expect(editNpc('艾琳', { name: '艾莉' })).toBe(true);
    const p = deriveMemory(JSON.parse(JSON.stringify(chat))).physiology[0];
    expect(p.subject).toBe('艾莉'); expect(p.notes).toBe('体质记录');
    expect(getSnapshot().physiology).toEqual([p]); expect(query({ resource: 'physiology' })).toEqual([p]);
  });
  it('快照种子跨聊天保留天数、相对时间抵扣与时间线；恢复数据不共享引用', () => {
    const old = deriveMemory([start(), floor('b', { physiology: { ops: [{ op: 'advance', minutes: 1440 }] } })]).physiology[0];
    const restored = deriveMemory([floor('seed', { time: '2026/9/1 10:00', physiology: { ops: [{ op: 'restore', profile: old }] } }), floor('next', { time: '2026/9/2 10:00' })]).physiology[0];
    expect(restored.cycle.day).toBe(old.cycle.day); expect(restored.timeline).toEqual(old.timeline);
    restored.needs.hunger = 0; expect(old.needs.hunger).toBe(100);
  });
  it('实际带数据创建新对话流程保留窗口前种子和窗口内生理变化', async () => {
    vi.useFakeTimers();
    const sourceChat = [start(), floor('b', { time: '2026/9/2 10:00', physiology: { ops: [{ op: 'event', subject: '艾琳', kind: 'meal', source: 'story' }] } })];
    const sourceCtx = { chat: sourceChat, chatMetadata: {}, name1: '主角', name2: '艾琳', saveChat: vi.fn(), getCurrentChatId: () => 'source' };
    const targetCtx = { ...sourceCtx, chat: [] as STMessage[], chatMetadata: {}, getCurrentChatId: () => 'target' };
    let active = sourceCtx;
    vi.spyOn(context, 'getContext').mockImplementation(() => active as unknown as STContext);
    vi.spyOn(context, 'getDoNewChat').mockResolvedValue(async () => { active = targetCtx; });
    vi.spyOn(engine, 'resolveKeepStart').mockReturnValue(1);
    vi.spyOn(notices, 'toast').mockImplementation(() => {});
    const old = deriveMemory(sourceChat).physiology;
    expect(await createNewChatWithCarryover()).toBe(true);
    expect(targetCtx.chat[0].extra?.bbs_leaf?.delta.physiology?.ops?.[0].op).toBe('restore');
    expect(deriveMemory(targetCtx.chat).physiology).toEqual(old);
    expect(sourceChat).toHaveLength(2);
  });
  it('主模型注入显示启用的角色状态，遵循人物开关和仅摘要模式', () => {
    const originals = { summaryOnlyMode: apiSettings.summaryOnlyMode, injection: { ...apiSettings.injection } };
    try {
      useChat([start()]); recomputeDerived(); apiSettings.summaryOnlyMode = false;
      apiSettings.injection.npcs = true; apiSettings.injection.scenes = true;
      expect(buildStateInjectionText()).toContain('[角色生理状态]'); expect(buildStateInjectionText()).toContain('周期第1天');
      apiSettings.injection.npcs = false; expect(buildStateInjectionText()).not.toContain('[角色生理状态]');
      apiSettings.summaryOnlyMode = true; expect(buildStateInjectionText()).toBe('');
    } finally { Object.assign(apiSettings, originals); }
  });
  it.each(['', '自定义模板 {{content}}'])('内置/自定义摘要均有协议和基线；未开启不增加协议 (%s)', template => {
    const original = apiSettings.prompts.summary;
    try {
      apiSettings.prompts.summary = template;
      const a: Parameters<typeof buildSummaryPrompt>[0] = { user: '主角', char: '艾琳', time: '', location: '', protagonist: {}, sceneFocus: null, lifeDetails: [], items: [], itemLog: [], scenes: [], npcs: [], openPlans: [], resolvedPlans: [], history: '', content: '正文', hasTimeTags: false, varsState: {}, varsMeaning: '', varsRule: '', physiology: [emptyBioProfile('艾琳')] };
      const prompt = buildSummaryPrompt(a); expect(prompt.system).toContain('【生理档案增量协议】'); expect(prompt.user).toContain('[subject=艾琳]');
      a.physiology = []; expect(buildSummaryPrompt(a).system).not.toContain('【生理档案增量协议】');
    } finally { apiSettings.prompts.summary = original; }
  });
});
