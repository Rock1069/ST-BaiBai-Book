import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { STContext, STMessage } from '@/st/context';
import * as context from '@/st/context';
import * as client from '@/api/client';
import * as settings from '@/api/settings';
import * as notices from '@/st/toast';
import * as engine from '@/memory/engine';
import { bindPlot, cancelPlot, exportSelectedPlotPreset, generatePlot, importPlotPresetText, plot, plotPresets, preparePlot, queuePlot, selectPlotPreset } from './store';
import { PLOT_KEY, PLOT_PROMPT_KEY } from './model';
import { REALISM_GUIDANCE } from './realism';

vi.mock('@/memory/engine', () => ({ currentSummaryPromise: () => null, fetchCharCard: () => '角色设定', fetchUserPersona: () => '', fetchWorldInfo: async () => '' }));
vi.mock('@/memory/inject', () => ({ buildStateInjectionText: () => '当前状态', renderHistoryNodes: () => '历史', selectHistoryNodesBefore: () => [] }));
vi.mock('@/memory/store', () => ({ memory: { summaries: [], knowledge: [] } }));

const msg = (mes = '正文', user = false): STMessage => ({ name: '角色', mes, is_user: user, is_system: false });
let ctx: STContext;
let chatId = 'one';
let handlers: Record<string, (...args: any[]) => void>;
let bound = false;
beforeEach(async () => {
  chatId = 'one';
  plotPresets.items = [];
  handlers ??= {};
  ctx = {
    chat: [msg()], chatMetadata: {}, characterId: 0, characters: [{ name: '角色', avatar: 'a' }], name1: '用户', name2: '角色',
    getCurrentChatId: () => chatId, saveMetadataDebounced: vi.fn(), saveChat: vi.fn().mockResolvedValue(undefined), setExtensionPrompt: vi.fn(),
    eventSource: { on: (name: string, fn: (...args: any[]) => void) => { handlers[name] = fn; } },
    eventTypes: { CHAT_CHANGED: 'chat', CHARACTER_MESSAGE_RENDERED: 'render', GENERATION_STOPPED: 'stop', MESSAGE_DELETED: 'deleted' },
  } as unknown as STContext;
  vi.spyOn(context, 'getContext').mockImplementation(() => ctx);
  vi.spyOn(settings, 'engineActiveHere').mockReturnValue(true);
  vi.spyOn(client, 'requestViaMainApi').mockResolvedValue('【推进建议】走向城堡');
  vi.spyOn(notices, 'toast').mockImplementation(() => {});
  if (!bound) { bindPlot(); bound = true; } else handlers.chat();
  await nextTick();
});
afterEach(() => { cancelPlot(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('剧情推进生命周期', () => {
  it.each(['', '自定义任务'])('推演沿用同一用户楼的缓存：%s', async prompt => {
    plot.data.settings.prompt = prompt;
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    const sent = vi.mocked(client.requestViaMainApi).mock.calls[0][0].map(m => m.content).join('\n');
    expect(sent).toContain('继续');
    await preparePlot('regenerate');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(plot.data.delivery?.reused).toBe(true);
  });
  it.each(['', '用户自定义推演任务'])('写实检查合并进一次手动推演，兼容内置/自定义提示：%s', async prompt => {
    plot.data.settings.realism = true;
    plot.data.settings.prompt = prompt;
    const before = JSON.stringify(ctx.chat);
    await generatePlot('请守卫开门');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    const messages = vi.mocked(client.requestViaMainApi).mock.calls[0][0];
    expect(messages.filter(m => m.role === 'system' && m.content === REALISM_GUIDANCE)).toHaveLength(1);
    expect(messages.at(-1)?.content).toContain('请守卫开门');
    if (prompt) expect(messages[0].content).toBe(prompt);
    expect(ctx.chatMetadata[PLOT_KEY]).toMatchObject({ settings: { realism: true } });
    expect(JSON.stringify(ctx.chat)).toBe(before);
  });
  it('写实开关随聊天恢复，旧聊天默认关闭', async () => {
    plot.data.settings.realism = true;
    const savedMetadata = JSON.parse(JSON.stringify(ctx.chatMetadata));
    chatId = 'two'; ctx.chatMetadata = {}; handlers.chat();
    expect(plot.data.settings.realism).toBe(false);
    chatId = 'one'; ctx.chatMetadata = savedMetadata; handlers.chat();
    expect(plot.data.settings.realism).toBe(true);
    await generatePlot();
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(vi.mocked(client.requestViaMainApi).mock.calls[0][0].some(m => m.content === REALISM_GUIDANCE)).toBe(true);
  });
  it('切换写实开关不重新付费推演，下一条用户消息才采用新设置', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    expect(vi.mocked(client.requestViaMainApi).mock.calls[0][0].some(m => m.content === REALISM_GUIDANCE)).toBe(false);
    const plan = JSON.parse(JSON.stringify(ctx.chat.at(-1)?.extra?.bbs_plot_plan));
    plot.data.settings.realism = true;
    await preparePlot('regenerate');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(plot.data.delivery?.reused).toBe(true);
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan).toEqual(plan);
    ctx.chat.push(msg('新的正文'), msg('再继续', true));
    await preparePlot('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.requestViaMainApi).mock.calls[1][0].some(m => m.content === REALISM_GUIDANCE)).toBe(true);
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, expect.stringContaining('走向城堡'), 1, 0, false, 1);
    plot.data.settings.realism = false;
    ctx.chat.push(msg('新的正文'), msg('第三次', true));
    await preparePlot('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(3);
    expect(vi.mocked(client.requestViaMainApi).mock.calls[2][0].some(m => m.content === REALISM_GUIDANCE)).toBe(false);
  });
  it('写实开关导出导入后仍保留原第三方任务和世界书/条数设置', () => {
    ctx.extensionSettings = {};
    importPlotPresetText(JSON.stringify({
      name: '旧版预设', worldbookEnabled: false, contextTurnCount: 9,
      promptGroup: [{ role: 'USER', content: '$8' }], unknownData: { keep: true },
    }));
    plot.data.settings.realism = true;
    const exported = exportSelectedPlotPreset();
    const tasks = plotPresets.items[0].promptGroup;
    expect(plotPresets.items[0].bbsSettings).toBeUndefined();
    plot.data.settings.realism = false;
    plot.data.settings.worldInfo = true;
    plot.data.settings.contextCount = 2;
    importPlotPresetText(exported.text);
    expect(plot.data.settings).toMatchObject({ realism: true, worldInfo: false, contextCount: 9 });
    expect(plotPresets.items[1].promptGroup).toEqual(tasks);
    expect(plotPresets.items[1].unknownData).toEqual({ keep: true });
    selectPlotPreset('旧版预设');
    expect(plot.data.settings.realism).toBe(true);
  });
  it('等待上一轮摘要完成后才读取记忆并启动推演', async () => {
    let finishSummary: () => void = () => {};
    const summary = new Promise<void>(resolve => { finishSummary = resolve; });
    vi.spyOn(engine, 'currentSummaryPromise').mockReturnValue(summary);
    const pending = generatePlot('开车出门');
    await Promise.resolve();
    expect(client.requestViaMainApi).not.toHaveBeenCalled();
    finishSummary();
    await pending;
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
  });
  it('保存当前聊天的推演和编辑结果，不改聊天正文', async () => {
    const before = JSON.stringify(ctx.chat);
    await generatePlot('继续探索');
    expect(plot.data.history).toHaveLength(1);
    plot.result = '编辑后的建议';
    expect(ctx.chatMetadata[PLOT_KEY]).toMatchObject({ result: '编辑后的建议' });
    expect(JSON.stringify(ctx.chat)).toBe(before);
  });
  it('手动建议允许新用户楼，优先于自动推演并保存到该用户楼', async () => {
    plot.data.settings.auto = true;
    await nextTick();
    plot.result = '手工建议';
    queuePlot();
    ctx.chat.push(msg('下一步', true));
    const before = ctx.chat.map(m => m.mes);
    await preparePlot('normal');
    expect(client.requestViaMainApi).not.toHaveBeenCalled();
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, expect.stringContaining('手工建议'), 1, 0, false, 1);
    expect(vi.mocked(ctx.setExtensionPrompt!).mock.lastCall?.[1]).toContain('【本轮用户输入（原文）】\n下一步');
    expect(ctx.chat.map(m => m.mes)).toEqual(before);
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan).toMatchObject({ text: '手工建议', source: 'manual' });
    expect(ctx.saveChat).toHaveBeenCalledOnce();
    expect(plot.queued).toBe(false);
    handlers.render();
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, '', 1, 0, false, 1);
  });
  it('编辑或删除 AI 楼不会取消已排队的手动建议', async () => {
    ctx.chat.push(msg('继续', true));
    plot.result = '旧建议'; queuePlot(); ctx.chat[0].mes = '改写';
    ctx.chat.shift(); handlers.deleted();
    await preparePlot('normal');
    expect(plot.queued).toBe(false);
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, expect.stringContaining('旧建议'), 1, 0, false, 1);
    expect(client.requestViaMainApi).not.toHaveBeenCalled();
  });
  it('自动生成使用最后的用户输入，quiet 不递归', async () => {
    plot.data.settings.auto = true; await nextTick();
    ctx.chat.push(msg('探索城堡', true));
    await preparePlot('quiet');
    expect(client.requestViaMainApi).not.toHaveBeenCalled();
    await preparePlot('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.requestViaMainApi).mock.calls[0][0][1].content).toContain('探索城堡');
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, expect.stringContaining('走向城堡'), 1, 0, false, 1);
    expect(vi.mocked(ctx.setExtensionPrompt!).mock.lastCall?.[1]).toContain('【本轮用户输入（原文）】\n探索城堡');
    expect(plot.data.delivery?.status).toBe('submitted');
  });
  it('删除的 API 渠道明确报错，不偷偷切主 API', async () => {
    plot.data.settings.channelId = 'missing';
    expect(await generatePlot()).toBeNull();
    expect(plot.error).toContain('已删除');
    expect(client.requestViaMainApi).not.toHaveBeenCalled();
  });
  it('失败清空槽位并放行正文', async () => {
    plot.data.settings.auto = true; await nextTick();
    vi.mocked(client.requestViaMainApi).mockRejectedValue(new Error('断线'));
    await expect(preparePlot('normal')).resolves.toBeUndefined();
    expect(plot.error).toBe('断线');
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, '', 1, 0, false, 1);
  });
  it('切换聊天后忽略旧请求返回，不写入新聊天', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = generatePlot();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    chatId = 'two'; ctx.chatMetadata = {}; handlers.chat();
    resolve('旧聊天的推演');
    await pending;
    expect(plot.result).toBe('');
    expect(plot.data.history).toEqual([]);
    expect(ctx.chatMetadata[PLOT_KEY]).toBeUndefined();
  });
  it('取消不等待主 API 返回，也不保存迟到结果', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = generatePlot();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    cancelPlot();
    await expect(pending).resolves.toBeNull();
    resolve('迟到结果'); await nextTick();
    expect(plot.busy).toBe(false);
    expect(plot.data.history).toEqual([]);
  });
  it('关闭引擎不调用自动推演', async () => {
    plot.data.settings.auto = true; await nextTick();
    vi.mocked(settings.engineActiveHere).mockReturnValue(false);
    await preparePlot('normal');
    expect(client.requestViaMainApi).not.toHaveBeenCalled();
  });
  it('同名聊天跨角色切换也隔离数据', async () => {
    plot.result = '角色 A 的建议'; queuePlot();
    ctx.characters = [{ name: '另一角色', avatar: 'b' }];
    ctx.chatMetadata = {};
    handlers.chat();
    expect(plot.result).toBe('');
    expect(plot.queued).toBe(false);
    expect(ctx.chatMetadata[PLOT_KEY]).toBeUndefined();
  });
  it('模型等待期间删除用户楼，丢弃过期结果', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    ctx.chat.push(msg('用户本轮输入', true));
    const pending = generatePlot();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    ctx.chat.pop();
    resolve('基于旧正文的建议');
    await expect(pending).resolves.toBeNull();
    expect(plot.error).toContain('用户消息被删除或新增');
    expect(plot.data.history).toEqual([]);
  });
  it('上一轮自动摘要补写旁注和隐藏标记时，本轮推演仍能完成', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    ctx.chat[0].mes = '<bbs_start>早晨</bbs_start>旧正文<bbs_end>早晨</bbs_end>';
    ctx.chat.push(msg('继续前行', true));
    plot.data.settings.auto = true;
    await nextTick();
    const pending = preparePlot('normal');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    ctx.chat[0].mes += '\n<bbs_items>\n获得 钥匙\n</bbs_items>';
    ctx.chat[0].extra = { bbs_hidden: true };
    ctx.chat[0].is_system = true;
    resolve('新的推进建议');
    await pending;
    expect(plot.error).toBe('');
    expect(plot.data.delivery?.status).toBe('submitted');
    expect(plot.data.history).toHaveLength(1);
    expect(vi.mocked(ctx.setExtensionPrompt!).mock.lastCall?.[1]).toContain('新的推进建议');
  });
  it('主 API 超时会释放等待且不阻断正文', async () => {
    vi.useFakeTimers();
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(() => {}));
    plot.data.settings.auto = true;
    const pending = preparePlot('normal');
    await vi.advanceTimersByTimeAsync(180001);
    await pending;
    expect(plot.busy).toBe(false);
    expect(plot.error).toContain('超时');
    expect(plot.data.history).toEqual([]);
  });
  it('只返回思考块不作为剧情建议', async () => {
    vi.mocked(client.requestViaMainApi).mockResolvedValue('<thinking>未完成的思考');
    expect(await generatePlot()).toBeNull();
    expect(plot.error).toContain('未返回有效');
    expect(plot.data.history).toEqual([]);
  });
  it('导入双任务预设后按顺序调用推演 API，并保留原始结构', async () => {
    ctx.extensionSettings = {};
    const payload = { name: '第三方', plotTasks: [
      { name: '召回', stage: 1, promptGroup: [{ role: 'USER', content: '召回 $8' }], extractTags: 'recall' },
      { name: '推进', stage: 2, promptGroup: [{ role: 'SYSTEM', content: '推进 $8' }], extractTags: 'act,scene' },
    ] };
    expect(importPlotPresetText(JSON.stringify(payload))).toEqual(['第三方']);
    expect(ctx.extensionSettings.baibai_book_plot_presets).toHaveLength(1);
    expect(plot.data.settings.presetName).toBe('第三方');
    plot.data.settings.realism = true;
    vi.mocked(client.requestViaMainApi)
      .mockResolvedValueOnce('<recall>AM0001</recall>')
      .mockResolvedValueOnce('<act>继续探索</act><scene>城堡</scene>');
    const result = await generatePlot('去城堡');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    for (const [messages] of vi.mocked(client.requestViaMainApi).mock.calls) {
      expect(messages.filter(m => m.role === 'system' && m.content === REALISM_GUIDANCE)).toHaveLength(1);
    }
    expect(vi.mocked(client.requestViaMainApi).mock.calls[1][0].at(-1)?.content).toContain('AM0001');
    expect(result).toContain('<act>');
    expect(result).toContain('<scene>');
    expect(plotPresets.items[0].plotTasks).toEqual(payload.plotTasks);
    expect(result).toContain('<recall>');
  });
  it('发送用户输入后，把第三方多阶段推演合并到用户角色提示', async () => {
    ctx.extensionSettings = {};
    importPlotPresetText(JSON.stringify({
      name: '第三方用户层',
      finalSystemDirective: '$8\n角色行动：{{act}}\n场景：{{scene}}\n记忆：{{recall}}',
      plotTasks: [
        { name: '召回', stage: 1, promptGroup: [{ role: 'USER', content: '$8' }], extractTags: 'recall' },
        { name: '推进', stage: 2, promptGroup: [{ role: 'USER', content: '$8' }], extractTags: 'act,scene' },
      ],
    }));
    plot.data.settings.auto = true;
    await nextTick();
    ctx.chat.push(msg('开车出门', true));
    const before = ctx.chat.map(m => m.mes);
    vi.mocked(client.requestViaMainApi)
      .mockResolvedValueOnce('<recall>昨天约好出门</recall>')
      .mockResolvedValueOnce('<act>角色打开车门</act><scene>清晨，车库</scene>');
    await preparePlot('normal');
    const submitted = vi.mocked(ctx.setExtensionPrompt!).mock.lastCall;
    expect(submitted?.slice(2)).toEqual([1, 0, false, 1]);
    expect(submitted?.[1]).toContain('【本轮用户输入（原文）】\n开车出门');
    expect(submitted?.[1]).toContain('昨天约好出门');
    expect(submitted?.[1]).toContain('角色打开车门');
    expect(submitted?.[1]).toContain('清晨，车库');
    expect(submitted?.[1]).not.toContain('{{act}}');
    expect(plot.data.delivery?.prompt).toBe(submitted?.[1]);
    expect(ctx.chatMetadata[PLOT_KEY]).toMatchObject({ delivery: { status: 'submitted', prompt: submitted?.[1] } });
    expect(ctx.chat.map(m => m.mes)).toEqual(before);
    handlers.render();
    plotPresets.items = [];
    await preparePlot('regenerate');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ctx.setExtensionPrompt!).mock.lastCall?.[1]).toContain('角色行动：<act>角色打开车门</act>');
    expect(plot.data.delivery?.reused).toBe(true);
  });

  it.each(['regenerate', 'swipe', 'normal'])('AI 回复 %s 复用用户楼推演，API 只调用一次', async type => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('探索城堡', true));
    await preparePlot('normal');
    const user = ctx.chat.at(-1)!;
    ctx.chat.push(msg('第一版正文'));
    handlers.render();
    if (type === 'swipe') {
      ctx.chat.at(-1)!.mes = '另一页正文';
      ctx.chat.at(-1)!.swipe_id = 1;
    } else {
      ctx.chat.pop();
      handlers.deleted();
    }
    await preparePlot(type);
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(plot.data.history).toHaveLength(1);
    expect(user.extra?.bbs_plot_plan?.text).toContain('走向城堡');
    expect(plot.data.delivery).toMatchObject({ status: 'submitted', reused: true, input: '探索城堡' });
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, expect.stringContaining('走向城堡'), 1, 0, false, 1);
  });

  it('新的用户消息即使文字相同，也单独推演', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    const firstUser = ctx.chat.at(-1)!;
    ctx.chat.push(msg('上一轮正文'), msg('继续', true));
    await preparePlot('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    expect(firstUser.extra?.bbs_plot_plan).toBeDefined();
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan).toBeDefined();
    expect(plot.data.delivery?.reused).toBe(false);
  });

  it('删除用户楼后重发相同文字，不复用已删除楼的推演', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    ctx.chat.pop(); handlers.deleted();
    ctx.chat.push(msg('继续', true));
    vi.mocked(client.requestViaMainApi).mockResolvedValue('全新的推演');
    await preparePlot('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan?.text).toBe('全新的推演');
    expect(plot.data.delivery?.reused).toBe(false);
  });

  it('删除更早的 AI 楼改变楼号，也能复用同一用户消息的计划', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    ctx.chat.shift(); handlers.deleted();
    await preparePlot('regenerate');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(plot.data.delivery?.reused).toBe(true);
  });

  it('手动建议绑定后，即使自动推演关闭，重生成仍能复用或手动替换', async () => {
    ctx.chat.push(msg('继续', true));
    plot.result = '手动规划'; queuePlot();
    await preparePlot('normal');
    handlers.render();
    await preparePlot('regenerate');
    expect(plot.data.delivery).toMatchObject({ source: 'manual', reused: true });
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, expect.stringContaining('手动规划'), 1, 0, false, 1);
    plot.result = '修改后的规划'; queuePlot();
    await preparePlot('regenerate');
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan?.text).toBe('修改后的规划');
    expect(plot.data.delivery?.reused).toBe(false);
    expect(client.requestViaMainApi).not.toHaveBeenCalled();
  });

  it('用户楼被删除会取消未采用的待用建议，同文重发也不恢复', async () => {
    ctx.chat.push(msg('继续', true));
    plot.result = '已删除楼的规划'; queuePlot();
    ctx.chat.pop(); handlers.deleted();
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    expect(plot.queued).toBe(false);
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan).toBeUndefined();
    expect(ctx.setExtensionPrompt).toHaveBeenLastCalledWith(PLOT_PROMPT_KEY, '', 1, 0, false, 1);
  });

  it('停止正文生成保留已付费获得的计划，重试无需再推演', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    handlers.stop();
    await preparePlot('regenerate');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(plot.data.delivery?.reused).toBe(true);
  });

  it('切换聊天后载入已保存的用户楼，仍能复用计划', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    await preparePlot('normal');
    const savedChat = JSON.parse(JSON.stringify(ctx.chat));
    const savedMetadata = JSON.parse(JSON.stringify(ctx.chatMetadata));
    chatId = 'two'; ctx.chat = [msg()]; ctx.chatMetadata = {}; handlers.chat();
    await preparePlot('normal');
    expect(plot.data.delivery?.status).toBe('skipped');
    chatId = 'one'; ctx.chat = savedChat; ctx.chatMetadata = savedMetadata; handlers.chat();
    await preparePlot('regenerate');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(plot.data.delivery?.reused).toBe(true);
  });

  it('推演 API 等待期间删除 AI 回复不会丢弃结果', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true), msg('准备重新生成的 AI 正文'));
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = preparePlot('regenerate');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    ctx.chat.pop(); handlers.deleted();
    resolve('保留这份推演');
    await pending;
    expect(plot.data.delivery?.status).toBe('submitted');
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan?.text).toBe('保留这份推演');
    await preparePlot('regenerate');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
  });

  it('推演等待期间删除对应用户楼会立即取消，迟到结果不写入新楼', async () => {
    plot.data.settings.auto = true;
    ctx.chat.push(msg('继续', true));
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = preparePlot('normal');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    ctx.chat.pop(); handlers.deleted();
    await pending;
    expect(plot.busy).toBe(false);
    expect(plot.data.history).toHaveLength(0);
    ctx.chat.push(msg('继续', true));
    resolve('过期结果'); await nextTick();
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan).toBeUndefined();
    vi.mocked(client.requestViaMainApi).mockResolvedValue('重发后的新计划');
    await preparePlot('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    expect(ctx.chat.at(-1)?.extra?.bbs_plot_plan?.text).toBe('重发后的新计划');
  });
});
