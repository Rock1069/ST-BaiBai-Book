<script setup lang="ts">
import { computed } from 'vue';
import PlotPresentation from '@/components/PlotPresentation.vue';
import { normalizePlotTurnPlan } from '@/plot/model';
import { getContext } from '@/st/context';
import { ui } from '@/state/ui';

const props = defineProps<{ floor: number; sig: { tick: number } }>();
const plan = computed(() => {
  void props.sig.tick;
  const message = getContext()?.chat?.[props.floor];
  return message?.is_user ? normalizePlotTurnPlan(message.extra?.bbs_plot_plan) : null;
});
</script>

<template>
  <div v-if="plan" class="bbs-root bbs-plot-message" :data-theme="ui.theme">
    <PlotPresentation :text="plan.text" :floor="floor" :source="plan.source" />
  </div>
</template>

<style scoped>
.bbs-plot-message { width: 100%; min-width: 0; margin: 12px 0 2px; }
</style>
