<script setup lang="ts">
import { computed, ref } from 'vue';
import BbsSelect from '@/components/BbsSelect.vue';
import Icon from '@/components/Icon.vue';
import PlotPresentation from '@/components/PlotPresentation.vue';
import { apiSettings } from '@/api/settings';
import { extractPlotSection, isPlotPromptMode, plotEligible, plotSystemPrompt } from '@/plot/model';
import { plotPresetCompatibility } from '@/plot/presets';
import { listPlotBeatOptions } from '@/plot/architecture';
import KnowledgePanel from './KnowledgePanel.vue';
import WorldbookPanel from './WorldbookPanel.vue';
import { memory, derivedMeta } from '@/memory/store';
import { cleanBody } from '@/memory/timeTag';
import { cancelPlot, exportSelectedPlotPreset, generatePlot, importPlotPresetText, loadPlotRecord, plot, plotDraftForChat, plotPresets, queuePlot, removeSelectedPlotPreset, saveCurrentPlotPreset, selectPlotPreset, unqueuePlot } from '@/plot/store';
import { appendChatInput, getContext, listWorldInfoEntries, type WorldInfoCatalogEntry } from '@/st/context';
import { toast } from '@/st/toast';
import { closeBook } from '@/state/ui';

const channels = computed(() => [
  { value: '', label: '跟随主 API' },
  ...apiSettings.channels.map(c => ({ value: c.id, label: c.name || c.model || c.id })),
  ...(plot.data.settings.channelId && !apiSettings.channels.some(c => c.id === plot.data.settings.channelId)
    ? [{ value: plot.data.settings.channelId, label: '渠道已删除，请重新选择' }] : []),
]);
const presetOptions = computed(() => [
  { value: '', label: '柏宝书内置 / 自定义提示词' },
  ...plotPresets.items.map(p => ({ value: p.name, label: p.name })),
  ...(plot.data.settings.presetName && !plotPresets.items.some(p => p.name === plot.data.settings.presetName)
    ? [{ value: plot.data.settings.presetName, label: '预设已删除，请重新选择' }] : []),
]);
const presetCompatibility = computed(() => {
  const selected = plotPresets.items.find(item => item.name === plot.data.settings.presetName);
  return selected ? plotPresetCompatibility(selected) : null;
});
const promptOptions = [
  { value: 'classic', label: '内置一：自然衔接（原版）' },
  { value: 'causal', label: '内置二：角色因果（新）' },
  { value: 'dem_stabs', label: '内置三：DEM × Stab’s（场景导演）' },
  { value: 'custom', label: '自定义提示词' },
];
const activePrompt = computed(() => plotSystemPrompt(plot.data.settings));
function selectPromptMode(value: string) {
  if (isPlotPromptMode(value)) plot.data.settings.promptMode = value;
}
const promptDescription = computed(() => ({
  classic: '自然衔接：沿用原版内置提示词，优先顺接当前场景。',
  causal: '角色因果：核对行动触发、角色目标与已知信息，再安排一个有即时后果的情节点。',
  dem_stabs: '场景导演：结合 DEM 的路线与伏笔推进、Stab’s 的人物行为与认知边界，四条候选自动择一；一次调用完成，只把选定规划交给正文。',
  custom: '自定义：使用下方提示词；原有自定义内容会保留。',
})[plot.data.settings.promptMode]);
const newPresetName = ref('');
const presetFile = ref<HTMLInputElement | null>(null);
const presetMessage = ref('');
const resultView = ref<'preview' | 'edit'>('preview');
const beatOptions = computed(() => {
  void derivedMeta.rev;
  const recent = (getContext()?.chat ?? []).filter(plotEligible).slice(-plot.data.settings.contextCount)
    .map(message => `${message.name}: ${cleanBody(message.mes)}`).join('\n\n');
  return listPlotBeatOptions(memory.plans, plot.data.draft, recent);
});
const selectedBeat = computed(() => extractPlotSection(plot.result, '选定情节点'));
const selectedAction = computed(() => extractPlotSection(plot.result, '下一段行动'));
const encounterCatalog = ref<WorldInfoCatalogEntry[]>([]);
const encounterLoading = ref(false);
const encounterLoaded = ref(false);
const encounterError = ref('');
const encounterSearch = ref('');
const encounterWorld = ref('');
const encounterWorldOptions = computed(() => [
  { value: '', label: '全部世界书' },
  ...[...new Set(encounterCatalog.value.map(entry => entry.world))]
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map(world => ({ value: world, label: world })),
]);
const filteredEncounterEntries = computed(() => {
  const query = encounterSearch.value.trim().toLocaleLowerCase();
  return encounterCatalog.value.filter(entry => {
    if (encounterWorld.value && entry.world !== encounterWorld.value) return false;
    if (!query) return true;
    return [entry.comment, entry.world, entry.uid, ...entry.keys, entry.content]
      .some(value => value.toLocaleLowerCase().includes(query));
  });
});
const selectedEncounterEntries = computed(() => plot.data.settings.encounterEntries.map(ref => ({
  ...ref,
  entry: encounterCatalog.value.find(entry => entry.world === ref.world && entry.uid === ref.uid),
})));
function encounterLabel(entry?: WorldInfoCatalogEntry, uid = ''): string {
  return entry?.comment || entry?.keys[0] || uid;
}
function isEncounterSelected(entry: WorldInfoCatalogEntry): boolean {
  return plot.data.settings.encounterEntries.some(ref => ref.world === entry.world && ref.uid === entry.uid);
}
function setEncounter(world: string, uid: string, checked: boolean) {
  const selected = plot.data.settings.encounterEntries;
  const index = selected.findIndex(ref => ref.world === world && ref.uid === uid);
  if (checked && index < 0) {
    if (selected.length >= 50) { toast('邂逅候选最多选择 50 个', 'warning'); return; }
    selected.push({ world, uid });
  } else if (!checked && index >= 0) selected.splice(index, 1);
}
function toggleEncounter(entry: WorldInfoCatalogEntry, checked: boolean) {
  setEncounter(entry.world, entry.uid, checked);
}
async function loadEncounterCatalog() {
  if (encounterLoading.value) return;
  encounterLoading.value = true;
  encounterError.value = '';
  try {
    encounterCatalog.value = await listWorldInfoEntries();
    encounterLoaded.value = true;
  } catch (e) {
    encounterError.value = e instanceof Error ? e.message : '读取世界书失败';
  } finally { encounterLoading.value = false; }
}
async function onPresetFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('预设文件超过 2 MB');
    const names = importPlotPresetText(await file.text());
    presetMessage.value = `已导入 ${names.length} 个预设：${names.join('、')}`;
    toast(presetMessage.value, 'success');
  } catch (e) {
    presetMessage.value = e instanceof Error ? e.message : '预设导入失败';
    toast(presetMessage.value, 'error');
  } finally { target.value = ''; }
}
function savePreset() {
  try {
    saveCurrentPlotPreset(newPresetName.value);
    presetMessage.value = `已保存预设「${newPresetName.value.trim()}」`;
    newPresetName.value = '';
    toast(presetMessage.value, 'success');
  } catch (e) { presetMessage.value = e instanceof Error ? e.message : '保存失败'; }
}
function exportPreset() {
  const { name, text } = exportSelectedPlotPreset();
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.plot-preset.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  presetMessage.value = `已导出预设「${name}」`;
}
function removePreset() {
  const name = plot.data.settings.presetName;
  if (!name || !window.confirm(`从预设库删除「${name}」？其他聊天若选用了它，也将无法继续使用。`)) return;
  removeSelectedPlotPreset();
  presetMessage.value = `已删除预设「${name}」`;
}
function appendDraft() {
  if (appendChatInput(plotDraftForChat())) {
    unqueuePlot();
    closeBook();
    toast('已追加到输入框，可修改后发送', 'success');
  } else toast('未找到聊天输入框', 'warning');
}
</script>

<template>
  <section class="plot-page">
    <header>
      <h2 class="bbs-title bbs-title-sub"><Icon name="plot" /> 剧情推进</h2>
      <p>自动从未了结计划、悬念与当前场景挑选下一步，参考相关摘要、总结和近期正文。推演建议不会写入事实台账。</p>
    </header>
    <section v-if="plot.available" class="panel beat-panel" aria-label="剧情推进架构">
      <div class="beat-heading">
        <div><strong>下一情节点</strong><p class="hint">{{ plot.data.settings.presetName ? '当前使用导入的多阶段预设' : '内置架构 · 根据已发生剧情自动挑选' }}</p></div>
        <span class="beat-mode">{{ plot.data.settings.presetName ? '预设模式' : '自动选择' }}</span>
      </div>
      <template v-if="!plot.data.settings.presetName">
        <p class="hint">候选来自尚未了结的计划、悬念和当前场景；这里只预览，不需要手动点选。正式推演以发送时的用户消息和最新正文为准。</p>
        <ol class="beat-list">
          <li v-for="option in beatOptions" :key="option.id" class="beat-option">
            <span class="beat-kind">{{ option.kind === 'scene' ? '场景延续' : option.kind === 'suspense' ? '悬念' : '计划' }}</span>
            <span>{{ option.content }}<small v-if="option.targetTime">目标时间：{{ option.targetTime }}</small></span>
          </li>
        </ol>
        <div v-if="selectedBeat" class="beat-selected" role="status">
          <strong>上次选定</strong><p>{{ selectedBeat }}</p>
          <details v-if="selectedAction"><summary>查看下一段行动</summary><p>{{ selectedAction }}</p></details>
        </div>
      </template>
      <p v-else class="hint">导入预设仍按自身任务顺序推演。切换到“柏宝书内置 / 自定义提示词”即可使用自动情节点选择。</p>
    </section>
    <p v-if="!plot.available" class="notice">请先打开一个聊天，再配置或使用剧情推进。</p>
    <div v-if="plot.data.delivery" class="panel" role="status">
      <strong>{{ plot.data.delivery.status === 'submitted' ? '上一轮已提交到正文的用户层' : '上一轮未提交推演建议' }}</strong>
      <p class="hint">{{ new Date(plot.data.delivery.at).toLocaleString() }} · {{ plot.data.delivery.source === 'auto' ? '自动推进' : '手动建议' }}<template v-if="plot.data.delivery.input"> · 用户输入：{{ plot.data.delivery.input.slice(0, 80) }}</template></p>
      <p v-if="plot.data.delivery.reused" class="hint">已复用对应用户消息的推演，本次没有额外调用推演 API。</p>
      <p v-if="plot.data.delivery.reason" class="hint">{{ plot.data.delivery.reason }}</p>
      <p v-if="plot.data.delivery.status === 'submitted'" class="hint">本轮用户输入与推演结果已交给酒馆；用户消息正文保持原样。可在设置中开启「在用户消息展示推演」，展开查看已保存的建议。正文模型是否采纳仍取决于本轮生成。</p>
      <details v-if="plot.data.delivery.prompt"><summary>查看提交给正文的用户层内容</summary><pre>{{ plot.data.delivery.prompt }}</pre></details>
    </div>
    <KnowledgePanel />
    <div class="panel">
      <label>剧情推进预设
        <BbsSelect :model-value="plot.data.settings.presetName" :options="presetOptions" aria-label="剧情推进预设" @update:model-value="selectPlotPreset" />
      </label>
      <p class="hint">内置模式有三套可选提示词，都会自动挑选下一情节点，使用精简上下文完成一次推演。也可导入数据库本体的 JSON 预设；选中预设时按其任务顺序执行，可能需要多次模型调用。预设库跨聊天保存，当前选择随聊天保存。</p>
      <div v-if="presetCompatibility" class="preset-compatibility" role="status">
        <strong>自动识别：{{ presetCompatibility.layout }} · {{ presetCompatibility.taskCount }} 个任务</strong>
        <p v-for="notice in presetCompatibility.notices" :key="notice">{{ notice }}</p>
        <p v-if="!presetCompatibility.notices.length">提示词结构已识别，按该预设自身的任务顺序执行。</p>
      </div>
      <p class="hint">依赖原脚本专属表格、Agent 世界书控制或其他插件变量的预设，可导入保存，但这些能力无法在柏宝书中执行；请先手动推演一次检查结果。</p>
      <div class="actions">
        <input ref="presetFile" class="file-input" type="file" accept=".json,application/json" aria-label="选择剧情推进预设 JSON" @change="onPresetFile" />
        <button type="button" class="bbs-btn" @click="presetFile?.click()">导入预设 JSON</button>
        <button type="button" class="bbs-btn" @click="exportPreset">导出当前预设</button>
        <button v-if="plot.data.settings.presetName" type="button" class="bbs-btn" @click="removePreset">删除选中预设</button>
      </div>
      <div class="actions">
        <input v-model="newPresetName" type="text" maxlength="120" :disabled="!plot.available || !!plot.data.settings.presetName" placeholder="内置配置另存为预设名称" aria-label="新预设名称" />
        <button type="button" class="bbs-btn" :disabled="!plot.available || !!plot.data.settings.presetName || !newPresetName.trim()" @click="savePreset">保存内置配置</button>
      </div>
      <p v-if="presetMessage" class="hint" role="status">{{ presetMessage }}</p>
    </div>
    <fieldset :disabled="!plot.available || plot.busy" class="panel">
      <label class="switch"><input v-model="plot.data.settings.auto" type="checkbox" /> 正文生成前自动推演</label>
      <p class="hint">默认关闭；开启后为新用户消息推演，并把用户原文与建议合并为本轮用户层提示。已采用的推演绑定到对应用户消息：删除 AI 回复、重新生成或切换回复会复用原结果，只有删除对应用户消息才使这份推演失效。自动注入遵循柏宝书总开关和角色排除设置。</p>
      <label class="switch"><input v-model="plot.data.settings.realism" type="checkbox" /> 写实推演模式</label>
      <p class="hint">按当前世界规则检查人物动机、认知边界、因果、能力代价和关系变化。每个聊天独立保存，适用于手动、自动及导入预设；摘要方式保持现状。开关影响新推演，已保存的结果继续复用。</p>
      <div class="options">
        <div><span class="label">推演 API</span><BbsSelect v-model="plot.data.settings.channelId" :options="channels" aria-label="推演 API" /></div>
        <label>近期正文条数<input v-model.number="plot.data.settings.contextCount" type="number" min="1" max="30" /></label>
      </div>
      <details class="encounter-panel">
        <summary>邂逅候选（{{ plot.data.settings.encounterEntries.length }}）</summary>
        <p class="hint">从世界书中选择女性角色。每次推演会随机抽取一位，把她的设定交给模型参考；模型会结合当前剧情安排自然相遇，场景不合适时可以延后。</p>
        <div v-if="selectedEncounterEntries.length" class="encounter-selected" aria-label="已选择的邂逅候选">
          <span v-for="selected in selectedEncounterEntries" :key="`${selected.world}:${selected.uid}`" class="encounter-chip">
            {{ selected.world }} / {{ encounterLabel(selected.entry, selected.uid) }}
            <small v-if="encounterLoaded && !selected.entry" class="encounter-stale">（世界书中未找到此条目）</small>
            <button type="button" :aria-label="`移除 ${encounterLabel(selected.entry, selected.uid)}`" @click="setEncounter(selected.world, selected.uid, false)">×</button>
          </span>
        </div>
        <div class="actions">
          <button type="button" class="bbs-btn" :disabled="encounterLoading" @click="loadEncounterCatalog">{{ encounterLoading ? '正在读取…' : encounterLoaded ? '刷新世界书' : '读取世界书' }}</button>
          <button v-if="plot.data.settings.encounterEntries.length" type="button" class="bbs-btn" @click="plot.data.settings.encounterEntries = []">清空候选</button>
        </div>
        <p v-if="encounterError" class="notice" role="alert">{{ encounterError }}</p>
        <template v-if="encounterLoaded">
          <div class="encounter-filters">
            <input v-model="encounterSearch" type="search" placeholder="搜索角色名、关键词或设定…" aria-label="搜索邂逅候选" />
            <BbsSelect v-model="encounterWorld" :options="encounterWorldOptions" aria-label="按世界书筛选邂逅候选" />
          </div>
          <p v-if="!encounterCatalog.length" class="hint">没有读到有正文的世界书条目。请先在 SillyTavern 中加载世界书。</p>
          <p v-else-if="!filteredEncounterEntries.length" class="hint">没有匹配的世界书条目。</p>
          <div v-else class="encounter-list">
            <label v-for="entry in filteredEncounterEntries" :key="`${entry.world}:${entry.uid}`" class="encounter-entry">
              <input type="checkbox" :checked="isEncounterSelected(entry)" @change="toggleEncounter(entry, ($event.target as HTMLInputElement).checked)" />
              <span class="encounter-entry-copy">
                <strong>{{ encounterLabel(entry) }}</strong>
                <small>{{ entry.world }}<template v-if="entry.disabled"> · 世界书中已禁用</template></small>
                <span>{{ entry.content.slice(0, 180) }}{{ entry.content.length > 180 ? '…' : '' }}</span>
              </span>
            </label>
          </div>
        </template>
      </details>
      <label v-if="!plot.data.settings.presetName">长期推进偏好<textarea v-model="plot.data.settings.direction" rows="2" maxlength="8000" placeholder="例如：节奏放缓，优先发展人物关系，适时回应未解悬念。" /></label>
      <label v-if="!plot.data.settings.presetName">推演提示词
        <BbsSelect :model-value="plot.data.settings.promptMode" :options="promptOptions" aria-label="推演提示词" @update:model-value="selectPromptMode" />
      </label>
      <p v-if="!plot.data.settings.presetName" class="hint">{{ promptDescription }}切换仅影响之后的新推演。</p>
      <details v-if="!plot.data.settings.presetName && plot.data.settings.promptMode !== 'custom'">
        <summary>查看当前内置提示词</summary>
        <pre>{{ activePrompt }}</pre>
      </details>
      <details v-if="!plot.data.settings.presetName && plot.data.settings.promptMode === 'custom'" open>
        <summary>自定义推演提示词</summary>
        <p class="hint">近期剧情、记忆、状态和本轮意图会自动附在后面。留空时暂用内置一。</p>
        <textarea v-model="plot.data.settings.prompt" rows="7" maxlength="16000" placeholder="输入自己的剧情推进提示词" aria-label="自定义推演提示词" />
      </details>
      <p v-if="plot.data.settings.presetName" class="hint">当前由预设中的提示词驱动推演。切回「柏宝书内置 / 自定义提示词」可选择三套内置提示词或继续编辑原有提示词。</p>
    </fieldset>
    <WorldbookPanel />
    <div class="panel">
      <label>本轮意图<textarea v-model="plot.data.draft" :disabled="!plot.available || plot.busy" rows="3" maxlength="8000" placeholder="想怎么推进？留空则根据最近对话推演。自动模式使用实际发送的用户消息。" /></label>
      <div class="actions">
        <button type="button" class="bbs-btn bbs-btn-primary" :disabled="!plot.available || plot.busy" @click="generatePlot()"><Icon name="sparkles" />{{ plot.busy ? '正在推演…' : '生成推进建议' }}</button>
        <button v-if="plot.busy" type="button" class="bbs-btn" @click="cancelPlot">取消等待</button>
      </div>
      <p v-if="plot.busy" class="hint" role="status">正在结合近期正文与已有记忆推演。主 API 请求取消后，迟到结果会被忽略。</p>
      <p v-if="plot.error" role="alert" class="notice">{{ plot.error }}</p>
    </div>
    <div v-if="plot.result" class="panel">
      <div class="result-heading"><strong>推进建议</strong><div class="result-view-switch" role="group" aria-label="推进建议显示方式"><button type="button" :class="{ active: resultView === 'preview' }" :aria-pressed="resultView === 'preview'" @click="resultView = 'preview'">美化预览</button><button type="button" :class="{ active: resultView === 'edit' }" :aria-pressed="resultView === 'edit'" @click="resultView = 'edit'">编辑原文</button></div></div>
      <PlotPresentation v-if="resultView === 'preview'" :text="plot.result" initial-open />
      <label v-else>推演原文<textarea v-model="plot.result" :disabled="plot.busy" rows="12" maxlength="24000" @input="unqueuePlot" /></label>
      <div class="actions">
        <button type="button" class="bbs-btn bbs-btn-primary" :disabled="plot.busy || !plot.result.trim() || plot.queued" @click="queuePlot">下一次生成使用</button>
        <button type="button" class="bbs-btn" :disabled="plot.busy || !plot.result.trim()" @click="appendDraft">追加到聊天输入框</button>
        <button v-if="plot.queued" type="button" class="bbs-btn" @click="unqueuePlot">取消待用</button>
      </div>
      <p class="hint" role="status">{{ plot.queued ? '已待用：下一次正文生成优先使用这份建议，并绑定对应用户消息；重生成继续复用。' : '点击“下一次生成使用”可采用或替换本轮建议；采用后会随对应用户消息保存，删除或重生成 AI 回复仍可复用。也可追加到输入框后自行发送。' }}</p>
    </div>
    <details v-if="plot.data.history.length" class="panel">
      <summary>最近推演记录（{{ plot.data.history.length }}/10）</summary>
      <article v-for="(record, index) in plot.data.history" :key="`${record.createdAt}-${index}`">
        <div class="actions"><span class="hint">{{ new Date(record.createdAt).toLocaleString() }}</span><button type="button" class="bbs-btn" :disabled="plot.busy" @click="loadPlotRecord(record)">载入编辑</button></div>
        <p class="hint">{{ record.input || '自然推进' }}</p>
        <pre>{{ record.text }}</pre>
      </article>
    </details>
    <p class="hint">配置与最近 10 次结果随当前聊天保存。输入资料有长度上限；世界书、角色卡和历史不足时，按现有资料推演。</p>
  </section>
</template>

<style scoped>
.plot-page { display: grid; gap: 16px; }
header h2 { display: flex; align-items: center; gap: 8px; }
header p, .hint { color: var(--bbs-ink-muted); font-size: 12px; margin: 6px 0; }
.panel { min-width: 0; margin: 0; padding: 16px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-surface); }
.beat-panel { display: grid; gap: 10px; }
.beat-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.beat-heading strong { font-size: 15px; }
.beat-mode, .beat-kind { display: inline-flex; align-items: center; width: fit-content; padding: 3px 8px; border-radius: 999px; background: var(--bbs-surface-2); color: var(--bbs-accent); font-size: 11px; white-space: nowrap; }
.beat-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.beat-option { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 9px; padding: 9px 10px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.beat-option small { display: block; margin-top: 3px; color: var(--bbs-ink-muted); }
.beat-selected { padding: 11px 13px; border-left: 3px solid var(--bbs-accent); border-radius: var(--bbs-radius-sm); background: var(--bbs-surface-2); font-size: 13px; overflow-wrap: anywhere; }
.beat-selected p { margin: 5px 0; line-height: 1.6; }
.beat-selected details { margin-top: 7px; }
.result-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; font-size: 13px; }
.result-view-switch { display: flex; gap: 3px; padding: 3px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); }
.result-view-switch button { padding: 5px 8px; border: 0; border-radius: var(--bbs-radius-sm); background: transparent; color: var(--bbs-ink-muted); font: inherit; font-size: 11px; cursor: pointer; }
.result-view-switch button.active { background: var(--bbs-surface); color: var(--bbs-ink); font-weight: 600; }
fieldset.panel, .panel > label { display: grid; gap: 10px; }
label, .label { display: grid; gap: 6px; font-size: 13px; }
.switch { display: flex; align-items: center; gap: 8px; }
textarea, input[type='number'] { width: 100%; min-width: 0; padding: 9px 11px; border: 1px solid var(--bbs-line-strong); border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); color: var(--bbs-ink); font: inherit; }
textarea { resize: vertical; line-height: 1.65; }
textarea:focus, input:focus { outline: 1px solid var(--bbs-accent); }
input[type='checkbox'] { accent-color: var(--bbs-accent); }
.options { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 14px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.file-input { display: none; }
input[type='text'] { min-width: 180px; flex: 1; padding: 8px 11px; border: 1px solid var(--bbs-line-strong); border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); color: var(--bbs-ink); }
.notice { border-left: 3px solid var(--bbs-accent); padding: 8px 12px; background: var(--bbs-surface-2); overflow-wrap: anywhere; }
.preset-compatibility { padding: 9px 11px; border-radius: var(--bbs-radius-sm); background: var(--bbs-surface-2); font-size: 12px; }
.preset-compatibility p { margin: 4px 0 0; color: var(--bbs-ink-muted); }
summary { cursor: pointer; font-size: 13px; }
.encounter-panel { display: grid; gap: 8px; padding-top: 8px; border-top: 1px solid var(--bbs-line); }
.encounter-selected { display: flex; flex-wrap: wrap; gap: 6px; }
.encounter-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 8px; border-radius: 999px; background: var(--bbs-surface-2); font-size: 12px; overflow-wrap: anywhere; }
.encounter-chip button { border: 0; padding: 0; background: transparent; color: var(--bbs-ink-muted); font: inherit; cursor: pointer; }
.encounter-stale { color: var(--bbs-ink-muted); }
.encounter-filters { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 8px; }
.encounter-filters input { min-width: 0; padding: 8px 10px; border: 1px solid var(--bbs-line-strong); border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); color: var(--bbs-ink); font: inherit; }
.encounter-list { display: grid; gap: 6px; max-height: 320px; overflow-y: auto; padding: 4px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); }
.encounter-entry { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 9px; padding: 8px; border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); cursor: pointer; }
.encounter-entry-copy { display: grid; gap: 3px; min-width: 0; }
.encounter-entry-copy strong { font-size: 13px; }
.encounter-entry-copy small { color: var(--bbs-ink-muted); font-size: 11px; }
.encounter-entry-copy > span { color: var(--bbs-ink-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
article { margin-top: 14px; border-top: 1px solid var(--bbs-line); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 13px; }
@media (max-width: 480px) { .options, .encounter-filters { grid-template-columns: minmax(0, 1fr); } .panel { padding: 12px; } }
</style>
