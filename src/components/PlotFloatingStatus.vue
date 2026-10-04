<script setup lang="ts">
import { cancelPlot, plot } from '@/plot/store';
</script>

<template>
  <Transition name="bbs-plot-float">
    <div v-if="plot.autoBusy" class="bbs-plot-floating-status" role="status" aria-live="polite">
      <span class="bbs-plot-floating-label">{{ plot.phase || '正在推演…' }}</span>
      <button type="button" title="终止本次推演" aria-label="终止本次推演" @click="cancelPlot">终止</button>
    </div>
  </Transition>
</template>

<style scoped>
.bbs-plot-floating-status {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  z-index: 10002;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: max-content;
  min-width: 200px;
  max-width: calc(100vw - 24px);
  min-height: 48px;
  padding: 7px 9px 7px 14px;
  border: 1px solid var(--bbs-accent);
  border-radius: 12px;
  background: var(--bbs-surface);
  box-shadow: var(--bbs-shadow);
  color: var(--bbs-ink);
  font-size: 12px;
  line-height: 1.35;
}

.bbs-plot-floating-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bbs-plot-floating-status button {
  flex: 0 0 auto;
  padding: 4px 12px;
  border: 1px solid var(--bbs-accent);
  border-radius: var(--bbs-radius-pill);
  background: transparent;
  color: var(--bbs-accent);
  font: inherit;
  line-height: 1.3;
  cursor: pointer;
}

.bbs-plot-floating-status button:hover {
  background: var(--bbs-accent-soft);
}

.bbs-plot-floating-status button:focus-visible {
  outline: 2px solid var(--bbs-accent);
  outline-offset: 2px;
}

.bbs-plot-float-enter-active,
.bbs-plot-float-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.bbs-plot-float-enter-from,
.bbs-plot-float-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
