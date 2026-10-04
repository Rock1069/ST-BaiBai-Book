import { describe, expect, it } from 'vitest';
import type { STMessage } from '@/st/context';
import { parseStoryClock } from '@/memory/storyClock';
import { WEATHER_OPTIONS, currentWeather, groundedWeatherElapsed, normalizeWeatherData, parseWeatherChoice, weatherBriefing, weatherDue, weatherMoment, weatherSignature } from './model';
const floor = (time: string, relative?: number, swipe = 0): STMessage => ({ name: '角色', is_user: false, is_system: false, mes: time ? `<bbs_end>${time}</bbs_end>` : '正文', swipe_id: swipe,
  extra: { bbs_leaf: { id: 'leaf', text: '摘要', createdAt: 1, swipe: 0, v: 1, delta: { weatherElapsedMinutes: relative } } } });
const chosen = () => normalizeWeatherData({ enabled: true, current: { value: { conditions: ['clear'] }, minute: 0, time: '2026/9/30 08:00' } });
describe('天气范围与模式', () => {
  it('天气id唯一，覆盖各分组并支持固定组合与自定义', () => {
    expect(new Set(WEATHER_OPTIONS.map(x => x.value)).size).toBe(WEATHER_OPTIONS.length);
    expect(new Set(WEATHER_OPTIONS.map(x => x.group)).size).toBe(6);
    const data = normalizeWeatherData({ enabled: true, mode: 'manual', manual: { conditions: ['light-rain', 'breeze'], custom: '山谷局部雾', description: '湿润' } });
    expect(weatherBriefing(data)).toContain('小雨＋微风＋山谷局部雾'); expect(weatherBriefing(data)).toContain('只有用户');
    expect(weatherDue(data, { minutes: 999999, time: '', clock: '', debt: 0 })).toBe(false);
  });
  it('旧/损坏配置安全归一，默认6故事小时且关闭', () => {
    const data = normalizeWeatherData({ intervalHours: 1, history: [null], current: { value: { conditions: ['invalid'] } } });
    expect(data.intervalHours).toBe(6); expect(data.enabled).toBe(false); expect(data.current).toBeNull();
    expect(weatherBriefing(data)).toBe(''); expect(currentWeather(data)).toBeNull();
  });
  it('相同组合不能靠顺序/改写描述重复；未知id拒绝', () => {
    const prior = { conditions: ['fog', 'breeze'], custom: '', description: '旧描述' };
    expect(() => parseWeatherChoice({ conditions: ['breeze', 'fog'], description: '新描述' }, prior)).toThrow('重复');
    expect(() => parseWeatherChoice({ conditions: ['magic-id'] }, null)).toThrow('无效');
    expect(() => parseWeatherChoice({ conditions: ['clear', 'overcast'] }, null)).toThrow('互斥');
    expect(weatherSignature(parseWeatherChoice({ conditions: ['cloudy'] }, prior).value)).not.toBe(weatherSignature(prior));
  });
});
describe('只使用故事时间的天气时钟', () => {
  it('拒绝无效日期和模糊时辰，保留架空纪年与小年份', () => {
    expect(parseStoryClock('2026/2/30 10:00')).toBeNull();
    expect(parseStoryClock('2026/9/1 24:00')).toBeNull();
    expect(parseStoryClock('初春三日午时')).toBeNull();
    expect(parseStoryClock('天元历12年3月1日 10:00')?.calendar).toBe('天元历');
    const smallYear = parseStoryClock('12年3月1日');
    expect(smallYear?.precision).toBe('day');
    expect(new Date(smallYear!.minute * 60000).getUTCFullYear()).toBe(12);
  });
  it.each([3, 6, 12])('%s小时到期，在阈值前保持，跨越多天只标记一次到期', hours => {
    const data = chosen(); data.intervalHours = hours as 3 | 6 | 12;
    expect(weatherDue(data, { minutes: hours * 60 - 1, time: '', clock: '', debt: 0 })).toBe(false);
    expect(weatherDue(data, { minutes: hours * 60, time: '', clock: '', debt: 0 })).toBe(true);
    expect(weatherDue(data, { minutes: 50000, time: '', clock: '', debt: 0 })).toBe(true);
  });
  it('08:00到14:00累计360分钟；不读取现实时间', () => {
    const chat = [floor('2026/9/30 08:00'), floor('2026/9/30 14:00')];
    const moment = weatherMoment(chat); expect(moment.minutes).toBe(360); expect(weatherDue(chosen(), moment)).toBe(true);
    expect(weatherMoment(chat)).toEqual(moment);
  });
  it('相对时间与随后补齐的日期抵扣，不双算；有日期差时忽略模型时长', () => {
    const chat = [floor('2026/9/30 08:00'), floor('', 120), floor('2026/9/30 09:00', 500), floor('2026/9/30 10:00'), floor('2026/9/30 14:00')];
    expect(weatherMoment(chat.slice(0, 3)).minutes).toBe(120);
    expect(weatherMoment(chat).minutes).toBe(360); expect(weatherMoment(chat).debt).toBe(0);
  });
  it('模糊日期用明确相对时长；倒叙/跨纪年/不同比较精度不乱推进', () => {
    expect(weatherMoment([floor('初春'), floor('午后', 360)]).minutes).toBe(360);
    expect(weatherMoment([floor('天元历12年3月1日 08:00'), floor('天元历12年3月1日 14:00')]).minutes).toBe(360);
    expect(weatherMoment([floor('2026/9/30 14:00'), floor('2026/9/30 08:00')]).minutes).toBe(0);
    expect(weatherMoment([floor('甲历12年3月1日 08:00'), floor('乙历12年3月2日 08:00')]).minutes).toBe(0);
    expect(weatherMoment([floor('2026/9/30'), floor('2026/9/30 14:00')]).minutes).toBe(0);
  });
  it('番外、用户及失效swipe叶子的相对时长不计入', () => {
    const user = floor('', 100); user.is_user = true;
    const omit = floor('', 100); omit.extra!.bbs_omit = true;
    expect(weatherMoment([floor('初春'), user, omit, floor('', 100, 1), floor('', 360)]).minutes).toBe(360);
  });
  it('换对话时种子保留窗口前时间与抵扣状态，后续重放等价', () => {
    const chat = [floor('2026/9/30 08:00'), floor('', 120), floor('2026/9/30 10:00'), floor('2026/9/30 14:00')];
    const seed = weatherMoment(chat.slice(0, 2));
    expect(weatherMoment(chat.slice(2), seed)).toEqual(weatherMoment(chat));
  });
  it('仅正文连续逐字证据可用，计划或缺少证据的自由时长不结算', () => {
    expect(groundedWeatherElapsed({ elapsedMinutes: 360, evidence: '六小时后抵达。' }, '六小时后抵达。')).toBe(360);
    expect(groundedWeatherElapsed({ elapsedMinutes: 360, evidence: '脑补六小时' }, '正文')).toBeUndefined();
    expect(groundedWeatherElapsed({ elapsedMinutes: Infinity, evidence: '六小时后抵达。' }, '六小时后抵达。')).toBeUndefined();
    expect(groundedWeatherElapsed({ elapsedMinutes: 360, evidence: '计划六小时后出门。' }, '计划六小时后出门。')).toBeUndefined();
  });
});
