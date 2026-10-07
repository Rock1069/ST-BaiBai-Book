<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { plot } from '@/plot/store';
import { getCharacterWorldInfoNames, listWorldInfoEntries, type WorldInfoCatalogEntry } from '@/st/context';

const catalog = ref<WorldInfoCatalogEntry[]>([]);
const characterNames = ref<string[]>([]);
const loading = ref(false);
const loaded = ref(false);
const error = ref('');
const search = ref('');
const expanded = ref<string[]>([]);
let requestId = 0;
const allNames = computed(() => [...new Set(catalog.value.map(entry => entry.world))].sort((a, b) => a.localeCompare(b, 'zh')));
const activeNames = computed(() => plot.data.settings.worldbookSource === 'manual'
  ? plot.data.settings.selectedWorldbooks : characterNames.value);
const groups = computed(() => activeNames.value.map(name => ({
  name,
  entries: catalog.value.filter(entry => entry.world === name),
})).filter(group => !search.value.trim() || group.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()) ||
  group.entries.some(entry => matches(entry))));

function matches(entry: WorldInfoCatalogEntry): boolean {
  const query = search.value.trim().toLocaleLowerCase();
  return !query || [entry.world, entry.comment, entry.uid, entry.content, ...entry.keys]
    .some(value => value.toLocaleLowerCase().includes(query));
}
function visibleEntries(entries: WorldInfoCatalogEntry[]): WorldInfoCatalogEntry[] {
  return entries.filter(matches);
}
function isSelected(entry: WorldInfoCatalogEntry): boolean {
  const ids = plot.data.settings.worldbookEntries[entry.world];
  return !entry.disabled && (!ids || ids.includes(entry.uid));
}
function selectedCount(entries: WorldInfoCatalogEntry[]): number {
  return entries.filter(isSelected).length;
}
function setEntry(entry: WorldInfoCatalogEntry, checked: boolean): void {
  if (entry.disabled) return;
  const settings = plot.data.settings;
  const initial = settings.worldbookEntries[entry.world] ?? catalog.value
    .filter(item => item.world === entry.world && !item.disabled).map(item => item.uid);
  settings.worldbookEntries[entry.world] = checked
    ? [...new Set([...initial, entry.uid])] : initial.filter(uid => uid !== entry.uid);
}
function setAll(checked: boolean): void {
  for (const name of activeNames.value) {
    plot.data.settings.worldbookEntries[name] = checked
      ? catalog.value.filter(entry => entry.world === name && !entry.disabled).map(entry => entry.uid) : [];
  }
}
function setManualBook(name: string, checked: boolean): void {
  const selected = plot.data.settings.selectedWorldbooks;
  plot.data.settings.selectedWorldbooks = checked
    ? [...new Set([...selected, name])] : selected.filter(item => item !== name);
}
function toggleExpanded(name: string): void {
  expanded.value = expanded.value.includes(name)
    ? expanded.value.filter(item => item !== name) : [...expanded.value, name];
}
async function refresh(): Promise<void> {
  const id = ++requestId;
  if (!plot.available) { catalog.value = []; characterNames.value = []; loaded.value = false; loading.value = false; return; }
  loading.value = true;
  error.value = '';
  try {
    const [names, entries] = await Promise.all([getCharacterWorldInfoNames(), listWorldInfoEntries()]);
    if (id !== requestId) return;
    characterNames.value = names;
    catalog.value = entries;
    loaded.value = true;
  } catch (e) {
    if (id === requestId) error.value = e instanceof Error ? e.message : '读取世界书失败';
  } finally { if (id === requestId) loading.value = false; }
}
onMounted(() => { void refresh(); });
watch(() => plot.data, () => { loaded.value = false; void refresh(); });
</script>

<template>
  <fieldset class="panel worldbook-panel" :disabled="!plot.available || plot.busy">
    <div class="panel-heading">
      <strong>剧情推进世界书</strong>
      <button type="button" class="help" title="只影响新生成的剧情推进请求；不修改酒馆世界书、摘要或正文。" aria-label="剧情推进世界书说明">ⓘ</button>
    </div>
    <label class="enable-row"><input v-model="plot.data.settings.worldInfo" type="checkbox" /> 推演参考世界书</label>
    <p class="hint">按当前剧情激活相关条目；沿用设置页的世界书排除规则。此处的来源和条目选择只影响新推演。</p>
    <div class="source-label">来源</div>
    <div class="source-switch" role="group" aria-label="剧情推进世界书来源">
      <button type="button" :class="{ active: plot.data.settings.worldbookSource === 'character' }" :aria-pressed="plot.data.settings.worldbookSource === 'character'" @click="plot.data.settings.worldbookSource = 'character'">跟随角色卡</button>
      <button type="button" :class="{ active: plot.data.settings.worldbookSource === 'manual' }" :aria-pressed="plot.data.settings.worldbookSource === 'manual'" @click="plot.data.settings.worldbookSource = 'manual'">手动选择</button>
    </div>
    <p class="hint">当前已选：{{ activeNames.length ? `${plot.data.settings.worldbookSource === 'character' ? '角色卡所有世界书：' : ''}${activeNames.join('、')}` : plot.data.settings.worldbookSource === 'manual' ? '尚未选择世界书' : '当前角色卡未绑定世界书' }}</p>
    <div v-if="plot.data.settings.worldbookSource === 'manual'" class="manual-books" aria-label="手动选择世界书">
      <label v-for="name in allNames" :key="name"><input type="checkbox" :checked="activeNames.includes(name)" @change="setManualBook(name, ($event.target as HTMLInputElement).checked)" />{{ name }}</label>
      <p v-if="loaded && !allNames.length" class="hint">没有可用的世界书。</p>
    </div>
    <div class="tools">
      <button type="button" :disabled="!loaded || !activeNames.length" @click="setAll(true)">全选</button>
      <button type="button" :disabled="!loaded || !activeNames.length" @click="setAll(false)">全不选</button>
      <input v-model="search" type="search" placeholder="搜索条目…" aria-label="搜索剧情推进世界书条目" />
      <button type="button" :disabled="loading" title="刷新世界书列表" @click="refresh">{{ loading ? '读取中…' : '刷新' }}</button>
    </div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p>
    <p v-else-if="loaded && !activeNames.length" class="hint">{{ plot.data.settings.worldbookSource === 'manual' ? '请先勾选要参考的世界书。' : '未解析到角色卡世界书，可切到手动选择。' }}</p>
    <p v-else-if="loaded && !groups.length" class="hint">没有匹配的条目。</p>
    <div v-if="loaded" class="book-list">
      <div v-for="group in groups" :key="group.name" class="book-group">
        <button type="button" class="book-title" :aria-expanded="expanded.includes(group.name)" @click="toggleExpanded(group.name)">
          <span>{{ expanded.includes(group.name) ? '⌄' : '›' }}　{{ group.name }}</span>
          <small>{{ selectedCount(group.entries) }}/{{ group.entries.length }} 条</small>
        </button>
        <div v-if="expanded.includes(group.name)" class="entry-list">
          <p v-if="!group.entries.length" class="hint">这本世界书没有有正文的条目。</p>
          <label v-for="entry in visibleEntries(group.entries)" :key="entry.uid" class="entry-row" :class="{ disabled: entry.disabled }">
            <input type="checkbox" :checked="isSelected(entry)" :disabled="entry.disabled" @change="setEntry(entry, ($event.target as HTMLInputElement).checked)" />
            <span><strong>{{ entry.comment || entry.keys[0] || `条目 ${entry.uid}` }}</strong><small>{{ entry.disabled ? '世界书中已禁用' : entry.constant ? '常驻条目' : entry.keys.length ? `关键词：${entry.keys.join('、')}` : '无关键词，手动来源下不会激活' }}</small></span>
          </label>
        </div>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.panel { min-width: 0; margin: 0; padding: 16px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-surface); }
.worldbook-panel { display: grid; gap: 9px; }
.panel-heading, .book-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.panel-heading strong { font-size: 15px; }
.help { border: 0; background: transparent; color: var(--bbs-ink-muted); cursor: help; }
.enable-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.hint { color: var(--bbs-ink-muted); font-size: 12px; margin: 0; overflow-wrap: anywhere; }
.source-label { font-size: 12px; color: var(--bbs-ink-muted); }
.source-switch { display: grid; grid-template-columns: 1fr 1fr; padding: 3px; background: var(--bbs-surface-2); border-radius: 12px; }
.source-switch button { min-width: 0; border: 0; border-radius: 10px; padding: 8px; background: transparent; color: var(--bbs-ink-muted); font: inherit; cursor: pointer; }
.source-switch button.active { background: var(--bbs-accent); color: var(--bbs-bg); }
.manual-books { display: flex; flex-wrap: wrap; gap: 8px; max-height: 130px; overflow: auto; }
.manual-books label { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border: 1px solid var(--bbs-line); border-radius: 999px; font-size: 12px; }
.tools { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tools button { border: 0; border-radius: 10px; padding: 7px 10px; background: var(--bbs-surface-2); color: var(--bbs-ink); font: inherit; font-size: 12px; cursor: pointer; }
.tools button:disabled { opacity: .5; cursor: default; }
.tools input { flex: 1; min-width: 110px; padding: 7px 10px; border: 0; border-radius: 10px; background: var(--bbs-surface-2); color: var(--bbs-ink); font: inherit; font-size: 12px; }
.book-list { display: grid; gap: 6px; max-height: 340px; overflow-y: auto; }
.book-group { border-bottom: 1px solid var(--bbs-line); }
.book-title { width: 100%; border: 0; padding: 9px 5px; background: transparent; color: var(--bbs-ink); font: inherit; text-align: left; cursor: pointer; }
.book-title small { color: var(--bbs-ink-muted); white-space: nowrap; }
.entry-list { display: grid; gap: 3px; padding: 2px 7px 9px 18px; }
.entry-row { display: flex; align-items: start; gap: 8px; padding: 6px; border-radius: 8px; font-size: 12px; cursor: pointer; }
.entry-row:hover { background: var(--bbs-surface-2); }
.entry-row.disabled { opacity: .6; cursor: default; }
.entry-row span { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.entry-row small { color: var(--bbs-ink-muted); }
.notice { border-left: 3px solid var(--bbs-accent); padding: 8px 12px; background: var(--bbs-surface-2); font-size: 12px; }
input[type='checkbox'] { accent-color: var(--bbs-accent); }
@media (max-width: 480px) { .panel { padding: 12px; } }
</style>
