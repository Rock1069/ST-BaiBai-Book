import { describe, expect, it } from 'vitest';
import type { STMessage } from '@/st/context';
import { deriveMemory } from './apply';
import { formatKnowledge, groundedKnowledge } from './knowledge';
import type { StoredDelta } from './types';

function message(id: string, delta: StoredDelta, swipe = 0): STMessage {
  return { name: '角色', mes: '已经发生的剧情', is_user: false, is_system: false, swipe_id: swipe,
    extra: { bbs_leaf: { id, text: '摘要', delta, createdAt: 1, swipe: 0, v: 1 } } } as STMessage;
}

describe('角色认知闭环', () => {
  it('只接受本轮正文逐字支持的知情变化', () => {
    const content = '陆家豪对艾琳说：“钥匙藏在车里。”艾琳点头。';
    const delta = groundedKnowledge({ upsert: [
      { actor: '艾琳', fact: '钥匙藏在车里', status: 'heard', source: '陆家豪告知', evidence: '钥匙藏在车里' },
      { actor: '远处的李明', fact: '钥匙藏在车里', status: 'known', source: '旁白', evidence: '钥匙藏在车里' },
      { actor: '艾琳', fact: '车已抵达', status: 'known', source: '推演草案', evidence: '车已抵达' },
    ] }, content);
    expect(delta.upsert).toEqual([{ actor: '艾琳', fact: '钥匙藏在车里', status: 'heard', source: '陆家豪告知' }]);
    expect(formatKnowledge(delta.upsert)).toContain('听说「钥匙藏在车里」');
  });

  it('按已发生楼层重放；升级、撤销、删除楼层和切页都能回退', () => {
    const heard = message('k1', { knowledge: { upsert: [{ actor: '艾琳', fact: '钥匙藏在车里', status: 'heard', source: '陆家豪告知' }] } });
    const verified = message('k2', { knowledge: { upsert: [{ actor: '艾琳', fact: '钥匙藏在车里', status: 'known', source: '亲眼找到' }] } });
    const retracted = message('k3', { knowledge: { remove: [{ actor: '艾琳', fact: '钥匙藏在车里' }] } });
    expect(deriveMemory([heard]).knowledge[0].status).toBe('heard');
    expect(deriveMemory([heard, verified]).knowledge).toEqual([expect.objectContaining({ actor: '艾琳', fact: '钥匙藏在车里', status: 'known', source: '亲眼找到', factId: expect.stringMatching(/^kf:/) })]);
    expect(deriveMemory([heard, verified, retracted]).knowledge).toEqual([]);
    expect(deriveMemory([verified]).knowledge[0].source).toBe('亲眼找到');
    expect(deriveMemory([heard, message('k4', { knowledge: { upsert: [{ actor: '李明', fact: '秘密', status: 'known', source: '目睹' }] } }, 1)]).knowledge).toHaveLength(1);
  });
});
