<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BbsSelect from '@/components/BbsSelect.vue';
import Icon from '@/components/Icon.vue';
import { memory, derivedMeta } from '@/memory/store';
import { leafValid } from '@/memory/apply';
import type { KnowledgeFact } from '@/memory/types';
import { getContext } from '@/st/context';

const selectedActor = ref('');
const sections = [
  { status: 'known', label: '确知', description: '亲历或得到可靠确认' },
  { status: 'heard', label: '听说', description: '听到了消息，但尚未亲自确认' },
  { status: 'suspected', label: '怀疑', description: '有线索或猜测，不能当成事实' },
  { status: 'unknown', label: '未接触', description: '私密事件未接触，且尚无传播记录；旧聊天也可能有明确不知记录' },
] as const;

const available = computed(() => {
  // 聊天切换会更新 rev；ST 上下文本身不是 Vue 响应式对象。
  void derivedMeta.rev;
  return !!getContext()?.getCurrentChatId?.();
});
const actors = computed(() => {
  if (!available.value) return [];
  const ctx = getContext();
  const names = new Set<string>();
  for (const name of [ctx?.name1, ctx?.name2, ...memory.npcs.map(n => n.name), ...memory.knowledge.map(k => k.actor)]) {
    if (name?.trim()) names.add(name.trim());
  }
  return [...names];
});
const options = computed(() => [
  { value: '', label: '全部角色' },
  ...actors.value.map(name => ({ value: name, label: name })),
]);
watch(actors, list => {
  if (selectedActor.value && !list.includes(selectedActor.value)) selectedActor.value = '';
});
const visibleActors = computed(() => selectedActor.value ? actors.value.filter(name => name === selectedActor.value) : actors.value);
const count = (status: KnowledgeFact['status']): number => memory.knowledge.filter(f => f.status === status).length;
const factsFor = (actor: string, status: KnowledgeFact['status']): KnowledgeFact[] =>
  memory.knowledge.filter(f => f.actor === actor && f.status === status);
const actorCount = (actor: string): number => memory.knowledge.filter(f => f.actor === actor).length;
const keyFactCount = computed(() => new Set(memory.knowledge.map(f => f.factId || f.fact)).size);
function factOrigin(fact: KnowledgeFact): string {
  if (!fact.origin) return '';
  const floor = getContext()?.chat?.findIndex(m => leafValid(m) && m.extra?.bbs_leaf?.id === fact.origin?.leafId) ?? -1;
  const label = floor >= 0 ? `来源楼 #${floor}`
    : fact.origin.floor !== undefined ? `原始来源楼 #${fact.origin.floor}` : '来源楼已不在当前聊天';
  return `${label}${fact.origin.time ? ` · 故事时间：${fact.origin.time}` : ''}`;
}
</script>

<template>
  <details class="knowledge-panel">
    <summary class="knowledge-summary"><Icon name="knowledge" /> 角色认知账本（{{ memory.knowledgeEvents.length }} 条正文事件 · {{ keyFactCount }} 件事实）</summary>
    <div class="knowledge-body">
    <p class="intro">正文事件和实际传播路径是记录来源，下方按角色显示推导出的认知。推演草案不会入账。</p>
    <p v-if="!available" class="notice">请先打开一个聊天。</p>
    <template v-else>
      <div class="notice">
        <strong>记录边界</strong>
        <p>每条新事件只记录正文证据、实际知情者和传播方式；私密事件外的角色由此推导为未接触，无须逐人填表。知道会面不等于知道谈话内容。没有记录表示尚无可靠证据；摘要、世界书和推演不会自动让角色知情。旧聊天的逐人记录仍会显示。</p>
      </div>

      <div class="overview" aria-label="认知状态统计">
        <div v-for="section in sections" :key="section.status" class="metric" :class="`is-${section.status}`">
          <span>{{ section.label }}</span><strong>{{ count(section.status) }}</strong>
        </div>
      </div>

      <div class="filter">
        <span>查看人物</span>
        <BbsSelect v-model="selectedActor" :options="options" aria-label="选择角色认知" />
      </div>

      <p v-if="!actors.length" class="empty">暂无角色。生成正文并完成摘要后，认知变化会出现在这里。</p>
      <div v-else class="actors">
        <article v-for="actor in visibleActors" :key="actor" class="actor-card">
          <div class="actor-heading">
            <strong>{{ actor }}</strong>
            <span>{{ actorCount(actor) }} 条认知记录</span>
          </div>
          <p v-if="!actorCount(actor)" class="actor-empty">尚无可靠认知记录，不能据此断言此人已经知道或明确不知道某件事。</p>
          <div v-else class="status-grid">
            <section v-for="section in sections" :key="section.status" class="status-card" :class="`is-${section.status}`">
              <h3>{{ section.label }} <small>{{ factsFor(actor, section.status).length }}</small></h3>
              <p class="status-description">{{ section.description }}</p>
              <ul v-if="factsFor(actor, section.status).length">
                <li v-for="(fact, index) in factsFor(actor, section.status)" :key="`${fact.fact}-${index}`">
                  <span>{{ fact.fact }}</span>
                  <small v-if="fact.factId">事实编号：{{ fact.factId }}</small>
                  <small>来源：{{ fact.source }}</small>
                  <small v-if="fact.origin">{{ factOrigin(fact) }} · 原句：{{ fact.origin.evidence }}</small>
                </li>
              </ul>
              <p v-else class="no-record">暂无记录</p>
            </section>
          </div>
        </article>
      </div>
    </template>
    </div>
  </details>
</template>

<style scoped>
.knowledge-panel { min-width: 0; margin: 0; padding: 16px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-surface); }
.knowledge-summary { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; font-weight: 600; }
.knowledge-body { display: grid; gap: 16px; margin-top: 14px; }
.intro, .notice p, .status-description, .no-record, .actor-empty { color: var(--bbs-ink-muted); font-size: 12px; line-height: 1.6; }
.intro { margin: 0; }
.notice { padding: 12px 14px; border-left: 3px solid var(--bbs-accent); background: var(--bbs-surface-2); border-radius: var(--bbs-radius-sm); }
.notice p { margin: 5px 0 0; }
.overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.metric { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; padding: 10px 12px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-surface); font-size: 12px; }
.metric strong { font-size: 18px; color: var(--bbs-ink); }
.filter { display: grid; gap: 6px; max-width: 360px; font-size: 13px; }
.actors { display: grid; gap: 12px; }
.actor-card { min-width: 0; padding: 15px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-surface); }
.actor-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.actor-heading strong { font-size: 16px; color: var(--bbs-ink); }
.actor-heading span { color: var(--bbs-ink-muted); font-size: 12px; }
.actor-empty { margin-bottom: 0; }
.status-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.status-card { min-width: 0; padding: 12px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); }
.status-card h3 { margin: 0; font-size: 13px; }
.status-card h3 small { margin-left: 4px; color: var(--bbs-ink-muted); font-weight: 400; }
.status-description { margin: 3px 0 9px; }
.status-card ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.status-card li { padding-top: 8px; border-top: 1px solid var(--bbs-line); overflow-wrap: anywhere; font-size: 13px; }
.status-card li span, .status-card li small { display: block; }
.status-card li small { margin-top: 4px; color: var(--bbs-ink-muted); font-size: 11px; }
.no-record { margin: 0; }
.empty { color: var(--bbs-ink-muted); font-size: 13px; }
@media (max-width: 520px) { .status-grid { grid-template-columns: 1fr; } .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } .knowledge-panel { padding: 12px; } }
</style>
