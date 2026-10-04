import { describe, expect, it } from 'vitest';
import type { STMessage } from '@/st/context';
import { deriveMemory } from './apply';
import { addDays, applyReproductive, formatReproductiveForModel, groundedReproductive, parseGregorianDate, projectReproductive, storyGregorianDate } from './reproductive';
import type { ReproductiveProfile, StoredDelta } from './types';

const base: ReproductiveProfile = {
  subject: '艾琳', cycleType: 'human', regularity: 'regular', pregnancyStatus: 'unknown',
  lastPeriodStart: '2026-09-01', cycleLengthDays: 28, periodLengthDays: 5,
};

function message(id: string, delta: StoredDelta, swipe = 0): STMessage {
  return { name: '角色', mes: '已经发生的剧情', is_user: false, is_system: false, swipe_id: swipe,
    extra: { bbs_leaf: { id, text: '摘要', delta, createdAt: 1, swipe: 0, v: 1 } } } as STMessage;
}

describe('角色生理时间线', () => {
  it('严格识别公历日期，并取跨日故事时间的结束日期', () => {
    expect(parseGregorianDate('2026-02-30')).toBeNull();
    expect(parseGregorianDate('2024/2/29')).toBe('2024-02-29');
    expect(storyGregorianDate('2026年9月27日 23:00 ～ 2026年9月28日 01:00')).toBe('2026-09-28');
    expect(storyGregorianDate('星历第七纪第八日')).toBeNull();
  });

  it('只结算有角色归属和正文日期依据的经期事实', () => {
    const story = '【角色·艾琳】2026年9月1日，艾琳的月经开始了。她说周期规律，通常28天。';
    const raw = { upsert: [
      { subject: '艾琳', cycleType: 'human', regularity: 'regular', lastPeriodStart: '2026-09-01', cycleLengthDays: 28,
        evidence: '艾琳的月经开始了。她说周期规律，通常28天。' },
      { subject: '莉莉', lastPeriodStart: '2026-09-01', evidence: '艾琳的月经开始了。她说周期规律，通常28天。' },
      { subject: '艾琳', lastPeriodStart: '2026-09-03', evidence: '艾琳的月经开始了。她说周期规律，通常28天。' },
    ] };
    const result = groundedReproductive(raw, story, '世界书：莉莉有怀孕预言');
    expect(result.upsert).toHaveLength(1);
    expect(result.upsert?.[0]).toMatchObject({ subject: '艾琳', lastPeriodStart: '2026-09-01', cycleLengthDays: 28 });
    expect(result.upsert?.[0].cycleType).toBeUndefined();
  });

  it('不把世界书预言、停经或疑似怀孕结算为已确认孕期', () => {
    const story = '艾琳担心自己可能怀孕；月经推迟没有来。';
    const result = groundedReproductive({ upsert: [
      { subject: '艾琳', pregnancyStatus: 'confirmed', evidence: '艾琳担心自己可能怀孕' },
      { subject: '艾琳', lastPeriodStart: '2026-09-01', evidence: '月经推迟没有来' },
    ] }, story, '艾琳将来会怀孕');
    expect(result.upsert).toBeUndefined();
  });

  it('角色卡只提供明确物种规则，不把设定中的日期当成本轮事实', () => {
    const result = groundedReproductive({ upsert: [
      { subject: '艾琳', cycleType: 'human', lastPeriodStart: '2026-09-01', pregnancyStatus: 'confirmed', evidence: '艾琳是人类' },
    ] }, '', '艾琳是人类；设定未来剧情会怀孕。');
    expect(result.upsert).toEqual([{ subject: '艾琳', cycleType: 'human', source: '角色卡/世界书' }]);
  });

  it('仅在已知规律周期内提供范围，到期后停止滚动预测', () => {
    const projected = projectReproductive(base, '2026-09-15');
    expect(projected).toMatchObject({ kind: 'cycle', cycleDay: 15, nextPeriodStart: '2026-09-29',
      ovulationFrom: '2026-09-13', ovulationTo: '2026-09-19',
      possibleFertileFrom: '2026-09-08', possibleFertileTo: '2026-09-20', phase: 'possible-fertile' });
    expect(projectReproductive(base, '2026-09-29').kind).toBe('unavailable');
    expect(projectReproductive({ ...base, regularity: 'irregular' }, '2026-09-15').kind).toBe('unavailable');
    expect(projectReproductive({ ...base, cycleLengthDays: 35 }, '2026-09-15').kind).toBe('unavailable');
    expect(formatReproductiveForModel([base], '2026-09-15')).toContain('不是诊断、确定排卵日或避孕“安全期”');
  });

  it('孕周依据日期计算，结束后清除旧锚点', () => {
    const pregnant: ReproductiveProfile = { ...base, pregnancyStatus: 'confirmed',
      dating: { basis: 'lastPeriod', date: '2026-09-01' } };
    expect(projectReproductive(pregnant, '2026-09-29')).toEqual({ kind: 'pregnancy',
      gestationWeeks: 4, gestationDays: 0, dueDate: addDays('2026-09-01', 280), basis: 'lastPeriod' });
    const profiles = [pregnant];
    applyReproductive(profiles, { upsert: [{ subject: '艾琳', pregnancyStatus: 'ended' }] });
    expect(profiles[0]).toMatchObject({ pregnancyStatus: 'ended', regularity: 'unknown' });
    expect(profiles[0].lastPeriodStart).toBeUndefined();
    expect(profiles[0].cycleLengthDays).toBeUndefined();
    expect(profiles[0].dating).toBeUndefined();
    expect(projectReproductive(profiles[0], '2026-10-01').kind).toBe('unavailable');
    applyReproductive(profiles, { upsert: [{ subject: '艾琳', lastPeriodStart: '2026-10-05' }] });
    expect(profiles[0].pregnancyStatus).toBe('unknown');
    expect(profiles[0].regularity).toBe('unknown');
  });

  it('经摘要叶子重放，后续更新与删除楼层会恢复较早状态', () => {
    const first = message('r1', { reproductive: { upsert: [{ ...base }] } });
    const later = message('r2', { reproductive: { upsert: [{ subject: '艾琳', lastPeriodStart: '2026-09-29' }] } });
    expect(deriveMemory([first]).reproductive[0].lastPeriodStart).toBe('2026-09-01');
    expect(deriveMemory([first, later]).reproductive[0].lastPeriodStart).toBe('2026-09-29');
    expect(deriveMemory([later]).reproductive[0].lastPeriodStart).toBe('2026-09-29');
    expect(deriveMemory([first, message('r3', { reproductive: { remove: ['艾琳'] } })]).reproductive).toEqual([]);
  });
});
