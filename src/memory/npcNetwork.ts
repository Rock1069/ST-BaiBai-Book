import type { MemNpc } from './types';

export interface NpcNetworkEdge {
  id: string;
  from: MemNpc;
  to: MemNpc;
  /** NPC ties 中记录的关系原句，供图上显示与删除。 */
  label: string;
  rawTie: string;
}

export interface NpcNetwork {
  nodes: MemNpc[];
  edges: NpcNetworkEdge[];
}

function cleanLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relationLabel(tie: string, targetName: string): string {
  const canonical = tie.match(new RegExp(`^与\\s*${escapeRegExp(targetName)}\\s*[：:]\\s*(.+)$`, 'i'));
  return cleanLine(canonical?.[1] ?? tie);
}

/**
 * 从既有 NPC.ties 文本生成关系图。兼容「阿黛尔之父;与镇长有旧怨」等旧写法，
 * 同时识别「与阿黛尔：父亲」这类可稳定编辑的结构化片段。
 */
export function buildNpcNetwork(npcs: MemNpc[]): NpcNetwork {
  const ordered = [...npcs].filter(npc => npc.name.trim()).sort((a, b) => b.name.length - a.name.length);
  const nodes = new Map<string, MemNpc>();
  const edges: NpcNetworkEdge[] = [];
  const seen = new Set<string>();

  for (const source of ordered) {
    const ties = (source.ties ?? '').split(/[；;\n]+/).map(cleanLine).filter(Boolean);
    for (const rawTie of ties) {
      const folded = normalized(rawTie);
      const matched = ordered
        .filter(target => target.id !== source.id && folded.includes(normalized(target.name)))
        .filter(target => {
          const match = rawTie.toLocaleLowerCase().indexOf(target.name.toLocaleLowerCase());
          return match >= 0;
        });
      if (!matched.length) continue;

      // 名字可能互为子串(如「林」与「林月」)，只把较长的匹配当作目标，避免错连。
      const selected: MemNpc[] = [];
      const occupied: Array<[number, number]> = [];
      for (const target of matched) {
        const start = rawTie.toLocaleLowerCase().indexOf(target.name.toLocaleLowerCase());
        const end = start + target.name.length;
        if (occupied.some(([a, b]) => start < b && end > a)) continue;
        occupied.push([start, end]);
        selected.push(target);
      }

      for (const target of selected) {
        const label = relationLabel(rawTie, target.name);
        const pair = [source.id, target.id].sort().join('|');
        const key = `${pair}|${normalized(label)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.set(source.id, source);
        nodes.set(target.id, target);
        edges.push({ id: key, from: source, to: target, label, rawTie });
      }
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)),
    edges,
  };
}

/** 覆盖 NPC 到某个目标人物的旧关系片段，并追加统一格式的新关系。 */
export function setNpcRelationshipTie(ties: string | undefined, targetName: string, relation: string, knownNames: string[] = [targetName]): string {
  const segments = (ties ?? '').split(/[；;\n]+/).map(cleanLine).filter(Boolean);
  const kept = segments.filter(segment => !referencesNpcName(segment, targetName, knownNames));
  const label = cleanLine(relation);
  if (label) kept.push(`与${targetName.trim()}：${label}`);
  return kept.join('; ');
}

/** 删除来源 NPC 的一条原始关系片段。 */
export function removeNpcRelationshipTie(ties: string | undefined, rawTie: string): string {
  const target = normalized(rawTie);
  return (ties ?? '').split(/[；;\n]+/).map(cleanLine).filter(Boolean)
    .filter(segment => normalized(segment) !== target)
    .join('; ');
}

/** 删除某个 NPC ties 中所有指向指定角色的关系片段。 */
export function removeNpcRelationshipsTo(ties: string | undefined, targetName: string, knownNames: string[] = [targetName]): string {
  return (ties ?? '').split(/[；;\n]+/).map(cleanLine).filter(Boolean)
    .filter(segment => !referencesNpcName(segment, targetName, knownNames))
    .join('; ');
}

function referencesNpcName(tie: string, targetName: string, knownNames: string[]): boolean {
  const foldedTie = normalized(tie);
  const target = normalized(targetName);
  if (!foldedTie.includes(target)) return false;
  // 避免短名字(如“林”)误匹配仅包含它的另一个 NPC(如“林月”)。
  return !knownNames.some(name => {
    const folded = normalized(name);
    return folded !== target && folded.length > target.length && folded.includes(target) && foldedTie.includes(folded);
  });
}

/** 取得指定方向的关系文本，不借用反向关系，也不把短名误当成长名。 */
export function npcRelationshipText(npc: Pick<MemNpc, 'ties'>, targetName: string, knownNames: string[]): string {
  const canonical = new RegExp(`^与\\s*${escapeRegExp(targetName)}\\s*[：:]`, 'i');
  return (npc.ties ?? '').split(/[；;\n]+/).map(cleanLine).filter(Boolean)
    .filter(tie => canonical.test(tie) || referencesNpcName(tie, targetName, knownNames))
    .map(tie => relationLabel(tie, targetName)).sort().join('; ');
}

/** NPC 改名时同步维护其他角色 ties 中提到的名字。 */
export function renameNpcReference(ties: string | undefined, oldName: string, newName: string, knownNames: string[] = [oldName]): string {
  if (!ties || !oldName.trim() || !newName.trim()) return ties ?? '';
  const matcher = new RegExp(escapeRegExp(oldName.trim()), 'gi');
  let changed = false;
  const updated = ties.split(/[；;\n]+/).map(cleanLine).map(segment => {
    if (!referencesNpcName(segment, oldName, knownNames)) return segment;
    changed = true;
    return segment.replace(matcher, newName.trim());
  });
  return changed ? updated.filter(Boolean).join('; ') : ties;
}

