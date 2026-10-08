import { readFile, mkdir, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/plot/demStabs.ts', import.meta.url), 'utf8');
// 三段常量均为静态模板，直接提取，避免维护第二份提示词。
function template(name) {
  const match = source.match(new RegExp('export const ' + name + ' = `([\\s\\S]*?)`;'));
  if (!match) throw new Error('Missing static prompt: ' + name);
  return match[1];
}
const preset = {
  name: '柏宝书 · DEM × Stab’s · 场景导演 v1.0',
  version: '1.0',
  description: '根据 DEM 与 Stab’s 的设计重新编写的中文单回合规划；四条候选自动择一，结合已有记忆和人物认知边界。',
  sourceReferences: [
    { name: 'DEUS EX MACHINA V2.5', author: 'lsennn / Fay', url: 'https://github.com/lsennn/Deus-ex-machina' },
    { name: 'Stab’s Directives V3.0.1', author: 'Zorgonatis', url: 'https://github.com/Zorgonatis/Stabs-EDH' },
  ],
  bbsSettings: { promptMode: 'dem_stabs' },
  worldbookEnabled: true,
  contextTurnCount: 6,
  plotTasks: [{
    id: 'bbsDemStabs', name: '场景导演', enabled: true, stage: 1, order: 0,
    promptGroup: [
      { role: 'SYSTEM', content: template('DEM_STABS_PLOT_PROMPT') },
      { role: 'USER', content: template('DEM_STABS_MATERIALS_TEMPLATE') },
    ],
  }],
  finalSystemDirective: template('DEM_STABS_DIRECTIVE'),
};
const folder = new URL('../docs/presets/', import.meta.url);
await mkdir(folder, { recursive: true });
await writeFile(new URL('DEM-Stabs-场景导演.plot-preset.json', folder), JSON.stringify([preset], null, 2) + '\n', 'utf8');
console.log('Exported DEM × Stab’s plot preset');
