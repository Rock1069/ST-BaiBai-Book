import { reactive, watch } from 'vue';
import { apiSettings, engineActiveHere } from '@/api/settings';
import { requestCompletion, requestViaMainApi } from '@/api/client';
import { getContext, type STMessage } from '@/st/context';
import { toast } from '@/st/toast';
import { memory } from '@/memory/store';
import { formatKnowledge } from '@/memory/knowledge';
import { buildStateInjectionText, renderHistoryNodes, selectHistoryNodesBefore } from '@/memory/inject';
import { currentSummaryPromise, fetchCharCard, fetchEncounterProfile, fetchPlotWorldInfo, fetchUserPersona } from '@/memory/engine';
import { cleanBody, stripThinkBlocks } from '@/memory/timeTag';
import { prepareWeather } from '@/weather/store';
import { refreshPlotMessageCards } from '@/plotMessageCards';
import { buildPlotMessages, normalizePlotData, normalizePlotTurnPlan, plotEligible, plotInjection, PLOT_KEY, PLOT_PROMPT_KEY, shouldRunPlot, type PlotTurnPlan } from './model';
import { plotBeatCandidates, selectPlotHistory } from './architecture';
import { activePlotTasks, currentPlotPreset, exportPlotPreset, extractTaskOutput, parsePlotPresets, plotPresetDirective, recalledDetails, renderPresetMessages, type PlotMaterials, type PlotPreset } from './presets';

export const plot = reactive({ data: normalizePlotData(null), busy: false, autoBusy: false, phase: '', error: '', result: '', queued: false, available: false });
export const plotPresets = reactive<{ items: PlotPreset[] }>({ items: [] });
const PRESETS_KEY = 'baibai_book_plot_presets';
// SillyTavern: IN_CHAT=1、depth=0（最新消息之后）、USER=1。
const PLOT_POSITION_IN_CHAT = 1;
const PLOT_ROLE_USER = 1;
let scope = '';
let revision = 0;
let controller: AbortController | null = null;
let queuedUsers: STMessage[] | null = null;
let runningUsers: STMessage[] | null = null;
let injectedUser: STMessage | null = null;
let ready = false;

function hydratePresets(): void {
  const stored = getContext()?.extensionSettings?.[PRESETS_KEY];
  if (!Array.isArray(stored)) { plotPresets.items = []; return; }
  try { plotPresets.items = parsePlotPresets(JSON.stringify(stored)); }
  catch { plotPresets.items = []; }
}
function savePresets(items = plotPresets.items): void {
  const ctx = getContext();
  if (!ctx?.extensionSettings) throw new Error('酒馆设置尚未就绪，无法保存预设');
  const serialized = JSON.stringify(items);
  if (serialized.length > 2_000_000) throw new Error('预设库超过 2 MB，请先删除不需要的预设');
  ctx.extensionSettings[PRESETS_KEY] = JSON.parse(serialized);
  ctx.saveSettingsDebounced?.();
}
export function importPlotPresetText(text: string): string[] {
  const incoming = parsePlotPresets(text);
  if (!getContext()?.extensionSettings) throw new Error('酒馆设置尚未就绪，无法导入预设');
  if (plotPresets.items.length + incoming.length > 50) throw new Error('预设库最多保存 50 个预设');
  const names: string[] = [];
  const next = [...plotPresets.items];
  for (const preset of incoming) {
    const base = preset.name;
    let name = base;
    for (let n = 2; next.some(p => p.name === name); n++) name = `${base} (${n})`;
    next.push({ ...preset, name });
    names.push(name);
  }
  savePresets(next);
  plotPresets.items = next;
  if (plot.available && names[0]) selectPlotPreset(names[0]);
  return names;
}
export function saveCurrentPlotPreset(name: string): void {
  const title = name.trim();
  if (!title || title.length > 120) throw new Error('请输入 1–120 字的预设名称');
  if (plotPresets.items.some(p => p.name === title)) throw new Error('同名预设已存在，请换一个名称');
  if (plotPresets.items.length >= 50) throw new Error('预设库最多保存 50 个预设');
  if (!getContext()?.extensionSettings) throw new Error('酒馆设置尚未就绪，无法保存预设');
  const next = [...plotPresets.items, currentPlotPreset(title, plot.data.settings)];
  savePresets(next);
  plotPresets.items = next;
  selectPlotPreset(title);
}
export function selectPlotPreset(name: string): void {
  cancelPlot(); unqueuePlot();
  const preset = plotPresets.items.find(p => p.name === name);
  plot.data.settings.presetName = preset?.name ?? '';
  if (preset) {
    for (const key of ['contextCount', 'prompt', 'direction', 'worldInfo', 'realism'] as const) {
      const value = preset.bbsSettings?.[key];
      if (value !== undefined) (plot.data.settings as unknown as Record<string, unknown>)[key] = key === 'realism' ? value === true : value;
    }
    const promptMode = preset.bbsSettings?.promptMode;
    if (promptMode === 'classic' || promptMode === 'causal' || promptMode === 'custom') {
      plot.data.settings.promptMode = promptMode;
    } else if (typeof preset.bbsSettings?.prompt === 'string' && preset.bbsSettings.prompt.trim()) {
      plot.data.settings.promptMode = 'custom';
    }
    if (preset.bbsSettings?.contextCount === undefined && Number.isFinite(preset.contextTurnCount)) {
      plot.data.settings.contextCount = Math.max(1, Math.min(30, Number(preset.contextTurnCount)));
    }
    if (preset.bbsSettings?.worldInfo === undefined && typeof preset.worldbookEnabled === 'boolean') {
      plot.data.settings.worldInfo = preset.worldbookEnabled;
    }
  }
}
export function exportSelectedPlotPreset(): { name: string; text: string } {
  const preset = plotPresets.items.find(p => p.name === plot.data.settings.presetName);
  if (preset) return { name: preset.name, text: exportPlotPreset({
    ...preset, bbsSettings: { ...preset.bbsSettings, realism: plot.data.settings.realism === true },
  }) };
  return { name: '柏宝书剧情推进', text: exportPlotPreset(currentPlotPreset('柏宝书剧情推进', plot.data.settings)) };
}
export function removeSelectedPlotPreset(): void {
  const name = plot.data.settings.presetName;
  if (!name) return;
  if (!getContext()?.extensionSettings) throw new Error('酒馆设置尚未就绪，无法删除预设');
  const next = plotPresets.items.filter(p => p.name !== name);
  savePresets(next);
  plotPresets.items = next;
  selectPlotPreset('');
}
function activePreset(): PlotPreset | undefined {
  return plotPresets.items.find(p => p.name === plot.data.settings.presetName);
}

function chatScope(): string {
  const ctx = getContext();
  const id = ctx?.getCurrentChatId?.();
  return id ? JSON.stringify([ctx?.groupId ?? '', ctx?.characters?.[Number(ctx.characterId)]?.avatar ?? ctx?.characterId ?? '', id]) : '';
}
function userMessages(): STMessage[] {
  return (getContext()?.chat ?? []).filter(m => m.is_user);
}
/** 只复用已经交给正文并产生回复的旧推演档案，避免把未采用的草稿当成既成设定。 */
function priorSubmittedFiles(chat: STMessage[]): string {
  const files: string[] = [];
  const seen = new Set<string>();
  let hasReply = false;
  for (let i = chat.length - 1; i >= 0 && files.length < 6; i--) {
    const message = chat[i];
    if (!message?.is_user) {
      if (message && !message.is_system && plotEligible(message)) hasReply = true;
      continue;
    }
    const accepted = hasReply;
    hasReply = false;
    if (!accepted) continue;
    const plan = normalizePlotTurnPlan(message.extra?.bbs_plot_plan);
    if (!plan) continue;
    const blocks = [...plan.text.matchAll(/<file>([\s\S]*?)<\/file>/gi)].map(match => match[1].trim()).filter(Boolean);
    for (const block of blocks.reverse()) {
      if (seen.has(block)) continue;
      seen.add(block);
      files.push(block.slice(0, 4000));
      if (files.length >= 6) break;
    }
  }
  return files.join('\n\n').slice(0, 12000);
}
function sameUsers(expected: STMessage[]): boolean {
  const actual = userMessages();
  return actual.length === expected.length && expected.every((m, i) => actual[i] === m);
}
function queuedUsersValid(): boolean {
  if (!queuedUsers) return false;
  const actual = userMessages();
  // 手动建议可以供当前用户楼重新生成，也可以供下一条新用户消息使用。
  // 只核对用户楼的身份；AI 楼的删除、编辑和 swipe 不会让它失效。
  return (actual.length === queuedUsers.length || actual.length === queuedUsers.length + 1)
    && queuedUsers.every((m, i) => actual[i] === m);
}
export function clearPlotInjection(): void {
  injectedUser = null;
  getContext()?.setExtensionPrompt?.(PLOT_PROMPT_KEY, '', PLOT_POSITION_IN_CHAT, 0, false, PLOT_ROLE_USER);
}
function latestUserMessage(): STMessage | null {
  return [...(getContext()?.chat ?? [])].reverse().find(m => m.is_user && plotEligible(m)) ?? null;
}
function latestUserInput(): string {
  return latestUserMessage()?.mes ?? '';
}
function delivery(status: 'submitted' | 'skipped', source: 'auto' | 'manual', input: string, reason = '', prompt = '', reused = false): void {
  plot.data.delivery = { status, source, input, at: Date.now(), reason, prompt, reused };
}
function submitPlot(text: string, source: 'auto' | 'manual', input: string, directive = plotPresetDirective(activePreset()), reused = false): void {
  const fn = getContext()?.setExtensionPrompt;
  if (!fn) { delivery('skipped', source, input, '当前 ST 不支持扩展提示注入'); return; }
  const prompt = plotInjection(text, directive, input, formatKnowledge(memory.knowledge));
  fn(PLOT_PROMPT_KEY, prompt, PLOT_POSITION_IN_CHAT, 0, false, PLOT_ROLE_USER);
  injectedUser = latestUserMessage();
  delivery('submitted', source, input, '', prompt, reused);
}
function rememberPlot(text: string, source: 'auto' | 'manual', user: STMessage | null): void {
  if (!user) return;
  const plan: PlotTurnPlan = { text, source, directive: plotPresetDirective(activePreset()), createdAt: Date.now() };
  (user.extra ??= {}).bbs_plot_plan = plan;
  refreshPlotMessageCards();
  // 正文可能失败或被停止，不能等 AI 成功落楼才保存已付费获得的推演。
  const ctx = getContext();
  if (ctx?.saveChat) void ctx.saveChat().catch(e => console.warn('[柏宝书] 保存用户楼推演失败', e));
}
function onMessagesDeleted(): void {
  if (runningUsers && !sameUsers(runningUsers)) {
    cancelPlot();
    plot.error = '对应用户消息已删除，推演已失效';
  }
  if (plot.queued && !queuedUsersValid()) unqueuePlot();
  if (injectedUser && !(getContext()?.chat ?? []).includes(injectedUser)) clearPlotInjection();
}
export function cancelPlot(): void {
  revision++;
  controller?.abort();
  controller = null;
  runningUsers = null;
  plot.busy = false;
  plot.autoBusy = false;
  plot.phase = '';
}
export function unqueuePlot(): void {
  plot.queued = false;
  queuedUsers = null;
  clearPlotInjection();
}
function loadPlot(): void {
  ready = false;
  cancelPlot();
  unqueuePlot();
  scope = chatScope();
  plot.available = !!scope;
  plot.data = normalizePlotData(scope ? getContext()?.chatMetadata?.[PLOT_KEY] : null);
  plot.result = plot.data.result || plot.data.history[0]?.text || '';
  plot.error = '';
  ready = true;
}
export function queuePlot(): void {
  if (!scope || chatScope() !== scope || !plot.result.trim()) return;
  if (!engineActiveHere()) { toast('请先开启柏宝书记忆引擎，并确认当前角色未被排除', 'warning'); return; }
  if (!getContext()?.setExtensionPrompt) { toast('当前 ST 不支持扩展提示注入', 'error'); return; }
  queuedUsers = userMessages();
  plot.queued = true;
}

/** 主 API 不能中断网络请求；取消后立即释放等待，并丢弃迟到结果。 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('已取消剧情推演'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function generatePlot(input = plot.data.draft, weatherPrepared = false, source: 'manual' | 'auto' = 'manual'): Promise<string | null> {
  if (plot.busy) return null;
  const ctx = getContext();
  if (!ctx || !chatScope()) { plot.error = '请先打开一个聊天'; return null; }
  if (chatScope() !== scope) loadPlot();
  const run = ++revision;
  const origin = scope;
  const users = userMessages();
  runningUsers = users;
  const settings = normalizePlotData(plot.data).settings;
  const ctrl = new AbortController();
  controller = ctrl;
  plot.busy = true;
  plot.autoBusy = source === 'auto';
  plot.phase = '正在准备推演…';
  plot.error = '';
  unqueuePlot();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => {
    if (run !== revision || origin !== chatScope()) return false;
    if (ctrl.signal.aborted) { plot.error = '剧情推演已取消或超时，可重试'; return false; }
    if (!sameUsers(users)) { plot.error = '推演期间用户消息被删除或新增，旧结果已丢弃'; return false; }
    return true;
  };
  try {
    // 上一轮正文的摘要/总结可能刚由生成事件启动。先等它落叶并刷新认知，
    // 再读记忆发推演请求；等待时间不占推演 API 自身的 180 秒预算。
    const summarizing = currentSummaryPromise();
    if (summarizing) {
      plot.phase = '正在等待上一轮摘要…';
      await abortable(summarizing, ctrl.signal);
    }
    // 页面手动推演也先准备天气；生成拦截已准备好的天气在此复用。
    plot.phase = '正在准备剧情资料…';
    if (!weatherPrepared) await abortable(prepareWeather('normal'), ctrl.signal);
    if (!current()) return null;
    timer = setTimeout(() => ctrl.abort(), 180000);
    const channel = settings.channelId ? apiSettings.channels.find(c => c.id === settings.channelId) : null;
    if (settings.channelId && !channel) throw new Error('所选 API 渠道已删除，请重新选择');
    const recent = ctx.chat.map((m, i) => ({ m, i })).filter(({ m }) => plotEligible(m)).slice(-settings.contextCount);
    const historyNodes = selectHistoryNodesBefore(memory.summaries, ctx.chat, ctx.chat.length);
    const priorNodes = historyNodes.filter(n => n.msgIndex < (recent[0]?.i ?? ctx.chat.length));
    const knowledge = formatKnowledge(memory.knowledge);
    const stateBriefing = buildStateInjectionText();
    const state = [stateBriefing, knowledge && !stateBriefing.includes(knowledge) ? knowledge : ''].filter(Boolean).join('\n\n');
    const charCard = fetchCharCard();
    const persona = fetchUserPersona();
    const card = [charCard, persona].filter(Boolean).join('\n\n');
    const pickedEncounter = settings.encounterEntries.length
      ? settings.encounterEntries[Math.floor(Math.random() * settings.encounterEntries.length)]
      : undefined;
    const [world, encounter] = await Promise.all([
      settings.worldInfo ? abortable(fetchPlotWorldInfo(ctx.chat, recent.map(r => r.i), ctx.name1, ctx.name2, input, settings), ctrl.signal) : Promise.resolve(''),
      pickedEncounter ? abortable(fetchEncounterProfile(pickedEncounter.world, pickedEncounter.uid), ctrl.signal) : Promise.resolve(''),
    ]);
    if (!current()) return null;
    const recentText = recent.map(({ m }) => `${m.name}: ${cleanBody(m.mes)}`).join('\n\n');
    const preset = settings.presetName ? plotPresets.items.find(p => p.name === settings.presetName) : undefined;
    if (settings.presetName && !preset) throw new Error('所选剧情推进预设已删除，请重新选择');
    const request = (messages: Parameters<typeof requestViaMainApi>[0]) =>
      abortable(channel ? requestCompletion(channel, messages, { signal: ctrl.signal, plotTask: !!preset })
        : requestViaMainApi(messages, { plotTask: !!preset }), ctrl.signal);
    let raw: string;
    if (preset) {
      const history = renderHistoryNodes(priorNodes);
      const indexed = historyNodes.slice(-120).map((node, i) => ({ code: `AM${String(i + 1).padStart(4, '0')}`, text: node.text.slice(0, 2200) }));
      const previousFiles = /\{\{file\}\}/i.test(plotPresetDirective(preset)) ? priorSubmittedFiles(ctx.chat) : '';
      const materials: PlotMaterials = { input, recent: recentText, history, state, knowledge, encounter, realism: settings.realism, previousFiles, world, card: charCard, persona, indexed };
      let previous = '';
      const taskResults: string[] = [];
      const recalled: string[] = [];
      const tasks = activePlotTasks(preset);
      for (const [index, task] of tasks.entries()) {
        if (!current()) return null;
        plot.phase = `正在推演（${index + 1}/${tasks.length}）…`;
        const messages = renderPresetMessages(task, materials, previous, ctx.substituteParams);
        const answer = await request(messages);
        if (!current()) return null;
        const final = extractTaskOutput(answer, task);
        const details = recalledDetails(answer, materials);
        taskResults.push(final);
        if (details) recalled.push(details);
        previous = `${task.name || '上一任务'}：\n${final}${details ? `\n\n【已召回的实际记忆】\n${details}` : ''}`;
      }
      raw = [...taskResults, ...recalled.map(details => `【已召回的实际记忆】\n${details}`)].join('\n\n');
    } else {
      plot.phase = '正在推演…';
      const history = renderHistoryNodes(selectPlotHistory(priorNodes, input, memory.plans));
      const candidates = plotBeatCandidates(memory.plans, input, recentText);
      const messages = buildPlotMessages(settings, input, recentText, history, state, [card, world].filter(Boolean).join('\n\n'), encounter, candidates);
      raw = await request(messages);
    }
    if (!current()) return null;
    const text = stripThinkBlocks(raw).replace(/<(?:think|thinking|thought)\b[^>]*>[\s\S]*?(?:<\/(?:think|thinking|thought)>|$)/gi, '').trim().slice(0, 24000);
    if (!text) throw new Error('模型未返回有效的剧情推进内容');
    plot.result = text;
    plot.data.history.unshift({ text, input, createdAt: Date.now() });
    plot.data.history.splice(10);
    return text;
  } catch (e) {
    if (run === revision && origin === chatScope()) plot.error = ctrl.signal.aborted ? '剧情推演已取消或超时，可重试' : e instanceof Error ? e.message : String(e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    if (run === revision) { plot.busy = false; plot.autoBusy = false; plot.phase = ''; controller = null; runningUsers = null; }
  }
}

/** 独立槽位，只在正文拦截器中写入；quiet 请求不会递归触发规划。 */
export async function preparePlot(type?: string, weatherPrepared = false): Promise<void> {
  if (!shouldRunPlot(type)) return;
  clearPlotInjection();
  if (chatScope() !== scope) loadPlot();
  if (!engineActiveHere() || !scope) {
    unqueuePlot();
    if (scope) delivery('skipped', 'auto', latestUserInput(), '记忆引擎未开启，或当前角色被排除');
    return;
  }
  if (plot.queued) {
    const valid = queuedUsersValid();
    plot.queued = false;
    queuedUsers = null;
    if (valid && plot.result.trim()) {
      rememberPlot(plot.result, 'manual', latestUserMessage());
      submitPlot(plot.result, 'manual', latestUserInput());
      return;
    }
    delivery('skipped', 'manual', latestUserInput(), '用户消息已变化，待用建议已失效');
    toast('用户消息已变化，已取消待用的推进建议', 'info');
    if (!plot.data.settings.auto) return;
  }
  const user = latestUserMessage();
  const saved = normalizePlotTurnPlan(user?.extra?.bbs_plot_plan);
  if (saved) {
    plot.result = saved.text;
    submitPlot(saved.text, saved.source, latestUserInput(), saved.directive, true);
    return;
  }
  if (!plot.data.settings.auto) {
    delivery('skipped', 'auto', latestUserInput(), '自动推进未开启，也没有待用建议');
    return;
  }
  if (plot.busy) {
    delivery('skipped', 'auto', latestUserInput(), '推演请求仍在进行');
    return;
  }
  const input = latestUserInput();
  const origin = scope;
  const text = await generatePlot(input, weatherPrepared, 'auto');
  if (scope !== origin || chatScope() !== origin) return;
  if (latestUserMessage() !== user) return;
  if (text && engineActiveHere() && plot.data.settings.auto) {
    rememberPlot(text, 'auto', user);
    submitPlot(text, 'auto', input);
  }
  else {
    delivery('skipped', 'auto', input, plot.error || '推演已取消，或设置在推演期间发生变化');
    if (plot.error) toast(`剧情推进失败，正文照常生成：${plot.error}`, 'warning');
  }
}

export function bindPlot(): void {
  hydratePresets();
  loadPlot();
  watch(() => plot.data, () => {
    if (!ready || !scope || chatScope() !== scope) return;
    const ctx = getContext();
    if (!ctx?.chatMetadata) return;
    ctx.chatMetadata[PLOT_KEY] = normalizePlotData(plot.data);
    ctx.saveMetadataDebounced?.();
  }, { deep: true, flush: 'sync' });
  watch(() => plot.result, text => { if (ready) plot.data.result = text; }, { flush: 'sync' });
  watch(() => [apiSettings.enabled, apiSettings.excludedChars.slice(), plot.data.settings.auto], () => {
    cancelPlot();
    unqueuePlot();
  }, { flush: 'sync' });
  const ctx = getContext();
  if (!ctx) return;
  ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, loadPlot);
  // quiet 生成也会发 GENERATION_ENDED，因此用正文落楼/显式停止清理。
  ctx.eventSource.on(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, clearPlotInjection);
  if (ctx.eventTypes.MESSAGE_DELETED) ctx.eventSource.on(ctx.eventTypes.MESSAGE_DELETED, onMessagesDeleted);
  if (ctx.eventTypes.GENERATION_STOPPED) ctx.eventSource.on(ctx.eventTypes.GENERATION_STOPPED, () => { cancelPlot(); unqueuePlot(); });
}
