import { afterEach, describe, expect, it, vi } from 'vitest';
import * as settings from '@/api/settings';
import * as context from '@/st/context';
import type { STContext, STMessage } from '@/st/context';
import { deriveMemory } from './apply';
import { buildStateInjectionText, refreshInjection } from './inject';
import { memory, recomputeDerived } from './store';
import type { StoredDelta } from './types';

let seq = 0;
function message(delta: StoredDelta): STMessage {
  const id = ++seq;
  return {
    name: '角色', is_user: false, is_system: false, mes: `剧情 ${id}`,
    extra: { bbs_leaf: { id: `item-place-${id}`, text: `剧情 ${id}`, delta, createdAt: id, swipe: 0, v: 1 } },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  settings.apiSettings.summaryOnlyMode = false;
  settings.apiSettings.injection.items = true;
  settings.apiSettings.injection.scenes = true;
});

describe('物品存放地点发送给主模型', () => {
  it('从明确随身改为仅给存放地点后,后续轮次仍标记为不随身并注入地点', () => {
    const chat = [
      message({ location: '卧室', items: { add: [{ name: '丝绸内衣', carried: true }] } }),
      message({ items: { update: [{ name: '丝绸内衣', location: '衣柜' }] } }),
      message({}),
      message({}),
    ];
    const setExtensionPrompt = vi.fn();
    vi.spyOn(context, 'getContext').mockReturnValue({
      chat, name1: '主角', name2: '角色', getCurrentChatId: () => 'item-place-test', setExtensionPrompt,
    } as unknown as STContext);
    vi.spyOn(settings, 'engineActiveHere').mockReturnValue(true);

    recomputeDerived();
    expect(deriveMemory(chat).items[0]).toMatchObject({ name: '丝绸内衣', carried: false, location: '衣柜' });
    expect(memory.items[0]).toMatchObject({ carried: false, location: '衣柜' });
    const state = buildStateInjectionText();
    expect(state).toContain('丝绸内衣 ×1 [存:衣柜]');
    expect(state).toContain('该物品不在角色身上');
    expect(state).toContain('除非后续剧情明确从该地点取回');

    refreshInjection();
    const stateCall = setExtensionPrompt.mock.calls.find(call => call[0] === 'baibai_book_memory_state');
    expect(stateCall?.[1]).toBe(state);
    expect(stateCall?.[2]).toBe(1);
  });

  it('明确取回随身时清除旧存放地点', () => {
    const chat = [
      message({ items: { add: [{ name: '钥匙', carried: false, location: '衣柜' }] } }),
      message({ items: { update: [{ name: '钥匙', carried: true, location: '衣柜' }] } }),
    ];
    expect(deriveMemory(chat).items[0]).toMatchObject({ name: '钥匙', carried: true });
    expect(deriveMemory(chat).items[0].location).toBeUndefined();
  });
});
