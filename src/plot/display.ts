export interface PlotDisplaySection {
  title: string;
  body: string;
  kind: 'scene' | 'recall' | 'story' | 'character' | 'track' | 'note' | 'focus' | 'plain';
}

export interface PlotDisplay {
  day: string;
  time: string;
  place: string;
  weather: string;
  present: string;
  recallIds: string[];
  preview: string;
  sections: PlotDisplaySection[];
}

const tags: Record<string, { title: string; kind: PlotDisplaySection['kind'] }> = {
  scene: { title: '时空与场景', kind: 'scene' },
  recall: { title: '光阴折痕', kind: 'recall' },
  npcs: { title: '协奏共鸣', kind: 'character' },
  dm_story: { title: '旋律手稿', kind: 'story' },
  dm_track: { title: '视界之外', kind: 'track' },
  file: { title: '念念不忘', kind: 'note' },
  dm_set: { title: '推演设定', kind: 'note' },
};

function field(text: string, name: string): string {
  const bracket = text.match(new RegExp(`【${name}】\\s*([^\\n]+)`));
  const line = text.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*[:：]\\s*([^\\n]+)`, 'i'));
  return (bracket?.[1] || line?.[1] || '').trim();
}

function plainSections(text: string): PlotDisplaySection[] {
  const result: PlotDisplaySection[] = [];
  let title = '推演内容';
  let body: string[] = [];
  const flush = () => {
    const content = body.join('\n').trim();
    if (content) result.push({ title, body: content,
      kind: /选定情节点|下一段行动|推进建议/.test(title) ? 'focus'
        : title === '场景规划' ? 'scene' : title === '角色认知边界' ? 'track'
          : title === '剧情线索' ? 'story' : 'plain' });
    body = [];
  };
  for (const line of text.split('\n')) {
    const heading = line.trim().match(/^(?:#{1,4}\s+(.+)|【([^】]{1,50})】\s*(.*)|\*\*([^*]{1,50})\*\*)$/);
    if (heading) {
      flush();
      title = (heading[1] || heading[2] || heading[4]).trim();
      if (heading[3]) body.push(heading[3]);
    } else body.push(line);
  }
  flush();
  return result;
}

function storySections(body: string): PlotDisplaySection[] {
  const result: PlotDisplaySection[] = [];
  let title = '旋律手稿';
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) result.push({ title, body: text, kind: 'story' });
    lines = [];
  };
  for (const line of body.split('\n')) {
    const heading = line.trim().match(/^\[(主线|个人线|支线|约定|敌方)\]$/);
    if (heading) { flush(); title = heading[1]; }
    else lines.push(line);
  }
  flush();
  return result;
}

function cleanTaggedBody(body: string): string {
  const labels: Record<string, string> = { inner: '内心', act: '行动', npc_track: '角色动向', npc_jump: '角色变动' };
  return body.replace(/<(inner|act|npc_track|npc_jump)\b[^>]*>/gi, (_, tag: string) => `\n【${labels[tag.toLowerCase()] || tag}】\n`)
    .replace(/<\/(?:inner|act|npc_track|npc_jump)>/gi, '\n').trim();
}

/** 参考“回响”的信息层级，解析已保存的推演文本；只返回纯文本，不执行附件中的 HTML/JS。 */
export function parsePlotDisplay(raw: string): PlotDisplay {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  const sections: PlotDisplaySection[] = [];
  let scene = '';
  let recall = '';
  const tagPattern = /<(scene|recall|npcs|dm_story|dm_track|file|dm_set)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const leftovers = text.replace(tagPattern, (_, tag: string, content: string) => {
    const name = tag.toLowerCase();
    const body = cleanTaggedBody(content);
    if (name === 'scene') scene = body;
    if (name === 'recall') recall = body;
    if (name === 'dm_story') sections.push(...storySections(body));
    else if (body) sections.push({ title: tags[name].title, body, kind: tags[name].kind });
    return '\n';
  }).trim();
  if (leftovers) sections.push(...plainSections(leftovers));
  if (!sections.length && text) sections.push(...plainSections(text));
  if (!scene) scene = sections.find(section => section.title === '场景规划')?.body ?? '';

  const timeline = scene.match(/^\s*Day\s*[:：]\s*(.+?)[,，\s]+(\d{1,2}\s*[:：]\s*\d{2})/im);
  const day = timeline?.[1]?.trim() || '';
  const time = timeline?.[2]?.replace(/\s+/g, '').replace('：', ':') || '';
  const place = field(scene, '地点') || field(scene, '场景') || '';
  const weather = field(scene, '天气') || (scene.match(/天气\s*[=＝]\s*([^|｜\n]+)/)?.[1] || '').trim();
  const present = field(scene, '在场') || (scene.match(/在场\s*[:：]\s*([^|｜\n]+)/)?.[1] || '').trim();
  const recallIds = [...new Set((recall.match(/\bAM\d+\b/gi) ?? []).map(id => id.toUpperCase()))].slice(0, 30);
  const focus = sections.find(section => section.kind === 'focus') ?? sections.find(section => section.kind !== 'scene' && section.kind !== 'recall') ?? sections[0];
  const preview = (focus?.body || place || '展开查看本轮推演').replace(/\s+/g, ' ').slice(0, 90);
  return { day, time, place, weather, present, recallIds, preview, sections };
}
