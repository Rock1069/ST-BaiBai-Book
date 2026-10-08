import type { ChatMsg } from '@/api/client';
import type { PlotSettings } from './model';
import { builtInPlotDirective, ENCOUNTER_GUIDANCE, plotSystemPrompt } from './model';
import { DEM_STABS_MATERIALS_TEMPLATE } from './demStabs';
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
  previousFiles?: string;
  world: string; card: string; persona: string;
  indexed: Array<{ code: string; text: string }>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const tagList = (raw: unknown): string[] => typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(s => /^[a-z][\w-]{0,48}$/i.test(s)) : [];
const KNOWN_MACROS = new Set(['U', 'C', 'S', '1', '5', '7', '8', 'INPUT', 'USER_INPUT', 'RECENT',
  'CHAT_HISTORY', 'HISTORY', 'SUMMARY', 'WORLD', 'WORLDBOOK', 'CHAR', 'CHARACTER', 'PERSONA', 'STATE', 'PREVIOUS']);

type PresetLayout = 'plotTasks' | 'tasks' | 'stages' | 'steps' | 'single';
interface TaskSource { layout: PresetLayout; values: Array<{ raw: unknown; stage: number; order: number }> }

/** 只识别结构含义明确的常见字段，保留原 JSON 供导出，不猜测任意脚本的私有语义。 */
function taskSource(preset: PlotPreset): TaskSource {
  const raw = preset as Record<string, unknown>;
  for (const layout of ['plotTasks', 'tasks', 'stages', 'steps'] as const) {
    const list = raw[layout];
    if (!Array.isArray(list) || !list.length) continue;
    const values: TaskSource['values'] = [];
    list.forEach((item, index) => {
      const nested = layout === 'stages' && isRecord(item)
        ? (Array.isArray(item.tasks) ? item.tasks : Array.isArray(item.steps) ? item.steps : null) : null;
      if (nested?.length) nested.forEach((step, order) => values.push({ raw: step, stage: index + 1, order }));
      else values.push({ raw: item, stage: layout === 'stages' ? index + 1 : 1, order: index });
    });
    return { layout, values };
  }
  return { layout: 'single', values: [{ raw: preset, stage: 1, order: 0 }] };
}

function roleOf(raw: unknown): PlotSegment['role'] | null {
  const role = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (role === 'system' || role === 'developer') return 'system';
  if (role === 'user' || role === 'human') return 'user';
  if (role === 'assistant' || role === 'model') return 'assistant';
  return null;
}

function segmentsOf(raw: unknown): PlotSegment[] | null {
  if (typeof raw === 'string' && raw.trim()) return [{ role: 'user', content: raw }];
  if (!Array.isArray(raw) || !raw.length) return null;
  const segments = raw.map(item => {
    if (typeof item === 'string') return { role: 'user', content: item };
    if (!isRecord(item)) return null;
    const role = roleOf(item.role ?? item.speaker ?? item.type);
    const content = item.content ?? item.text ?? item.prompt;
    return role && typeof content === 'string' ? { role, content } : null;
  });
  return segments.every(Boolean) ? segments as PlotSegment[] : null;
}

function taskMessages(raw: Record<string, unknown>): PlotSegment[] | null {
  for (const field of ['promptGroup', 'prompts', 'messages', 'segments', 'prompt']) {
    if (raw[field] === undefined || raw[field] === null) continue;
    const segments = segmentsOf(raw[field]);
    if (segments) return segments;
  }
  const system = raw.systemPrompt ?? raw.system;
  const user = raw.userPrompt ?? raw.user;
  const messages: PlotSegment[] = [];
  if (typeof system === 'string') messages.push({ role: 'system', content: system });
  if (typeof user === 'string') messages.push({ role: 'user', content: user });
  return messages.length ? messages : null;
}

function tagText(raw: unknown): string {
  return typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === 'string').join(',') : '';
}

function taskDisabled(raw: unknown): boolean {
  return isRecord(raw) && (raw.enabled === false || raw.disabled === true || raw.active === false);
}

function normalizeTask(raw: unknown, fallbackStage: number, fallbackOrder: number, name: string): PlotTask | null {
  const value = typeof raw === 'string' ? { prompt: raw } : Array.isArray(raw) ? { messages: raw } : raw;
  if (!isRecord(value) || taskDisabled(value)) return null;
  const promptGroup = taskMessages(value);
  if (!promptGroup) return null;
  const stage = Number(value.stage ?? fallbackStage);
  const order = Number(value.order ?? fallbackOrder);
  return {
    ...(value as PlotTask),
    name: typeof value.name === 'string' && value.name.trim() ? value.name : name,
    stage: Number.isFinite(stage) ? stage : fallbackStage,
    order: Number.isFinite(order) ? order : fallbackOrder,
    promptGroup,
    extractTags: tagText(value.extractTags ?? value.outputTags),
    extractInjectTags: tagText(value.extractInjectTags ?? value.injectTags),
  };
}

export function activePlotTasks(preset: PlotPreset): PlotTask[] {
  const source = taskSource(preset);
  return source.values.flatMap(({ raw, stage, order }) => {
    const task = normalizeTask(raw, stage, order, preset.name);
    return task ? [task] : [];
  }).sort((a, b) => (Number(a.stage) || 1) - (Number(b.stage) || 1) || (Number(a.order) || 0) - (Number(b.order) || 0));
}

export function plotPresetCompatibility(preset: PlotPreset): { layout: string; taskCount: number; notices: string[] } {
  const source = taskSource(preset);
  const tasks = activePlotTasks(preset);
  const labels: Record<PresetLayout, string> = {
    plotTasks: '剧情任务', tasks: '通用任务', stages: '阶段任务', steps: '步骤任务', single: '单段提示词',
  };
  const notices: string[] = [];
  if (isRecord(preset.loopSettings) || preset.contextExtractRules || preset.contextExcludeRules) {
    notices.push('原脚本的循环与上下文筛选规则不参与执行');
  }
  if (source.values.some(({ raw }) => isRecord(raw) && (raw.triggerWhen || raw.agentControl || raw.maxRetries || raw.minLength))) {
    notices.push('任务触发条件、Agent 控制、最短长度与重试次数不会自动执行');
  }
  if (source.values.some(({ raw }) => isRecord(raw) && typeof raw.mergeStrategy === 'string' && raw.mergeStrategy !== 'append')) {
    notices.push('自定义任务合并策略未实现，结果按任务顺序拼接');
  }
  const unknownMacros = [...new Set(tasks.flatMap(task => (task.promptGroup ?? []).flatMap(segment =>
    [...segment.content.matchAll(/\$([A-Za-z_]\w*|\d+)\b/g)].map(match => match[1])
      .filter(key => !KNOWN_MACROS.has(key.toUpperCase())))))];
  if (unknownMacros.length) notices.push(`发现未识别的 $ 占位符：${unknownMacros.slice(0, 8).map(key => `$${key}`).join('、')}`);
  if (source.values.length > tasks.length && tasks.length) notices.push('已关闭的任务不参与执行');
  return { layout: labels[source.layout], taskCount: tasks.length, notices };
}

/** 不同预设把正文模板放在顶层或末阶段；只采用明确的模板字段。 */
export function plotPresetDirective(preset?: PlotPreset): string {
  if (!preset) return '';
  const raw = preset as Record<string, unknown>;
  for (const key of ['finalSystemDirective', 'finalDirective', 'finalDirectiveTemplate', 'outputTemplate']) {
    if (typeof raw[key] === 'string' && raw[key].trim()) return raw[key] as string;
  }
  const last = activePlotTasks(preset).at(-1);
  return typeof last?.finalDirectiveTemplate === 'string' ? last.finalDirectiveTemplate : '';
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
    const source = taskSource(preset);
    const invalid = source.values.findIndex(({ raw, stage, order }) =>
      !taskDisabled(raw) && !normalizeTask(raw, stage, order, preset.name));
    if (invalid >= 0) throw new Error(`预设「${preset.name}」第 ${invalid + 1} 个启用任务的提示词结构无法识别`);
    const tasks = activePlotTasks(preset);
    if (!tasks.length || tasks.length > 12) {
      throw new Error(`预设「${preset.name}」没有可识别的提示词任务，支持 plotTasks、tasks、stages、steps 或单段 messages/prompt`);
    }
    return { ...preset, name: preset.name.trim() };
  });
}

export function exportPlotPreset(preset: PlotPreset): string {
  // 数据库本体导出单个预设时也包在数组中。
  return JSON.stringify([preset], null, 2);
}

export function currentPlotPreset(name: string, settings: PlotSettings): PlotPreset {
  const { presetName: _presetName, auto: _auto, channelId: _channelId, encounterEntries: _encounterEntries,
    worldbookSource: _worldbookSource, selectedWorldbooks: _selectedWorldbooks, worldbookEntries: _worldbookEntries, ...saved } = settings;
  return {
    name: name.trim(),
    bbsSettings: saved,
    worldbookEnabled: settings.worldInfo,
    contextTurnCount: settings.contextCount,
    ...(builtInPlotDirective(settings) ? { finalSystemDirective: builtInPlotDirective(settings) } : {}),
    plotTasks: [{ id: 'bbsPlotTask', name: '剧情推演', enabled: true, order: 0, stage: 1,
      promptGroup: [
        { role: 'SYSTEM', content: plotSystemPrompt(settings) },
        { role: 'USER', content: settings.promptMode === 'dem_stabs'
          ? `${DEM_STABS_MATERIALS_TEMPLATE}\n【推进偏好】\n${settings.direction || '自然衔接，适度推进'}`
          : '【角色与世界设定】\n$U\n$C\n$1\n【历史摘要】\n$5\n【当前状态】\n$S\n【最近剧情】\n$7\n【本轮用户意图】\n$8' },
      ] }],
  };
}

export function renderPresetMessages(task: PlotTask, materials: PlotMaterials, previous: string, substitute?: (text: string) => string): ChatMsg[] {
  const macros: Record<string, string> = {
    U: materials.persona, C: materials.card, '1': materials.world,
    '5': materials.indexed.map(e => `${e.code} ${e.text}`).join('\n'),
    '7': materials.recent, '8': materials.input, S: materials.state,
    INPUT: materials.input, USER_INPUT: materials.input,
    RECENT: materials.recent, CHAT_HISTORY: materials.recent,
    HISTORY: materials.history, SUMMARY: materials.history,
    WORLD: materials.world, WORLDBOOK: materials.world,
    CHAR: materials.card, CHARACTER: materials.card,
    PERSONA: materials.persona, STATE: materials.state, PREVIOUS: previous,
  };
  const messages: ChatMsg[] = (task.promptGroup ?? []).map(s => {
    let content = s.content.replace(/\$([A-Za-z_]\w*|\d+)\b/g, (original, key: string) =>
      KNOWN_MACROS.has(key.toUpperCase()) ? macros[key.toUpperCase()] || '无' : original);
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
  if (materials.previousFiles) messages.push({ role: 'system', content: `【先前已提交给正文的推演人物档案｜一致性线索，非已发生事实】\n${materials.previousFiles}\n这些档案来自旧推演。先核对正文与摘要：已被正文落实的性格设定应保持一致；未落实或与正文冲突的内容不得当作既成事实。` });
  if (materials.encounter) messages.push({ role: 'system', content: `${ENCOUNTER_GUIDANCE}\n\n【本轮随机抽中的邂逅候选】\n${materials.encounter.slice(0, 12000)}` });
  if (previous && !task.promptGroup?.some(s => /\$PREVIOUS\b/i.test(s.content))) {
    messages.push({ role: 'user', content: `【上一阶段结果】\n${previous.slice(0, 32000)}` });
  }
  // 含预填充 assistant 的预设仍让它严格保持在最后。
  if (prefill) messages.push(prefill);
  return messages;
}

export function extractTaskOutput(raw: string, task: PlotTask): string {
  const tags = [...new Set([...tagList(task.extractTags), ...tagList(task.extractInjectTags)])];
  if (!tags.length) return raw.trim();
  const found: string[] = [];
  for (const tag of tags) {
    for (const match of raw.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi'))) {
      if (match[1]?.trim()) found.push(`<${tag}>\n${match[1].trim()}\n</${tag}>`);
    }
  }
  return found.join('\n\n') || raw.trim();
}

export function recalledDetails(raw: string, materials: PlotMaterials): string {
  const recall = raw.match(/<recall>([\s\S]*?)<\/recall>/i)?.[1] ?? raw;
  const wanted = new Set((recall.match(/AM\d{4,}/gi) ?? []).map(s => s.toUpperCase()));
  return materials.indexed.filter(e => wanted.has(e.code)).map(e => `${e.code} ${e.text}`).join('\n');
}
