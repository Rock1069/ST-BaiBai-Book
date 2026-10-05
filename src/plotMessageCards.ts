/** 将已保存的推演显示在对应用户消息下方；开关仅控制显示，不改消息正文与推演记录。 */
import { createApp, reactive, watch, type App } from 'vue';
import PlotMessageCard from '@/components/PlotMessageCard.vue';
import { getContext } from '@/st/context';
import { normalizePlotTurnPlan } from '@/plot/model';
import { ui } from '@/state/ui';
import { versionedAssetUrl } from '@/version';

const HOST_CLASS = 'bbs-pmc-host';
const signal = reactive({ tick: 0 });
const mounted = new Map<number, { host: HTMLElement; app: App }>();
let observer: MutationObserver | null = null;
let observerTimer: ReturnType<typeof setTimeout> | null = null;
let sharedSheet: CSSStyleSheet | null = null;
let bound = false;

function cssHref(): string { return versionedAssetUrl('./index.css', import.meta.url); }

async function prepareStyles(): Promise<void> {
  if (sharedSheet || typeof CSSStyleSheet === 'undefined') return;
  try {
    const response = await fetch(cssHref());
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(await response.text());
    sharedSheet = sheet;
    for (const { host } of mounted.values()) {
      const root = host.shadowRoot;
      if (root && !root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
  } catch { /* 使用每楼的样式链接兜底 */ }
}

function attachStyles(root: ShadowRoot): void {
  if (sharedSheet) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sharedSheet];
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssHref();
  root.appendChild(link);
}

function removeFloor(index: number): void {
  const item = mounted.get(index);
  if (!item) return;
  item.app.unmount();
  item.host.remove();
  mounted.delete(index);
}

function clearAll(): void {
  for (const index of [...mounted.keys()]) removeFloor(index);
  document.querySelectorAll(`.${HOST_CLASS}`).forEach(host => host.remove());
}

function injectFloor(index: number, element: HTMLElement): void {
  const text = element.querySelector('.mes_text');
  if (!text) return;
  element.querySelectorAll(`.${HOST_CLASS}`).forEach(host => host.remove());
  const host = document.createElement('div');
  host.className = HOST_CLASS;
  host.style.display = 'block';
  host.style.width = '100%';
  const root = host.attachShadow({ mode: 'open' });
  attachStyles(root);
  const container = document.createElement('div');
  root.appendChild(container);
  const app = createApp(PlotMessageCard, { floor: index, sig: signal });
  app.mount(container);
  text.insertAdjacentElement('afterend', host);
  mounted.set(index, { host, app });
}

/** ST 重渲后 host 可能消失；逐楼校正可保留未受影响卡片的展开状态。 */
function scan(refresh = false): void {
  if (!ui.showPlotInChat) { clearAll(); return; }
  const chat = getContext()?.chat ?? [];
  const visible = new Set<number>();
  let changed = false;
  document.querySelectorAll('.mes[mesid]').forEach(node => {
    const element = node as HTMLElement;
    const index = Number(element.getAttribute('mesid'));
    if (!Number.isInteger(index) || index < 0) return;
    const message = chat[index];
    if (!message?.is_user || !normalizePlotTurnPlan(message.extra?.bbs_plot_plan)) return;
    visible.add(index);
    const item = mounted.get(index);
    if (item?.host.isConnected && item.host.closest('.mes') === element) return;
    if (item) removeFloor(index);
    injectFloor(index, element);
    changed = true;
  });
  for (const index of [...mounted.keys()]) if (!visible.has(index)) { removeFloor(index); changed = true; }
  if (refresh || changed) signal.tick++;
}

function delayedScan(): void { setTimeout(() => scan(true), 60); }

function startObserver(): void {
  if (observer) return;
  const chat = document.getElementById('chat');
  if (!chat) return;
  observer = new MutationObserver(records => {
    // 流式 AI 正文会频繁重排 .mes_text；用户卡片只需跟踪用户楼和聊天结构变化。
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const floor = target?.closest('.mes[mesid]');
      if (!floor) return true;
      const index = Number(floor.getAttribute('mesid'));
      return !!getContext()?.chat?.[index]?.is_user;
    });
    if (!relevant) return;
    if (observerTimer) return;
    observerTimer = setTimeout(() => { observerTimer = null; scan(); }, 160);
  });
  observer.observe(chat, { childList: true, subtree: true });
}

function stopObserver(): void {
  observer?.disconnect();
  observer = null;
  if (observerTimer) { clearTimeout(observerTimer); observerTimer = null; }
}

/** 推演写入用户消息 extra 后立即刷新；不依赖后续 AI 楼渲染事件。 */
export function refreshPlotMessageCards(): void {
  if (!ui.showPlotInChat) return;
  startObserver();
  scan(true);
  delayedScan();
}

export function bindPlotMessageCards(): void {
  if (bound) return;
  bound = true;
  const ctx = getContext();
  const on = (name: string | undefined, fn: (...args: unknown[]) => void) => { if (name) ctx?.eventSource?.on(name, fn); };
  on(ctx?.eventTypes.USER_MESSAGE_RENDERED, delayedScan);
  on(ctx?.eventTypes.MESSAGE_EDITED, delayedScan);
  on(ctx?.eventTypes.MESSAGE_UPDATED, delayedScan);
  on(ctx?.eventTypes.MESSAGE_SWIPED, delayedScan);
  on(ctx?.eventTypes.MORE_MESSAGES_LOADED, delayedScan);
  on(ctx?.eventTypes.MESSAGE_DELETED, () => { clearAll(); delayedScan(); });
  on(ctx?.eventTypes.CHAT_CHANGED, () => { clearAll(); delayedScan(); });
  watch(() => ui.showPlotInChat, enabled => {
    if (enabled) { void prepareStyles(); startObserver(); scan(); delayedScan(); }
    else { stopObserver(); clearAll(); }
  }, { immediate: true });
}
