import { describe, expect, it } from 'vitest';
import { activePlotTasks, currentPlotPreset, exportPlotPreset, extractTaskOutput, parsePlotPresets, recalledDetails, renderPresetMessages, type PlotMaterials, type PlotPreset } from './presets';
import { normalizePlotData } from './model';
import { REALISM_GUIDANCE } from './realism';

const materials: PlotMaterials = {
  input: '去城堡', recent: '角色进入大厅', history: '旧故事', state: '当前位置：大厅',
  world: '城堡世界书', card: '骑士角色卡', persona: '旅行者',
  indexed: [{ code: 'AM0001', text: '旧约定' }, { code: 'AM0002', text: '旧线索' }],
};
const preset: PlotPreset = {
  name: '双任务预设', worldbookEnabled: true,
  plotTasks: [
    { name: '推进', stage: 2, order: 0, extractTags: 'act,scene', promptGroup: [{ role: 'SYSTEM', content: '根据 $8 推进剧情' }] },
    { name: '召回', stage: 1, order: 0, extractTags: 'recall', promptGroup: [{ role: 'USER', content: '$5\n$7\n$C\n$U\n$1' }] },
  ],
};

describe('第三方剧情推进预设', () => {
  it('导入单对象与原脚本数组格式，保留原始字段并导出数组', () => {
    const raw = { ...preset, unknownFutureField: { keep: true } };
    expect(parsePlotPresets(JSON.stringify(raw))[0].unknownFutureField).toEqual({ keep: true });
    expect(parsePlotPresets(exportPlotPreset(raw))).toEqual([raw]);
  });
  it('按阶段执行，填入柏宝书资料，保留上一阶段结果', () => {
    const [recall, advance] = activePlotTasks(preset);
    expect([recall.name, advance.name]).toEqual(['召回', '推进']);
    const first = renderPresetMessages(recall, materials, '');
    expect(first[0].content).toContain('AM0001 旧约定');
    expect(first[0].content).toContain('角色进入大厅');
    expect(first[0].content).toContain('城堡世界书');
    expect(renderPresetMessages(advance, materials, '<recall>AM0002</recall>').some(m => m.content.includes('AM0002'))).toBe(true);
    expect(renderPresetMessages(advance, materials, '').some(m => m.content.includes('【柏宝书当前状态｜已发生事实】\n当前位置：大厅'))).toBe(true);
  });
  it('预设已使用 $S 时不重复附加状态', () => {
    const task = { promptGroup: [{ role: 'USER', content: '当前：$S' }] };
    const messages = renderPresetMessages(task, materials, '');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('当前位置：大厅');
  });
  it.each([false, true])('第三方预设保留角色认知和末尾预填充，写实模式=%s', realism => {
    const task = { promptGroup: [{ role: 'USER', content: '$8' }, { role: 'ASSISTANT', content: '<think>' }] };
    const messages = renderPresetMessages(task, { ...materials, realism, knowledge: '艾琳：确知钥匙在车里' }, '上一阶段');
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: '<think>' });
    expect(messages.some(m => m.role === 'system' && m.content.includes('艾琳：确知钥匙在车里'))).toBe(true);
    expect(messages.some(m => m.content.includes('上一阶段'))).toBe(true);
    expect(messages.filter(m => m.role === 'system' && m.content === REALISM_GUIDANCE)).toHaveLength(realism ? 1 : 0);
  });
  it('提取多个输出标签并把真实记忆交给下一任务', () => {
    const answer = '<inner>想法</inner><act>开门</act><scene>大厅</scene>';
    expect(extractTaskOutput(answer, activePlotTasks(preset)[1])).toBe('<act>\n开门\n</act>\n\n<scene>\n大厅\n</scene>');
    expect(recalledDetails('<recall>AM0002, AM9999</recall>', materials)).toBe('AM0002 旧线索');
  });
  it('拒绝伪预设与无可执行任务文件', () => {
    expect(() => parsePlotPresets('{}')).toThrow('缺少名称');
    expect(() => parsePlotPresets(JSON.stringify({ name: '空', plotTasks: [{ enabled: false }] }))).toThrow('没有可执行');
    expect(() => parsePlotPresets('no json')).toThrow('不是有效 JSON');
  });
  it('当前配置导出为原脚本可读的任务数组', () => {
    const settings = normalizePlotData({ settings: { realism: true } }).settings;
    const exported = currentPlotPreset('自定义', settings);
    const imported = parsePlotPresets(exportPlotPreset(exported))[0];
    expect(imported.plotTasks).toHaveLength(1);
    expect(imported.bbsSettings?.realism).toBe(true);
  });
});
