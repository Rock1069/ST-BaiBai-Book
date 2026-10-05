<script setup lang="ts">
import { computed, ref } from 'vue';
import { parsePlotDisplay } from '@/plot/display';

const props = withDefaults(defineProps<{
  text: string;
  floor?: number;
  source?: 'auto' | 'manual';
  initialOpen?: boolean;
}>(), { initialOpen: false });
const display = computed(() => parsePlotDisplay(props.text));
const palette = ref<'noir' | 'milk' | 'moss'>('noir');
const paletteName = computed(() => ({ noir: '黑粉', milk: '奶茶', moss: '灰绿' })[palette.value]);
function nextPalette(): void {
  palette.value = palette.value === 'noir' ? 'milk' : palette.value === 'milk' ? 'moss' : 'noir';
}
</script>

<template>
  <details class="echo-card" :data-palette="palette" :open="initialOpen">
    <summary class="echo-header">
      <span class="echo-orb" aria-hidden="true">✦</span>
      <span class="echo-heading">
        <span class="echo-overline">ECHO · 剧情推演</span>
        <span class="echo-title">{{ display.time || '回响' }}<small v-if="display.day">{{ display.day }}</small></span>
        <span class="echo-preview">{{ display.preview }}</span>
      </span>
      <span class="echo-meta">
        <span v-if="floor !== undefined">#{{ floor }}</span>
        <span v-if="source">{{ source === 'auto' ? '自动' : '手动' }}</span>
      </span>
      <span class="echo-chevron" aria-hidden="true">✧</span>
    </summary>

    <div class="echo-content">
      <p class="echo-caution">✧ 本卡是正文生成前的推演建议，尚未成为已发生剧情。</p>
      <div v-if="display.place || display.weather || display.present" class="echo-scene-line">
        <span v-if="display.place"><b>场景</b>{{ display.place }}</span>
        <span v-if="display.weather"><b>天气</b>{{ display.weather }}</span>
        <span v-if="display.present"><b>在场</b>{{ display.present }}</span>
      </div>
      <div v-if="display.recallIds.length" class="echo-recall-line">
        <strong>光阴折痕</strong>
        <span v-for="id in display.recallIds" :key="id" class="echo-recall-tag">{{ id }}</span>
      </div>
      <div class="echo-sections">
        <details v-for="(section, index) in display.sections" :key="`${section.title}-${index}`" class="echo-section" :class="`is-${section.kind}`" :open="initialOpen && index === 0">
          <summary><span class="echo-sigil" aria-hidden="true">✧</span><strong>{{ section.title }}</strong><span class="echo-section-arrow" aria-hidden="true">⌄</span></summary>
          <div class="echo-section-body">{{ section.body }}</div>
        </details>
      </div>
      <div class="echo-footer"><span>✦ 只供下一段创作参考</span><button type="button" :aria-label="`切换推演卡片配色，当前${paletteName}`" @click="nextPalette">配色 · {{ paletteName }}</button></div>
    </div>
  </details>
</template>

<style scoped>
.echo-card { --echo-accent: #ff89b3; --echo-accent-2: #d6b0bc; --echo-bg: #1f1f23; --echo-panel: #28272b; --echo-panel-2: #19191c; --echo-ink: #e3ddde; --echo-muted: #a9a0a5; --echo-border: rgba(255,137,179,.18); --echo-glow: rgba(255,137,179,.13); width: 100%; min-width: 0; overflow: hidden; border: 1px solid var(--echo-border); border-radius: 14px; background: var(--echo-bg); color: var(--echo-ink); box-shadow: 0 12px 30px -22px #000; font-family: 'Microsoft YaHei', system-ui, sans-serif; }
.echo-card[data-palette='milk'] { --echo-accent: #d46464; --echo-accent-2: #dd9a9a; --echo-bg: #fef4f3; --echo-panel: #fdecec; --echo-panel-2: #fff8f8; --echo-ink: #482b2d; --echo-muted: #8a5c5f; --echo-border: rgba(212,100,100,.22); --echo-glow: rgba(212,100,100,.12); }
.echo-card[data-palette='moss'] { --echo-accent: #6b705c; --echo-accent-2: #8b8378; --echo-bg: #f3f0eb; --echo-panel: #ebe7e0; --echo-panel-2: #f0ede6; --echo-ink: #3a3632; --echo-muted: #7e786c; --echo-border: rgba(107,112,92,.23); --echo-glow: rgba(107,112,92,.12); }
.echo-header { display: flex; align-items: center; gap: 10px; min-height: 72px; padding: 12px 14px; cursor: pointer; list-style: none; background: radial-gradient(circle at 2% 8%, var(--echo-glow), transparent 60%), var(--echo-bg); }
.echo-header::-webkit-details-marker, .echo-section > summary::-webkit-details-marker { display: none; }
.echo-header:focus-visible, .echo-section > summary:focus-visible, .echo-footer button:focus-visible { outline: 2px solid var(--echo-accent); outline-offset: -3px; }
.echo-orb { flex: 0 0 auto; display: grid; place-items: center; width: 37px; height: 37px; border: 1px solid var(--echo-border); border-radius: 50%; background: radial-gradient(circle at 35% 25%, var(--echo-accent-2), var(--echo-accent) 52%, var(--echo-bg) 100%); color: #fff; font-size: 17px; box-shadow: 0 0 15px var(--echo-glow); }
.echo-heading { display: grid; gap: 2px; flex: 1; min-width: 0; }
.echo-overline { color: var(--echo-accent); font-size: 9px; font-weight: 700; letter-spacing: .14em; }
.echo-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; color: var(--echo-accent); font-size: 18px; font-weight: 700; letter-spacing: .06em; }
.echo-title small { padding: 2px 7px; border-radius: 999px; background: var(--echo-glow); color: var(--echo-accent-2); font-size: 10px; font-weight: 500; letter-spacing: 0; }
.echo-preview { overflow: hidden; color: var(--echo-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.echo-meta { display: flex; flex-wrap: wrap; justify-content: end; gap: 4px; max-width: 72px; }
.echo-meta span { padding: 3px 6px; border-radius: 999px; background: var(--echo-glow); color: var(--echo-accent); font-size: 10px; white-space: nowrap; }
.echo-chevron { flex: 0 0 auto; color: var(--echo-accent); font-size: 19px; transition: transform .25s ease; }
.echo-card[open] .echo-chevron { transform: rotate(90deg); }
.echo-content { display: grid; gap: 10px; max-height: min(68vh, 720px); overflow-y: auto; padding: 3px 12px 12px; scrollbar-color: var(--echo-accent) transparent; scrollbar-width: thin; }
.echo-caution { margin: 0; padding: 9px 10px; border-radius: 9px; background: var(--echo-glow); color: var(--echo-muted); font-size: 11px; line-height: 1.5; }
.echo-scene-line { display: flex; flex-wrap: wrap; gap: 6px; }
.echo-scene-line span { display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; padding: 5px 7px; border: 1px solid var(--echo-border); border-radius: 7px; background: var(--echo-panel); font-size: 11px; overflow-wrap: anywhere; }
.echo-scene-line b { color: var(--echo-accent); font-size: 10px; white-space: nowrap; }
.echo-recall-line { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding: 8px 9px; border-radius: 9px; background: var(--echo-panel); }
.echo-recall-line strong { margin-right: 4px; color: var(--echo-accent); font-size: 11px; }
.echo-recall-tag { padding: 3px 7px; border-radius: 999px; background: var(--echo-glow); color: var(--echo-accent); font-size: 10px; }
.echo-sections { display: grid; gap: 7px; }
.echo-section { min-width: 0; border: 1px solid var(--echo-border); border-radius: 10px; background: var(--echo-panel); }
.echo-section > summary { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 9px 10px; cursor: pointer; list-style: none; }
.echo-section strong { flex: 1; min-width: 0; color: var(--echo-ink); font-size: 12px; }
.echo-sigil { color: var(--echo-accent); font-size: 14px; }
.echo-section-arrow { color: var(--echo-accent); transition: transform .2s ease; }
.echo-section[open] .echo-section-arrow { transform: rotate(180deg); }
.echo-section-body { margin: 0 10px 10px; padding: 10px 11px; border-radius: 8px; background: var(--echo-panel-2); color: var(--echo-ink); font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.echo-section.is-focus { border-color: var(--echo-accent); }
.echo-section.is-focus > summary { background: var(--echo-glow); }
.echo-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; color: var(--echo-muted); font-size: 10px; }
.echo-footer button { padding: 4px 7px; border: 1px solid var(--echo-border); border-radius: 7px; background: var(--echo-panel); color: var(--echo-accent); font: inherit; cursor: pointer; }
@media (max-width: 520px) { .echo-header { gap: 8px; padding: 10px; } .echo-orb { width: 31px; height: 31px; } .echo-title { font-size: 16px; } .echo-content { padding: 3px 9px 10px; } }
</style>
