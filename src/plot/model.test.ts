import { describe, expect, it } from 'vitest';
import { buildPlotMessages, normalizePlotData, normalizePlotTurnPlan, plotEligible, plotInjection, shouldRunPlot } from './model';
import type { STMessage } from '@/st/context';

describe('剧情推进输入与持久化', () => {
  it('默认关闭自动调用，损坏配置恢复可用默认值', () => {
    expect(normalizePlotData(null).settings.auto).toBe(false);
    expect(normalizePlotData(null).settings.realism).toBe(false);
    expect(normalizePlotData({ settings: { realism: 'true' } }).settings.realism).toBe(false);
    expect(normalizePlotData({ settings: { realism: true } }).settings.realism).toBe(true);
    expect(normalizePlotData({ settings: { contextCount: 999, auto: 'true' }, history: [null, {}] })).toMatchObject({ settings: { contextCount: 30, auto: false }, history: [] });
    expect(normalizePlotData({ settings: { contextCount: 'bad' } }).settings.contextCount).toBe(6);
  });
  it('保留最近十次结果，限制文本大小', () => {
    const data = normalizePlotData({ history: Array.from({ length: 15 }, () => ({ text: 'x'.repeat(25000) })) });
    expect(data.history).toHaveLength(10);
    expect(data.history[0].text).toHaveLength(24000);
  });
  it('用户楼计划兼容缺失或损坏的数据，并保留原本的预设指令', () => {
    expect(normalizePlotTurnPlan(undefined)).toBeNull();
    expect(normalizePlotTurnPlan({ text: '', source: 'auto' })).toBeNull();
    expect(normalizePlotTurnPlan({ text: '建议', source: 'unknown' })).toBeNull();
    expect(normalizePlotTurnPlan({ text: '建议', source: 'manual', directive: '行动：{{act}}', createdAt: 123 }))
      .toEqual({ text: '建议', source: 'manual', directive: '行动：{{act}}', createdAt: 123 });
    expect(normalizePlotData({ delivery: { status: 'submitted', source: 'auto', reused: true } }).delivery?.reused).toBe(true);
  });
  it('不把番外、系统提示和内部提示作为正文', () => {
    const msg: STMessage = { name: '角色', mes: '正文', is_user: false, is_system: false };
    expect(plotEligible(msg)).toBe(true);
    expect(plotEligible({ ...msg, extra: { bbs_omit: true } })).toBe(false);
    expect(plotEligible({ ...msg, is_system: true })).toBe(false);
    expect(plotEligible({ ...msg, is_system: true, extra: { bbs_hidden: true } })).toBe(true);
    expect(plotEligible({ ...msg, extra: { bbs_internal_notice: 'backlog' } })).toBe(false);
  });
  it.each(['quiet', 'continue', 'impersonate', 'unknown'])('不拦截 %s', type => expect(shouldRunPlot(type)).toBe(false));
  it.each(['normal', 'regenerate', 'swipe', undefined])('正文类型 %s 可以触发', type => expect(shouldRunPlot(type)).toBe(true));
  it('自定义指令和故事资料分开，未来建议明确标注', () => {
    const settings = normalizePlotData(null).settings;
    settings.prompt = '自定义任务';
    const messages = buildPlotMessages(settings, '去城堡', '最近正文', '过去记忆', '当前物品', '背景');
    expect(messages[0].content).toBe('自定义任务');
    expect(messages[1].content).toContain('过去记忆');
    expect(messages[1].content).toContain('去城堡');
    expect(plotInjection('建议')).toContain('尚未发生');
  });
  it('第三方最终模板展开用户输入及多任务标签，交给用户层', () => {
    const directive = '$8\n以下是角色行动：{{act}}\n以下是场景：{{scene}}\n以下是记忆编码：{{recall}}';
    const result = '<recall>AM0001</recall>\n\n<act>角色上车</act>\n<scene>清晨，车库</scene>\n\n【已召回的实际记忆】\nAM0001 昨天约好出行';
    const prompt = plotInjection(result, directive, '开车出门');
    expect(prompt).toContain('【本轮用户输入（原文）】\n开车出门');
    expect(prompt).toContain('角色上车');
    expect(prompt).toContain('清晨，车库');
    expect(prompt).toContain('AM0001 昨天约好出行');
    expect(prompt).not.toContain('{{act}}');
    expect(prompt).not.toContain('$8');
  });
  it('把预设的认知轨迹作为本轮建议，同时保留已发生正文的认知边界', () => {
    const prompt = plotInjection('<act>她询问钥匙</act><dm_track>艾琳听说钥匙在车里</dm_track>',
      '行动：{{act}}', '去车库', '【角色认知边界】\n艾琳：听说钥匙在车里');
    expect(prompt).toContain('【本轮推演的角色认知建议｜尚未由正文验证】');
    expect(prompt).toContain('【角色认知边界】');
    expect(prompt).toContain('艾琳听说钥匙在车里');
  });
});
