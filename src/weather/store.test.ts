import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as context from '@/st/context';
import * as client from '@/api/client';
import * as settings from '@/api/settings';
import * as engine from '@/memory/engine';
import { buildStateInjectionText } from '@/memory/inject';
import * as notices from '@/st/toast';
import type { STContext, STMessage } from '@/st/context';
import { currentWeather, WEATHER_KEY } from './model';
import { cancelWeather, chooseWeather, getWeatherBriefing, getWeatherMoment, loadWeather, prepareWeather, updateWeather, weather } from './store';
import { createNewChatWithCarryover } from '@/memory/carryover';
import { generatePlot, cancelPlot } from '@/plot/store';
const floor = (time: string): STMessage => ({ name: '角色', mes: `<bbs_end>${time}</bbs_end>`, is_user: false, is_system: false });
let ctx: STContext;
let chatId = 'weather-one';
const result = (conditions = ['cloudy']) => JSON.stringify({ conditions, description: '云层逐渐增厚', transition: '晴空渐渐转为多云' });
beforeEach(() => {
  chatId = 'weather-one';
  ctx = { chat: [floor('2026/9/30 08:00')], chatMetadata: {}, characterId: 0, name1: '用户', name2: '角色', getCurrentChatId: () => chatId, saveMetadataDebounced: vi.fn(), setExtensionPrompt: vi.fn() } as unknown as STContext;
  vi.spyOn(context, 'getContext').mockImplementation(() => ctx);
  vi.spyOn(settings, 'engineActiveHere').mockReturnValue(true);
  vi.spyOn(settings, 'getChannelForTask').mockReturnValue(null);
  vi.spyOn(client, 'mainApiAvailable').mockReturnValue(true);
  vi.spyOn(client, 'requestViaMainApi').mockResolvedValue(result());
  vi.spyOn(engine, 'currentSummaryPromise').mockReturnValue(null);
  vi.spyOn(engine, 'fetchWorldInfo').mockResolvedValue('世界：秋季沿海城镇。');
  vi.spyOn(notices, 'toast').mockImplementation(() => {});
  loadWeather();
});
afterEach(() => { cancelWeather(); cancelPlot(); vi.restoreAllMocks(); });
describe('AI随机与手动固定天气', () => {
  it('首次由AI选择；未到期不调用，到期选择不同天气', async () => {
    updateWeather({ enabled: true }); await prepareWeather('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    expect(weather.data.current?.value.conditions).toEqual(['cloudy']);
    expect(ctx.chatMetadata[WEATHER_KEY]).toMatchObject({ enabled: true, current: { minute: 0 } });
    await prepareWeather('normal'); expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    ctx.chat.push(floor('2026/9/30 13:59')); await prepareWeather('normal'); expect(client.requestViaMainApi).toHaveBeenCalledOnce();
    ctx.chat.push(floor('2026/9/30 14:00')); vi.mocked(client.requestViaMainApi).mockResolvedValue(result(['light-rain']));
    await prepareWeather('normal'); expect(client.requestViaMainApi).toHaveBeenCalledTimes(2); expect(weather.data.current?.minute).toBe(360);
    expect(getWeatherBriefing()).toContain('小雨');
  });
  it('手动固定不调用API，任意故事时间仍保持，正文注入包含约束', async () => {
    updateWeather({ enabled: true, mode: 'manual', manual: { conditions: ['light-snow', 'breeze'], custom: '', description: '轻柔飘雪' } });
    ctx.chat.push(floor('2027/9/30 14:00')); await prepareWeather('normal');
    expect(client.requestViaMainApi).not.toHaveBeenCalled(); expect(currentWeather(weather.data)?.conditions).toEqual(['light-snow', 'breeze']);
    expect(buildStateInjectionText()).toContain('小雪＋微风'); expect(buildStateInjectionText()).toContain('用户手动固定');
    updateWeather({ manual: { conditions: ['clear'], custom: '', description: '' } });
    expect(getWeatherBriefing()).toContain('当前天气：晴');
  });
  it('AI天气准备好后可被推演同一状态读取；关闭后清除注入', async () => {
    updateWeather({ enabled: true }); await prepareWeather('normal');
    expect(buildStateInjectionText()).toContain('当前天气：多云');
    updateWeather({ enabled: false }); expect(buildStateInjectionText()).not.toContain('[天气控制');
  });
  it('页面手动推演先选天气，再把同一天气发给推演API', async () => {
    updateWeather({ enabled: true });
    vi.mocked(client.requestViaMainApi).mockResolvedValueOnce(result(['light-rain'])).mockResolvedValueOnce('推进建议：在细雨中走向城门。');
    expect(await generatePlot('走向城门')).toContain('推进建议');
    expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    const messages = vi.mocked(client.requestViaMainApi).mock.calls[1][0];
    expect(messages.some(m => m.content.includes('当前天气：小雨'))).toBe(true);
  });
  it('重生成使用之前的故事时间，未到期复用；quiet不递归', async () => {
    updateWeather({ enabled: true }); await prepareWeather('normal');
    ctx.chat.push(floor('2026/9/30 20:00'));
    await prepareWeather('regenerate'); await prepareWeather('swipe'); await prepareWeather('quiet');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce(); expect(getWeatherMoment('regenerate').minutes).toBe(0);
  });
  it('等待摘要落盘，并发触发只发一次；关闭/手动模式跳过', async () => {
    let resolve!: () => void;
    vi.spyOn(engine, 'currentSummaryPromise').mockReturnValue(new Promise(r => { resolve = r; }));
    updateWeather({ enabled: true });
    const first = chooseWeather(), second = chooseWeather(); expect(first).toBe(second);
    expect(client.requestViaMainApi).not.toHaveBeenCalled(); resolve(); await Promise.all([first, second]);
    expect(client.requestViaMainApi).toHaveBeenCalledOnce();
  });
  it('无效/重复选择最多修复一次，失败沿用已选天气', async () => {
    updateWeather({ enabled: true }); await chooseWeather();
    ctx.chat.push(floor('2026/9/30 14:00'));
    expect(await chooseWeather()).toBe(false); expect(client.requestViaMainApi).toHaveBeenCalledTimes(3);
    expect(weather.error).toContain('重复'); expect(weather.data.current?.value.conditions).toEqual(['cloudy']);
    expect(weather.data.current?.minute).toBe(0);
  });
  it('刷新读取缓存，不重复API；切聊天清除状态', async () => {
    updateWeather({ enabled: true }); await chooseWeather(); loadWeather(); await prepareWeather('normal');
    expect(client.requestViaMainApi).toHaveBeenCalledOnce(); expect(weather.data.current?.value.conditions).toEqual(['cloudy']);
    chatId = 'weather-two'; ctx.chatMetadata = {}; loadWeather(); expect(weather.data.enabled).toBe(false); expect(weather.data.current).toBeNull();
  });
  it('切聊天忽略迟到结果，取消不等待主API', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    updateWeather({ enabled: true }); const pending = chooseWeather();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    chatId = 'weather-two'; ctx.chatMetadata = {}; loadWeather(); await expect(pending).resolves.toBe(false);
    resolve(result()); await Promise.resolve(); expect(weather.data.current).toBeNull(); expect(ctx.chatMetadata[WEATHER_KEY]).toBeUndefined();
  });
  it('选择期间切到手动，新固定天气不会被迟到AI覆盖', async () => {
    let resolve!: (value: string) => void;
    vi.mocked(client.requestViaMainApi).mockImplementation(() => new Promise(r => { resolve = r; }));
    updateWeather({ enabled: true }); const pending = chooseWeather(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    updateWeather({ mode: 'manual', manual: { conditions: ['hail'], custom: '', description: '' } });
    await pending; resolve(result()); await Promise.resolve(); expect(currentWeather(weather.data)?.conditions).toEqual(['hail']);
  });
  it('跨越多天只挑一次，删除末楼后重新建立计时锚点', async () => {
    updateWeather({ enabled: true }); await chooseWeather();
    ctx.chat.push(floor('2026/10/15 14:00')); vi.mocked(client.requestViaMainApi).mockResolvedValue(result(['light-rain']));
    await prepareWeather('normal'); expect(client.requestViaMainApi).toHaveBeenCalledTimes(2);
    ctx.chat.pop(); await prepareWeather('normal'); expect(client.requestViaMainApi).toHaveBeenCalledTimes(2); expect(weather.data.current?.minute).toBe(0);
  });
  it('带数据新对话实际流程保留固定天气与时钟，旧记忆种子不重复计时', async () => {
    const sourceCtx = ctx;
    sourceCtx.chat = [floor('2026/9/30 08:00'), floor('2026/9/30 10:00'), floor('2026/9/30 14:00')];
    sourceCtx.saveChat = vi.fn().mockResolvedValue(undefined);
    updateWeather({ enabled: true, mode: 'manual', manual: { conditions: ['fog'], custom: '', description: '' } });
    const before = getWeatherMoment();
    vi.spyOn(engine, 'resolveKeepStart').mockReturnValue(2);
    vi.spyOn(context, 'getDoNewChat').mockResolvedValue(async () => {
      chatId = 'target'; ctx = { ...sourceCtx, chat: [], chatMetadata: {} };
    });
    expect(await createNewChatWithCarryover()).toBe(true);
    expect(getWeatherMoment()).toEqual(before); expect(getWeatherBriefing()).toContain('当前天气：雾');
    expect(ctx.chatMetadata[WEATHER_KEY]).toMatchObject({ enabled: true, mode: 'manual' });
  });
});
