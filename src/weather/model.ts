import type { STMessage } from '@/st/context';
import { parseStoryClock } from '@/memory/storyClock';
import { clampToTimeTags, parseTimeRange } from '@/memory/timeTag';

export const WEATHER_KEY = 'bbs_weather_v1';
export const WEATHER_GROUPS = ['天空', '雨', '雪与冰', '风', '能见度', '极端与其他'] as const;
export const WEATHER_CATALOG = [
  ['clear', '晴', '天空'], ['partly-cloudy', '少云', '天空'], ['cloudy', '多云', '天空'], ['overcast', '阴', '天空'],
  ['drizzle', '毛毛雨', '雨'], ['light-rain', '小雨', '雨'], ['moderate-rain', '中雨', '雨'], ['heavy-rain', '大雨', '雨'],
  ['rainstorm', '暴雨', '雨'], ['severe-rainstorm', '大暴雨', '雨'], ['extreme-rainstorm', '特大暴雨', '雨'],
  ['shower', '阵雨', '雨'], ['thundershower', '雷阵雨', '雨'], ['freezing-rain', '冻雨', '雨'], ['sunshower', '太阳雨', '雨'],
  ['light-snow', '小雪', '雪与冰'], ['moderate-snow', '中雪', '雪与冰'], ['heavy-snow', '大雪', '雪与冰'],
  ['snowstorm', '暴雪', '雪与冰'], ['blizzard', '风吹雪／暴风雪', '雪与冰'], ['snow-shower', '阵雪', '雪与冰'],
  ['sleet', '雨夹雪', '雪与冰'], ['ice-pellets', '冰粒', '雪与冰'], ['graupel', '霰', '雪与冰'], ['hail', '冰雹', '雪与冰'],
  ['frost', '霜', '雪与冰'], ['rime', '雾凇', '雪与冰'], ['glaze', '雨凇', '雪与冰'],
  ['calm', '无风', '风'], ['breeze', '微风', '风'], ['moderate-wind', '和风', '风'], ['strong-wind', '强风', '风'],
  ['gale', '大风', '风'], ['squall', '飑／突发强风', '风'], ['dry-hot-wind', '干热风', '风'], ['foehn', '焚风', '风'],
  ['mist', '轻雾', '能见度'], ['fog', '雾', '能见度'], ['dense-fog', '浓雾', '能见度'], ['freezing-fog', '冻雾', '能见度'],
  ['haze', '霾', '能见度'], ['smog', '烟雾', '能见度'], ['dust', '浮尘', '能见度'], ['blowing-sand', '扬沙', '能见度'],
  ['sandstorm', '沙尘暴', '能见度'], ['severe-sandstorm', '强沙尘暴', '能见度'],
  ['thunderstorm', '雷暴', '极端与其他'], ['dry-thunderstorm', '干雷暴', '极端与其他'], ['typhoon', '台风', '极端与其他'],
  ['hurricane', '飓风', '极端与其他'], ['tropical-storm', '热带风暴', '极端与其他'], ['tornado', '龙卷风', '极端与其他'],
  ['waterspout', '水龙卷', '极端与其他'], ['heatwave', '热浪／酷热', '极端与其他'], ['coldwave', '寒潮／严寒', '极端与其他'],
  ['rainbow', '雨后彩虹', '极端与其他'], ['dew', '露', '极端与其他'],
] as const;
export const WEATHER_OPTIONS = WEATHER_CATALOG.map(([value, label, group]) => ({ value, label, group }));
const ids = new Set<string>(WEATHER_OPTIONS.map(o => o.value));
const text = (v: unknown, n = 600): string => typeof v === 'string' ? v.trim().slice(0, n) : '';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, fallback = 0): number => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export interface WeatherValue { conditions: string[]; custom: string; description: string; temperatureC?: number }
export interface WeatherMoment { minutes: number; clock: string; debt: number; time: string }
export interface WeatherChoice { value: WeatherValue; minute: number; time: string; transition: string }
export interface WeatherData {
  version: 1; enabled: boolean; mode: 'auto' | 'manual'; intervalHours: 3 | 6 | 12; climate: string;
  manual: WeatherValue; current: WeatherChoice | null; history: WeatherChoice[];
  /** 带数据创建新对话时恢复窗口之前的故事时钟。 */
  seed: WeatherMoment | null;
}
export function normalizeWeatherValue(raw: unknown): WeatherValue {
  const o = record(raw) ? raw : {};
  const temperatureC = typeof o.temperatureC === 'number' && Number.isFinite(o.temperatureC)
    && o.temperatureC >= -100 && o.temperatureC <= 70 ? Math.round(o.temperatureC * 10) / 10 : undefined;
  return { conditions: Array.isArray(o.conditions) ? [...new Set(o.conditions.filter((x): x is string => typeof x === 'string' && ids.has(x)))].slice(0, 6) : [], custom: text(o.custom, 120), description: text(o.description),
    ...(temperatureC !== undefined ? { temperatureC } : {}) };
}
export function weatherLabel(v: WeatherValue): string {
  return [...v.conditions.map(id => WEATHER_OPTIONS.find(o => o.value === id)?.label).filter(Boolean), v.custom].filter(Boolean).join('＋');
}
export function weatherTemperatureLabel(v: WeatherValue): string { return typeof v.temperatureC === 'number' ? `${v.temperatureC}℃` : ''; }
export function weatherSignature(v: WeatherValue): string { return JSON.stringify([[...v.conditions].sort(), v.custom.trim().toLowerCase()]); }
function cleanChoice(raw: unknown): WeatherChoice | null {
  if (!record(raw)) return null;
  const value = normalizeWeatherValue(raw.value); if (!weatherLabel(value)) return null;
  return { value, minute: finite(raw.minute), time: text(raw.time, 160), transition: text(raw.transition, 300) };
}
export function normalizeWeatherData(raw: unknown): WeatherData {
  const o = record(raw) ? raw : {};
  const manual = normalizeWeatherValue(o.manual);
  if (!weatherLabel(manual)) manual.conditions = ['clear'];
  return { version: 1, enabled: o.enabled === true, mode: o.mode === 'manual' ? 'manual' : 'auto',
    intervalHours: o.intervalHours === 3 || o.intervalHours === 12 ? o.intervalHours : 6, climate: text(o.climate, 400), manual,
    current: cleanChoice(o.current), history: Array.isArray(o.history) ? o.history.map(cleanChoice).filter((x): x is WeatherChoice => !!x).slice(-10) : [],
    seed: record(o.seed) ? { minutes: finite(o.seed.minutes), clock: text(o.seed.clock, 160), debt: Math.max(0, finite(o.seed.debt)), time: text(o.seed.time, 160) } : null,
  };
}
function validLeaf(m: STMessage): boolean {
  const leaf = m.extra?.bbs_leaf;
  return !!leaf?.id && (leaf.swipe ?? 0) === (m.swipe_id ?? 0);
}
/** 重放故事时间，不使用 Date.now 或现实定时器。相对时长与随后补齐的日期抵扣。 */
export function weatherMoment(chat: STMessage[], seed: WeatherMoment | null = null): WeatherMoment {
  const out: WeatherMoment = seed ? { ...seed } : { minutes: 0, clock: '', debt: 0, time: '' };
  for (const m of chat) {
    if (m.extra?.bbs_omit || m.is_user || (m.is_system && m.extra?.type)) continue;
    const leaf = validLeaf(m) ? m.extra?.bbs_leaf : undefined;
    // carryover的记忆种子时间可能早于正文时钟；天气已有独立种子，不重复消费它。
    if (seed && leaf?.seed) continue;
    const tag = parseTimeRange(clampToTimeTags(m.mes || ''));
    const time = tag.end || tag.start || leaf?.timeEnd || leaf?.timeStart || leaf?.delta.time || '';
    const old = parseStoryClock(out.clock), next = parseStoryClock(time);
    const relative = Math.max(0, finite(leaf?.delta.weatherElapsedMinutes));
    const comparable = old && next && old.calendar === next.calendar && old.precision === next.precision;
    if (comparable && next.minute > old.minute) {
      const diff = next.minute - old.minute;
      out.minutes += Math.max(0, diff - out.debt); out.debt = Math.max(0, out.debt - diff);
    } else if (comparable && next.minute < old.minute) out.debt = 0;
    else if (relative) { out.minutes += relative; out.debt += relative; }
    if (next) { if (!comparable) out.debt = 0; out.clock = time; }
    if (time) out.time = time;
  }
  return out;
}
export function weatherDue(data: WeatherData, moment: WeatherMoment): boolean {
  return data.enabled && data.mode === 'auto' && (!data.current || moment.minutes - data.current.minute >= data.intervalHours * 60);
}
export function currentWeather(data: WeatherData): WeatherValue | null {
  return !data.enabled ? null : data.mode === 'manual' ? data.manual : data.current?.value ?? null;
}
export function weatherBriefing(data: WeatherData): string {
  const v = currentWeather(data); if (!data.enabled) return '';
  if (!v) return '[天气控制]\nAI随机天气尚未选定；天气卡片可重试选择。';
  return `[天气控制·${data.mode === 'manual' ? '用户手动固定' : 'AI按故事时间选择'}]\n当前天气：${weatherLabel(v)}${typeof v.temperatureC === 'number' ? `\n室外温度：${data.mode === 'auto' ? '约' : ''}${weatherTemperatureLabel(v)}` : ''}${v.description ? `\n表现：${v.description}` : ''}`
    + (data.mode === 'auto' && data.current?.transition ? `\n转变：${data.current.transition}` : '')
    + (data.climate ? `\n气候设定：${data.climate}` : '')
    + (data.mode === 'manual' ? '\n此天气持续固定，只有用户在天气卡片重新选择或切换模式才能改变；剧情、角色能力及故事时间推进不得覆盖该选择。' : `\n在下一次天气选择前沿用以上天气；每${data.intervalHours}故事小时才重新选择，不可自行提前改成其他天气。`)
    + '\n将天气与温度自然用于环境与人物行动；温度是幕后环境信息，历史或架空角色不必直接说摄氏度。室内不强行表现室外天气，不罗列天气面板，不因天气自动宣告灾害结果。';
}
/** 严格校验模型选择，禁止用改写描述绕过“换一种天气”。 */
export function parseWeatherChoice(raw: unknown, previous: WeatherValue | null, requireTemperature = false): { value: WeatherValue; transition: string } {
  if (!record(raw) || !Array.isArray(raw.conditions) || !raw.conditions.length || raw.conditions.length > 6
    || raw.conditions.some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('AI天气返回无效类别，请重试');
  if (requireTemperature && !('temperatureC' in raw)) throw new Error('AI天气缺少温度，请重试');
  if ('temperatureC' in raw && (typeof raw.temperatureC !== 'number' || !Number.isFinite(raw.temperatureC)
    || raw.temperatureC < -100 || raw.temperatureC > 70)) throw new Error('AI天气返回无效温度，请重试');
  const value = normalizeWeatherValue({ ...raw, custom: '' });
  for (const exclusive of [
    ['clear', 'partly-cloudy', 'cloudy', 'overcast'],
    ['drizzle', 'light-rain', 'moderate-rain', 'heavy-rain', 'rainstorm', 'severe-rainstorm', 'extreme-rainstorm'],
    ['light-snow', 'moderate-snow', 'heavy-snow', 'snowstorm'],
    ['calm', 'breeze', 'moderate-wind', 'strong-wind', 'gale'],
    ['mist', 'fog', 'dense-fog'],
  ]) if (value.conditions.filter(id => exclusive.includes(id)).length > 1) throw new Error('AI天气包含互斥状态，请重试');
  if (previous && weatherSignature(value) === weatherSignature(previous)) throw new Error('AI重复选择了原天气，请重试');
  return { value, transition: text(raw.transition, 300) };
}
export function groundedWeatherElapsed(raw: unknown, source: string): number | undefined {
  if (!record(raw)) return undefined;
  const minutes = finite(raw.elapsedMinutes), evidence = text(raw.evidence);
  if (/计划|打算|准备|将于|将会|预计|如果|假如|回忆|曾经|怀孕|孕期|年龄|岁|plans? to|would|pregnan|years? old/i.test(evidence)) return undefined;
  return minutes > 0 && minutes <= 5256000 && evidence.length >= 4 && source.includes(evidence) ? minutes : undefined;
}
export const WEATHER_ELAPSED_PROTOCOL = `【天气故事时钟协议】
天气控制使用故事时间。仅本段明确经过的总时长可在最终JSON额外写 weather:{elapsedMinutes:分钟数,evidence:正文连续逐字时间短句(至少4字)}。绝对日期由程序优先计算，该字段只在日期缺失/没有变化时备用。不要把年龄、孕期天数、回忆、计划或推演建议当成已过去时长；同一段时长只算一次。没有可靠时长则省略 weather。不要改变天气模式、间隔或固定天气。`;
