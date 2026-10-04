<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import { normalizePlotTurnPlan } from '@/plot/model';
import { getContext } from '@/st/context';
import { ui } from '@/state/ui';

const props = defineProps<{ floor: number; sig: { tick: number } }>();
const plan = computed(() => {
  void props.sig.tick;
  const message = getContext()?.chat?.[props.floor];
  return message?.is_user ? normalizePlotTurnPlan(message.extra?.bbs_plot_plan) : null;
});
const sections = computed(() => {
  const lines = (plan.value?.text || '').replace(/\r\n?/g, '\n').split('\n');
  const result: Array<{ title: string; body: string }> = [];
  let title = '推演内容';
  let body: string[] = [];
  const flush = () => {
    const content = body.join('\n').trim();
    if (content) result.push({ title, body: content });
    body = [];
  };
  for (const line of lines) {
    const heading = line.trim().match(/^(?:#{1,4}\s+(.+)|【([^】]{1,50})】\s*(.*)|\*\*([^*]{1,50})\*\*)$/);
    if (heading) {
      flush();
      title = (heading[1] || heading[2] || heading[4]).trim();
      if (heading[3]) body.push(heading[3]);
    } else body.push(line);
  }
  flush();
  return result.length ? result : [{ title: '推演内容', body: plan.value?.text || '' }];
});
const preview = computed(() => sections.value[0]?.body.replace(/\s+/g, ' ').slice(0, 72) || '点击查看完整推演');
</script>

<template>
  <div v-if="plan" class="bbs-root bbs-plot-message" :data-theme="ui.theme">
    <details class="bbs-pmc-card">
      <summary class="bbs-pmc-head">
        <span class="bbs-pmc-mark"><Icon name="sparkles" /></span>
        <span class="bbs-pmc-heading">
          <span class="bbs-pmc-top"><strong>剧情推演</strong><small>#{{ floor }} · {{ plan.source === 'auto' ? '自动' : '手动' }}</small></span>
          <span class="bbs-pmc-preview">{{ preview }}</span>
        </span>
        <span class="bbs-pmc-chevron"><Icon name="chevron" /></span>
      </summary>
      <div class="bbs-pmc-content">
        <p class="bbs-pmc-note">以下是生成正文前的推进建议，尚未成为已发生剧情。</p>
        <section v-for="(section, index) in sections" :key="index" class="bbs-pmc-section">
          <h4><span>✦</span>{{ section.title }}</h4>
          <p>{{ section.body }}</p>
        </section>
      </div>
    </details>
  </div>
</template>

<style scoped>
.bbs-plot-message { width: 100%; min-width: 0; margin: 12px 0 2px; }
.bbs-pmc-card { width: 100%; overflow: hidden; border: 1px solid var(--bbs-line); border-radius: 16px; background: var(--bbs-surface); box-shadow: 0 5px 18px -12px var(--bbs-ink-muted); }
.bbs-pmc-head { display: flex; align-items: center; gap: 11px; min-height: 66px; padding: 12px 14px; cursor: pointer; list-style: none; background: linear-gradient(115deg, var(--bbs-accent-soft), transparent 75%); }
.bbs-pmc-head::-webkit-details-marker { display: none; }
.bbs-pmc-head:focus-visible { outline: 2px solid var(--bbs-accent); outline-offset: -3px; }
.bbs-pmc-mark { flex: 0 0 auto; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: var(--bbs-accent); background: var(--bbs-surface); }
.bbs-pmc-mark :deep(svg) { width: 18px !important; height: 18px !important; }
.bbs-pmc-heading { display: grid; gap: 2px; min-width: 0; flex: 1; }
.bbs-pmc-top { display: flex; align-items: baseline; gap: 9px; }
.bbs-pmc-top strong { font-size: 13px; color: var(--bbs-ink); }
.bbs-pmc-top small { color: var(--bbs-ink-muted); font-size: 10px; }
.bbs-pmc-preview { overflow: hidden; color: var(--bbs-ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.bbs-pmc-chevron { flex: 0 0 auto; color: var(--bbs-ink-muted); transition: transform var(--bbs-dur) var(--bbs-ease); }
.bbs-pmc-chevron :deep(svg) { width: 16px !important; height: 16px !important; }
.bbs-pmc-card[open] .bbs-pmc-chevron { transform: rotate(180deg); }
.bbs-pmc-content { display: grid; gap: 10px; max-height: min(65vh, 680px); overflow-y: auto; padding: 0 12px 14px; }
.bbs-pmc-note { margin: 0; padding: 9px 11px; border-radius: 10px; background: var(--bbs-accent-soft); color: var(--bbs-ink-soft); font-size: 11px; }
.bbs-pmc-section { min-width: 0; padding: 12px; border: 1px solid var(--bbs-line); border-radius: 12px; background: var(--bbs-bg); }
.bbs-pmc-section h4 { display: flex; gap: 7px; align-items: center; margin: 0 0 8px; color: var(--bbs-accent); font-size: 12px; font-weight: 700; }
.bbs-pmc-section h4 span { font-size: 15px; }
.bbs-pmc-section p { margin: 0; color: var(--bbs-ink); font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 520px) { .bbs-pmc-head { padding: 10px 11px; } .bbs-pmc-content { padding: 0 9px 11px; } }
</style>
