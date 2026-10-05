import type { MemPlan } from '@/memory/types';
import type { ViewNode } from '@/memory/inject';

export interface PlotBeatOption {
  id: string;
  kind: 'plan' | 'suspense' | 'scene';
  content: string;
  targetTime?: string;
}

function terms(text: string): Set<string> {
  const value = text.toLocaleLowerCase();
  const words = value.match(/[\p{Script=Han}]{2,}|[\p{L}\p{N}]{3,}/gu) ?? [];
  const result = new Set<string>();
  for (const word of words) {
    if (/^[\p{Script=Han}]+$/u.test(word) && word.length > 2) {
      for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
    } else result.add(word);
  }
  return result;
}

function overlap(candidate: string, query: Set<string>): number {
  if (!query.size) return 0;
  let score = 0;
  for (const term of terms(candidate)) if (query.has(term)) score++;
  return score;
}

/** 最近总结恒保留，较旧总结按本轮主题召回；最后仍按故事顺序交给模型。 */
export function selectPlotHistory(nodes: readonly ViewNode[], input: string, plans: readonly MemPlan[]): ViewNode[] {
  const query = terms([input, ...plans.filter(p => p.status === 'open').slice(-6).map(p => p.content)].join(' '));
  const scored = nodes.map((node, index) => ({ node, index,
    score: overlap(node.text, query) + (index >= nodes.length - 3 ? 100 : 0) }));
  const indices = new Set(scored.sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 9).map(x => x.index));
  const picked = nodes.filter((_, index) => indices.has(index));
  let budget = 12000;
  return picked.reverse().filter(node => {
    const cost = Math.min(node.text.length, 2200);
    if (cost > budget) return false;
    budget -= cost;
    return true;
  }).reverse().map(node => ({ ...node, text: node.text.length > 2200
    ? `${node.text.slice(0, 1050)}\n…\n${node.text.slice(-1050)}` : node.text }));
}

/** 用已落叶的开放计划/悬念构造候选；模型选下一步，用户无需逐项点选。 */
export function listPlotBeatOptions(plans: readonly MemPlan[], input: string, recent: string): PlotBeatOption[] {
  const open = plans.filter(p => p.status === 'open');
  const query = terms(`${input} ${recent.slice(-2400)}`);
  const ranked = open.map((plan, index) => ({ plan, index,
    score: overlap(plan.content, query) * 4 + index / Math.max(open.length, 1) }));
  ranked.sort((a, b) => b.score - a.score);
  return [
    ...ranked.slice(0, 6).map(({ plan }) => ({ id: plan.id, kind: plan.kind,
      content: plan.content.slice(0, 280), targetTime: plan.targetTime })),
    { id: 'scene', kind: 'scene', content: '依据用户本轮行动、在场人物和最近正文推进一个可观察的变化。' },
  ];
}

export function plotBeatCandidates(plans: readonly MemPlan[], input: string, recent: string): string {
  return listPlotBeatOptions(plans, input, recent).map((option, index) =>
    `${index + 1}. ${option.kind === 'scene' ? '当前场景自然延续' : option.kind === 'suspense' ? '待揭悬念' : '未完成计划'}：${option.content}${option.targetTime ? `（目标时间：${option.targetTime}）` : ''}`)
    .join('\n');
}
