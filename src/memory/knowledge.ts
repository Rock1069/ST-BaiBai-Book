import type { KnowledgeDelta, KnowledgeEvent, KnowledgeFact } from './types';

const statuses = new Set<KnowledgeFact['status']>(['known', 'heard', 'suspected', 'unknown']);
const line = (value: unknown, max: number): string => typeof value === 'string'
  ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const key = (actor: string, fact: string): string => `${actor.trim().toLowerCase()}\u0000${fact.trim().toLowerCase()}`;
const factKey = (fact: string): string => fact.replace(/[\s，。、“”‘’！？!?,.:：；;]+/g, '').toLocaleLowerCase();
function hash(value: string): string {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return (n >>> 0).toString(36);
}
const legacyFactId = (fact: string): string => `kf:legacy:${hash(factKey(fact))}`;

/** 只接受本轮正文中能逐字定位的事件。旧式逐角色记录仍可读，但新摘要不再产生它。 */
export function groundedKnowledgeEvents(raw: unknown, content: string, roster: readonly string[], context: KnowledgeGroundingContext): KnowledgeEvent[] {
  if (!Array.isArray(raw) || !context.leafId) return [];
  const body = content.replace(/\s+/g, ' ');
  const participants = [...new Set((context.sceneParticipants ?? []).map(name => line(name, 80)).filter(Boolean))];
  const pairScene = participants.length === 2 && participants.every(name => body.includes(name))
    && /房内|屋内|室内|厅内|堂内|阁内|书房|签押房|寝室|卧室|包厢|密室/.test(body)
    && !/众人|人群|围观|满屋人|一众|旁听|偷听|隔墙有耳/.test(body);
  const knownActors = new Map(roster.map(name => [name.toLocaleLowerCase(), name]));
  const prior = new Map((context.prior ?? []).filter(f => f.factId).map(f => [f.factId!, f]));
  const byFact = new Map((context.prior ?? []).map(f => [factKey(f.fact), f]));
  const result: KnowledgeEvent[] = [];
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const fact = line(r.fact, 240), evidence = line(r.evidence, 240), source = line(r.source, 120);
    if (!fact || evidence.length < 4 || !source || (r.kind !== 'event' && r.kind !== 'transmission')) continue;
    const at = body.indexOf(evidence);
    if (at < 0) continue;
    const message = messageAt(body, at);
    const near = body.slice(Math.max(0, at - 200), at + evidence.length + 200);
    const audience = [...new Set((Array.isArray(r.audience) ? r.audience : [])
      .map(value => knownActors.get(line(value, 80).toLocaleLowerCase())).filter((value): value is string => !!value))]
      .filter(actor => isSpeakerAt(body, actor, at) || message.includes(actor) || near.includes(actor)
        || (pairScene && participants.some(name => name.toLocaleLowerCase() === actor.toLocaleLowerCase())));
    if (!audience.length) continue;
    const mode = r.mode === 'heard' || r.mode === 'suspected' ? r.mode : 'known';
    if (r.kind === 'transmission' && !transmissionEvidence.test(message)) continue;
    if (mode === 'known' && quotedQuestionAt(body, at) && !transmissionEvidence.test(message)) continue;
    const requested = prior.get(line(r.factId, 80));
    if (requested && factKey(requested.fact) !== factKey(fact)) continue;
    const old = requested ?? byFact.get(factKey(fact));
    if (old && r.kind === 'event') continue;
    if (r.kind === 'transmission' && !old) continue;
    let visibility: KnowledgeEvent['visibility'] = 'unclear';
    if (r.visibility === 'open') visibility = 'open';
    else if (r.kind === 'event' && pairScene && participants.every(name =>
      audience.some(actor => actor.toLocaleLowerCase() === name.toLocaleLowerCase()))) visibility = 'private';
    else if (r.visibility === 'private' && privateEvidence.test(message)) visibility = 'private';
    if (visibility === 'private' && pairScene && audience.some(actor =>
      !participants.some(name => name.toLocaleLowerCase() === actor.toLocaleLowerCase()))) continue;
    const factId = old?.factId ?? `kf:${hash(context.leafId)}:${result.length}`;
    result.push({ id: `${context.leafId}:ke:${result.length}`, factId, fact: old?.fact ?? fact,
      kind: r.kind, audience, visibility, mode, source, evidence, leafId: context.leafId,
      ...(Number.isInteger(context.floor) ? { floor: context.floor } : {}), ...(context.time ? { time: context.time } : {}) });
  }
  return result;
}

export function cleanKnowledgeEvents(raw: unknown): KnowledgeEvent[] {
  if (!Array.isArray(raw)) return [];
  const result: KnowledgeEvent[] = [];
  for (const item of raw.slice(0, 64)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = line(r.id, 120), factId = line(r.factId, 80), fact = line(r.fact, 240);
    const evidence = line(r.evidence, 240), leafId = line(r.leafId, 80), source = line(r.source, 120);
    const audience = [...new Set((Array.isArray(r.audience) ? r.audience : []).map(v => line(v, 80)).filter(Boolean))];
    if (!id || !factId || !fact || !evidence || !leafId || !source || !audience.length) continue;
    if (r.kind !== 'event' && r.kind !== 'transmission') continue;
    if (r.mode !== 'known' && r.mode !== 'heard' && r.mode !== 'suspected') continue;
    result.push({ id, factId, fact, evidence, leafId, source, audience, kind: r.kind, mode: r.mode,
      visibility: r.visibility === 'private' || r.visibility === 'open' ? r.visibility : 'unclear',
      ...(Number.isInteger(r.floor) ? { floor: Number(r.floor) } : {}), ...(line(r.time, 100) ? { time: line(r.time, 100) } : {}) });
  }
  return result;
}

export function projectKnowledge(events: readonly KnowledgeEvent[], roster: readonly string[], legacy: readonly KnowledgeFact[] = []): KnowledgeFact[] {
  const projected = new Map<string, KnowledgeFact>();
  const factOrder = new Map<string, true>();
  const touch = (id: string) => { factOrder.delete(id); factOrder.set(id, true); };
  for (const row of legacy) projected.set(`${row.actor.toLocaleLowerCase()}\u0000${row.factId || factKey(row.fact)}`, row);
  for (const row of legacy) touch(row.factId || factKey(row.fact));
  const byId = new Map<string, KnowledgeEvent>();
  for (const event of events) {
    touch(event.factId);
    if (event.kind === 'event' && !byId.has(event.factId)) byId.set(event.factId, event);
    const origin = byId.get(event.factId) ?? event;
    for (const actor of event.audience) {
      const id = `${actor.toLocaleLowerCase()}\u0000${event.factId}`;
      const previous = projected.get(id);
      const rank = { unknown: 0, suspected: 1, heard: 2, known: 3 };
      if (previous && rank[previous.status] > rank[event.mode]) continue;
      projected.set(id, { actor, factId: event.factId, fact: origin.fact, status: event.mode,
        source: event.source, origin: { leafId: origin.leafId, floor: origin.floor, time: origin.time, evidence: origin.evidence } });
    }
  }
  for (const event of byId.values()) {
    if (event.visibility !== 'private') continue;
    for (const actor of roster) {
      if (event.audience.some(name => name.toLocaleLowerCase() === actor.toLocaleLowerCase())) continue;
      const id = `${actor.toLocaleLowerCase()}\u0000${event.factId}`;
      if (!projected.has(id)) projected.set(id, { actor, factId: event.factId, fact: event.fact,
        status: 'unknown', source: '未接触该私密场景，暂无传播记录',
        origin: { leafId: event.leafId, floor: event.floor, time: event.time, evidence: event.evidence } });
    }
  }
  const current = new Set([...factOrder.keys()].slice(-60));
  return [...projected.values()].filter(row => current.has(row.factId || factKey(row.fact)));
}

export interface KnowledgeGroundingContext {
  prior?: readonly KnowledgeFact[];
  sceneParticipants?: readonly string[];
  leafId?: string;
  floor?: number;
  time?: string;
}
function messageAt(body: string, index: number): string {
  const starts = ['【用户·', '【角色·'].map(marker => body.lastIndexOf(marker, index)).filter(i => i >= 0);
  if (!starts.length) return body;
  const start = Math.max(...starts);
  const nextUser = body.indexOf('【用户·', index + 1);
  const nextCharacter = body.indexOf('【角色·', index + 1);
  const end = [nextUser, nextCharacter].filter(i => i >= 0).reduce((a, b) => Math.min(a, b), body.length);
  return body.slice(start, end);
}

function isSpeakerAt(body: string, actor: string, index: number): boolean {
  const message = messageAt(body, index);
  return message.startsWith(`【用户·${actor}】`) || message.startsWith(`【角色·${actor}】`);
}

const privateEvidence = /独处|独自(?:在|和|与)|私下|私密|保密|秘密|仅.{0,24}(?:知道|知情|在场|目睹|参与)|只有.{0,24}(?:知道|知情|在场|目睹|参与)|(?:没人|无人|没有其他人|其他人都不在).{0,16}(?:知道|知情|看见|看到|听见|听到|在场)|(?:不让|没让|没有让|未让|没有告诉|没告诉|未告知|没有告知|未被告知|未被发现|未被看见|未被听见)|关上(?:了)?门|锁上(?:了)?门|门外无人|房间里只剩|两人之间|两人世界|不为他人所知|无人得知|无人知晓|(?:alone|in private|privately|secret(?:ly)?|behind closed doors|nobody else (?:knew|saw|heard)|no one else (?:knew|saw|heard)|without telling|unobserved)/i;
const explicitIgnorance = /不知道|不知情|不知晓|未得知|没有得知|没得知|没听说|未听说|没有听到|没听到|没有听见|没听见|没有看到|没看到|没有看见|没看见|没有告诉|没告诉|未告知|未被告知|并不知|(?:don't|doesn't|didn't|wasn't|weren't) know|wasn't told|didn't hear|didn't see/i;
const transmissionEvidence = /告知|告诉|转告|透露|传话|通报|汇报|听说|听闻|听到|听见|亲眼|亲耳|目睹|看见|看到|发现|查证|证实|得知|获悉|猜测|怀疑|推断|意识到|(?:told|heard|saw|witnessed|learned|suspected|inferred)/i;

function quotedQuestionAt(body: string, index: number): boolean {
  for (const [open, close] of [['“', '”'], ['「', '」'], ['『', '』']] as const) {
    const start = body.lastIndexOf(open, index);
    const end = body.indexOf(close, index);
    if (start >= 0 && end > index && body.lastIndexOf(close, index) < start)
      return /[？?]/.test(body.slice(start, end + 1));
  }
  return false;
}

/** AI 提取的认知必须带本轮正文的逐字证据；缺席者的不知情只接受有角色名单和私密/排除线索支持的记录。 */
export function groundedKnowledge(raw: unknown, content: string, roster: readonly string[] = [], context: KnowledgeGroundingContext = {}): KnowledgeDelta {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const upsert: KnowledgeFact[] = [];
  const remove: NonNullable<KnowledgeDelta['remove']> = [];
  const body = content.replace(/\s+/g, ' ');
  const knownActors = new Set(roster.map(name => line(name, 80).toLocaleLowerCase()).filter(Boolean));
  const priorById = new Map((context.prior ?? []).filter(f => f.factId).map(f => [f.factId!, f]));
  const priorByFact = new Map((context.prior ?? []).map(f => [factKey(f.fact), f]));
  const participants = [...new Set((context.sceneParticipants ?? []).map(name => line(name, 80)).filter(Boolean))];
  const pairScene = participants.length === 2
    && participants.every(name => body.includes(name))
    && /房内|屋内|室内|厅内|堂内|阁内|书房|签押房|寝室|卧室|包厢|密室/.test(body)
    && !/众人|人群|围观|满屋人|一众|旁听|偷听|隔墙有耳/.test(body);
  const currentFacts = new Map<string, KnowledgeFact>();
  const originEvidence = new Map<string, { score: number; evidence: string }>();
  let newFactIndex = 0;
  for (const item of Array.isArray(value.upsert) ? value.upsert.slice(0, 64) : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const actor = line(r.actor, 80), fact = line(r.fact, 240), source = line(r.source, 120);
    const evidence = line(r.evidence, 240);
    if (!actor || !fact || !source || evidence.length < 4 || !statuses.has(r.status as KnowledgeFact['status'])) continue;
    const at = body.indexOf(evidence);
    if (at < 0) continue;
    if (r.status !== 'unknown' && /世界书|角色卡|旁白|推演|全知|未来设定/.test(source)) continue;
    const nearby = body.slice(Math.max(0, at - 240), at + evidence.length + 240);
    const message = messageAt(body, at);
    if (r.status === 'unknown') {
      // 对未在正文点名的旁观者，只允许从本轮之前的角色名册中选择；且须有排除其知情的正文线索。
      // 正文直接写明某人不知道时，角色名与否定证据本身已足够。
      const actorNamed = message.toLocaleLowerCase().includes(actor.toLocaleLowerCase());
      const registered = knownActors.has(actor.toLocaleLowerCase());
      const excludedFromPair = pairScene && !participants.some(name => name.toLocaleLowerCase() === actor.toLocaleLowerCase())
        && !body.toLocaleLowerCase().includes(actor.toLocaleLowerCase());
      if (!(actorNamed && explicitIgnorance.test(message))
        && !(registered && (privateEvidence.test(message) || excludedFromPair))) continue;
    } else {
      // 知情者须在证据附近出现；消息头中的说话人名称也算正文中的角色来源。
      const speaker = isSpeakerAt(body, actor, at);
      const presentInPair = pairScene && participants.some(name => name.toLocaleLowerCase() === actor.toLocaleLowerCase());
      if (!speaker && !presentInPair && !nearby.toLocaleLowerCase().includes(actor.toLocaleLowerCase())) continue;
      // 对他人过往事件的反问不能充当本人亲历的证明。
      if (r.status === 'known' && !fact.includes(actor) && quotedQuestionAt(body, at)
        && !transmissionEvidence.test(nearby)) continue;
    }
    const requested = priorById.get(line(r.factId, 80));
    if (requested && factKey(requested.fact) !== factKey(fact)) continue;
    const previous = requested ?? priorByFact.get(factKey(fact)) ?? currentFacts.get(factKey(fact));
    const actorPrior = (context.prior ?? []).find(entry => entry.actor.toLocaleLowerCase() === actor.toLocaleLowerCase()
      && ((!!requested && entry.factId === requested.factId) || factKey(entry.fact) === factKey(fact)));
    if (actorPrior?.status === 'unknown' && (r.status === 'known' || r.status === 'heard')
      && !transmissionEvidence.test(message)) continue;
    const canonicalFact = previous?.fact ?? fact;
    const factId = previous?.factId ?? (context.leafId ? `kf:${hash(context.leafId)}:${newFactIndex++}` : undefined);
    const origin = previous?.origin ?? (!previous && context.leafId
      ? { leafId: context.leafId, ...(Number.isInteger(context.floor) ? { floor: context.floor } : {}),
        ...(context.time ? { time: context.time } : {}), evidence }
      : undefined);
    const entry: KnowledgeFact = { actor, fact: canonicalFact, source, status: r.status as KnowledgeFact['status'] };
    if (factId) entry.factId = factId;
    if (origin) entry.origin = origin;
    upsert.push(entry);
    if (factId && origin?.leafId === context.leafId) {
      const score = { known: 3, heard: 2, suspected: 1, unknown: 0 }[entry.status];
      if (!originEvidence.has(factId) || score > originEvidence.get(factId)!.score)
        originEvidence.set(factId, { score, evidence });
    }
    currentFacts.set(factKey(fact), entry);
    currentFacts.set(factKey(canonicalFact), entry);
  }
  for (const item of Array.isArray(value.remove) ? value.remove.slice(0, 64) : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const actor = line(r.actor, 80), fact = line(r.fact, 240);
    const evidence = line(r.evidence, 240);
    if (!actor || !fact || evidence.length < 4 || !content.replace(/\s+/g, ' ').includes(evidence)) continue;
    const requested = priorById.get(line(r.factId, 80));
    if (requested && factKey(requested.fact) !== factKey(fact)) continue;
    const previous = requested ?? priorByFact.get(factKey(fact));
    remove.push({ actor, fact: previous?.fact ?? fact, ...(previous?.factId ? { factId: previous.factId } : {}) });
  }
  for (const entry of upsert) {
    const candidate = entry.factId ? originEvidence.get(entry.factId) : undefined;
    if (candidate && entry.origin && entry.origin.leafId === context.leafId)
      entry.origin = { ...entry.origin, evidence: candidate.evidence };
  }
  return { ...(upsert.length ? { upsert } : {}), ...(remove.length ? { remove } : {}) };
}

/** 旧叶子或手动记录读入时只接受合法字段；来源证据已在落叶前检查。 */
export function cleanKnowledge(raw: unknown): KnowledgeDelta {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const upsert: KnowledgeFact[] = [];
  const remove: { actor: string; fact: string }[] = [];
  for (const item of Array.isArray(value.upsert) ? value.upsert : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const actor = line(r.actor, 80), fact = line(r.fact, 240), source = line(r.source, 120);
    if (actor && fact && source && statuses.has(r.status as KnowledgeFact['status'])) {
      const id = line(r.factId, 80) || legacyFactId(fact);
      const originRaw = r.origin && typeof r.origin === 'object' ? r.origin as Record<string, unknown> : null;
      const leafId = line(originRaw?.leafId, 80), evidence = line(originRaw?.evidence, 240);
      const time = line(originRaw?.time, 100);
      const floor = Number.isInteger(originRaw?.floor) && Number(originRaw?.floor) >= 0 ? Number(originRaw?.floor) : undefined;
      upsert.push({ actor, fact, source, status: r.status as KnowledgeFact['status'], factId: id,
        ...(leafId && evidence ? { origin: { leafId, ...(floor !== undefined ? { floor } : {}),
          ...(time ? { time } : {}), evidence } } : {}) });
    }
  }
  for (const item of Array.isArray(value.remove) ? value.remove : []) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const actor = line(r.actor, 80), fact = line(r.fact, 240);
    if (actor && fact) remove.push({ actor, fact, ...(line(r.factId, 80) ? { factId: line(r.factId, 80) } : {}) });
  }
  return { ...(upsert.length ? { upsert } : {}), ...(remove.length ? { remove } : {}) };
}

export function applyKnowledge(target: KnowledgeFact[], delta: KnowledgeDelta | undefined): void {
  if (!delta) return;
  for (const removal of delta.remove ?? []) {
    const index = target.findIndex(x => x.actor.toLocaleLowerCase() === removal.actor.toLocaleLowerCase()
      && ((!!removal.factId && x.factId === removal.factId) || key(x.actor, x.fact) === key(removal.actor, removal.fact)));
    if (index >= 0) target.splice(index, 1);
  }
  for (const fact of delta.upsert ?? []) {
    const canonical = fact.factId ? target.find(x => x.factId === fact.factId) : undefined;
    const entry = { ...fact, fact: canonical?.fact ?? fact.fact,
      ...(canonical?.origin ? { origin: canonical.origin } : {}) };
    const index = target.findIndex(x => x.actor.toLocaleLowerCase() === fact.actor.toLocaleLowerCase()
      && ((!!fact.factId && x.factId === fact.factId) || key(x.actor, x.fact) === key(fact.actor, fact.fact)));
    if (index >= 0) target.splice(index, 1);
    target.push(entry);
    // 最近变化优先，避免少数角色的长期档案挤占全部上下文。
    const same = target.filter(x => x.actor.toLowerCase() === fact.actor.toLowerCase());
    if (same.length > 12) target.splice(target.indexOf(same[0]), 1);
  }
  if (target.length > 120) target.splice(0, target.length - 120);
}

/** 发给规划与正文的紧凑认知账本；未知与怀疑不能升级为事实。 */
export function formatKnowledge(facts: readonly KnowledgeFact[] | undefined, showIds = false): string {
  if (!facts?.length) return '';
  const labels = { known: '确知', heard: '听说', suspected: '怀疑', unknown: '明确不知' };
  const groups = new Map<string, KnowledgeFact[]>();
  for (const fact of facts) groups.set(fact.factId || factKey(fact.fact), [...(groups.get(fact.factId || factKey(fact.fact)) ?? []), fact]);
  return [
    '【角色认知边界｜正文事件与传播路径】',
    '摘要和全知叙述不代表角色知情；未列名者无可靠获知证据。私密事件中明确未接触者不得知道具体内容；只有正文出现新传播路径才能改变。听说和怀疑不得升级为确知。',
    ...[...groups].slice(-24).map(([id, entries]) => {
      const positive = entries.filter(e => e.status !== 'unknown');
      const unknown = entries.filter(e => e.status === 'unknown');
      return `${showIds ? `[${id}]` : ''}${entries[0].fact}｜${positive.map(e => `${e.actor}${labels[e.status]}(${e.source})`).join('、') || '无人可靠获知'}${unknown.length ? `；未接触：${unknown.map(e => e.actor).join('、')}` : ''}`;
    }),
  ].join('\n');
}
