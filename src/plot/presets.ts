import type { ChatMsg } from '@/api/client';
import type { PlotSettings } from './model';
import { ENCOUNTER_GUIDANCE, plotSystemPrompt } from './model';
import { REALISM_GUIDANCE } from './realism';

/** 第三方预设的提示词是数据，只在用户选用后交给推演模型。 */
export interface PlotSegment { role: string; content: string }
export interface PlotTask {
  id?: string; name?: string; enabled?: boolean; stage?: number; order?: number;
  promptGroup?: PlotSegment[]; extractTags?: string; extractInjectTags?: string;
  finalDirectiveTemplate?: string; mergeStrategy?: string;
}
export interface PlotPreset {
  name: string;
  plotTasks?: PlotTask[];
  promptGroup?: PlotSegment[];
  prompts?: PlotSegment[];
  extractTags?: string;
  extractInjectTags?: string;
  finalSystemDirective?: string;
  worldbookEnabled?: boolean;
  contextTurnCount?: number;
  bbsSettings?: Partial<PlotSettings>;
  [key: string]: unknown;
}
export interface PlotMaterials {
  input: string; recent: string; history: string; state: string;
  knowledge?: string;
  encounter?: string;
  realism?: boolean;
  world: string; card: string; persona: string;
  indexed: Array<{ code: string; text: string }>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const tagList = (raw: unknown): string[] => typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(s => /^[a-z][\w-]{0,48}$/i.test(s)) : [];

export function activePlotTasks(preset: PlotPreset): PlotTask[] {
  const tasks = Array.isArray(preset.plotTasks) && preset.plotTasks.length
    ? preset.plotTasks.filter(t => t && t.enabled !== false)
    : [{ name: preset.name, promptGroup: preset.promptGroup?.length ? preset.promptGroup : preset.prompts,
      extractTags: preset.extractTags, extractInjectTags: preset.extractInjectTags }];
  return tasks.slice().sort((a, b) => (Number(a.stage) || 1) - (Number(b.stage) || 1) || (Number(a.order) || 0) - (Number(b.order) || 0));
}

function validSegments(raw: unknown): raw is PlotSegment[] {
  return Array.isArray(raw) && raw.length > 0 && raw.every(s => isRecord(s) &&
    typeof s.content === 'string' && typeof s.role === 'string' && ['system', 'user', 'assistant'].includes(s.role.toLowerCase()));
}

export function parsePlotPresets(text: string): PlotPreset[] {
  if (text.length > 2_000_000) throw new Error('预设文件超过 2 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('预设文件不是有效 JSON'); }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (!entries.length || entries.length > 30) throw new Error('一次最多导入 30 个预设');
  return entries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) throw new Error(`第 ${index + 1} 个预设缺少名称`);
    const preset = entry as unknown as PlotPreset;
    if (preset.name.trim().length > 120) throw new Error(`预设「${preset.name.slice(0, 30)}」名称过长`);
    const tasks = activePlotTasks(preset);
    if (!tasks.length || tasks.length > 12 || tasks.some(t => !validSegments(t.promptGroup))) {
      throw new Error(`预设「${preset.name}」没有可执行的提示词任务`);
    }
    return { ...preset, name: preset.name.trim() };
  });
}

export function exportPlotPreset(preset: PlotPreset): string {
  // 数据库本体导出单个预设时也包在数组中。
  return JSON.stringify([preset], null, 2);
}

export function currentPlotPreset(name: string, settings: PlotSettings): PlotPreset {
  const { presetName: _presetName, auto: _auto, channelId: _channelId, encounterEntries: _encounterEntries, ...saved } = settings;
  return {
    name: name.trim(),
    bbsSettings: saved,
    worldbookEnabled: settings.worldInfo,
    contextTurnCount: settings.contextCount,
    plotTasks: [{ id: 'bbsPlotTask', name: '剧情推演', enabled: true, order: 0, stage: 1,
      promptGroup: [
        { role: 'SYSTEM', content: plotSystemPrompt(settings) },
        { role: 'USER', content: '【角色与世界设定】\n$U\n$C\n$1\n【历史摘要】\n$5\n【当前状态】\n$S\n【最近剧情】\n$7\n【本轮用户意图】\n$8' },
      ] }],
  };
}

export function renderPresetMessages(task: PlotTask, materials: PlotMaterials, previous: string, substitute?: (text: string) => string): ChatMsg[] {
  const macros: Record<string, string> = {
    U: materials.persona, C: materials.card, '1': materials.world,
    '5': materials.indexed.map(e => `${e.code} ${e.text}`).join('\n'),
    '7': materials.recent, '8': materials.input, S: materials.state,
  };
  const messages: ChatMsg[] = (task.promptGroup ?? []).map(s => {
    let content = s.content.replace(/\$([UC1578S])\b/g, (_, key: string) => macros[key] || '无');
    if (substitute) content = substitute(content);
    return { role: s.role.toLowerCase() as ChatMsg['role'], content };
  });
  const hasPrefill = task.promptGroup?.[task.promptGroup.length - 1]?.role.toLowerCase() === 'assistant';
  const prefill = hasPrefill ? messages.pop() : undefined;
  if (materials.realism) messages.push({ role: 'system', content: REALISM_GUIDANCE });
  // 第三方预设未必认识柏宝书的 $S 宏。仍附上当前结构化状态，
  // 否则角色页记录的着装/伤病等只会偶然从近期正文里被模型看到。
  if (materials.state && !task.promptGroup?.some(s => /\$S\b/.test(s.content))) {
    messages.push({ role: 'system', content: `【柏宝书当前状态｜已发生事实】\n${materials.state}` });
  }
  if (materials.knowledge) messages.push({ role: 'system', content: `${materials.knowledge}\n请按上述已发生正文的认知记录约束本阶段推演；预设中的认知轨迹只是未来建议，不能直接改写已知事实。` });
  if (materials.encounter) messages.push({ role: 'system', content: `${ENCOUNTER_GUIDANCE}\n\n【本轮随机抽中的邂逅候选】\n${materials.encounter.slice(0, 12000)}` });
  if (previous) messages.push({ role: 'user', content: `【上一阶段结果】\n${previous.slice(0, 32000)}` });
  // 含预填充 assistant 的预设仍让它严格保持在最后。
  if (prefill) messages.push(prefill);
  return messages;
}

export function extractTaskOutput(raw: string, task: PlotTask): string {
  const tags = [...new Set([...tagList(task.extractTags), ...tagList(task.extractInjectTags)])];
  if (!tags.length) return raw.trim();
  const found: string[] = [];
  for (const tag of tags) {
    const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match?.[1]?.trim()) found.push(`<${tag}>\n${match[1].trim()}\n</${tag}>`);
  }
  return found.join('\n\n') || raw.trim();
}

export function recalledDetails(raw: string, materials: PlotMaterials): string {
  const recall = raw.match(/<recall>([\s\S]*?)<\/recall>/i)?.[1] ?? raw;
  const wanted = new Set((recall.match(/AM\d{4,}/gi) ?? []).map(s => s.toUpperCase()));
  return materials.indexed.filter(e => wanted.has(e.code)).map(e => `${e.code} ${e.text}`).join('\n');
}
