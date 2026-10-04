<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import BbsSelect from '@/components/BbsSelect.vue';
import ModalMask from '@/components/ModalMask.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { appendOpToLatestLeaf } from '@/memory/apply';
import { memory, derivedMeta } from '@/memory/store';
import { refreshInjection } from '@/memory/inject';
import { BIO_EVENT_LABELS, NEED_LABELS, bioClock, cyclePhase, pregnancyPhase, emptyBioProfile, sameBioSubject, type BioProfile, type BioEventKind, type NeedKey, type BioDelta } from '@/memory/physiology';
import { getContext } from '@/st/context';
import { ageDisplay } from '@/memory/timeRel';
import { toast } from '@/st/toast';

const shown = ref(true);
const hasLeaf = computed(() => derivedMeta.hasLeaf);
const userName = computed(() => { void derivedMeta.rev; return getContext()?.name1?.trim() || '主角'; });
const nameOf = (subject: string): string => subject === 'user' ? userName.value : subject;
const subjectOptions = computed(() => [{ value: 'user', label: `${userName.value}（主角）` }, ...memory.npcs.map(n => ({ value: n.name, label: n.name }))]);
const newOptions = computed(() => subjectOptions.value.filter(o => !memory.physiology.some(p => sameBioSubject(p.subject, o.value))));
const editing = ref<BioProfile | null>(null);
const isNew = ref(false);
const removing = ref('');
const eventDraft = ref<{ subject: string; kind: BioEventKind; text: string; days: string } | null>(null);
const timeOpen = ref(false);
const hours = ref('24');
const needKeys = Object.keys(NEED_LABELS) as NeedKey[];
const timelineShown = ref<Record<string, boolean>>({});
const eventOptions = computed(() => {
  const p = memory.physiology.find(p => sameBioSubject(p.subject, eventDraft.value?.subject ?? ''));
  return (Object.keys(BIO_EVENT_LABELS) as BioEventKind[]).filter(kind => {
    if (kind === 'cycle_start') return p?.cycle.enabled && p.pregnancy.status !== 'pregnant';
    if (kind === 'pregnancy_confirm') return p?.pregnancy.enabled;
    if (kind === 'birth') return p?.pregnancy.enabled && p.pregnancy.status === 'pregnant';
    if (kind === 'pregnancy_end') return p?.pregnancy.enabled && p.pregnancy.status !== 'none';
    return true;
  }).map(value => ({ value, label: BIO_EVENT_LABELS[value] }));
});
function openProfile(p?: BioProfile): void {
  if (!hasLeaf.value) return;
  isNew.value = !p;
  editing.value = p ? JSON.parse(JSON.stringify(p)) as BioProfile : emptyBioProfile(newOptions.value[0]?.value ?? 'user');
}
function write(delta: BioDelta): boolean {
  if (!hasLeaf.value || !appendOpToLatestLeaf({ physiology: delta })) { toast('需先有一条有效摘要，才能保存生理档案', 'warning'); return false; }
  refreshInjection(); return true;
}
function saveProfile(): void {
  const p = editing.value; if (!p) return;
  if (isNew.value && !newOptions.value.some(o => o.value === p.subject)) return;
  const numeric = [p.cycle.lengthDays, p.cycle.periodDays, p.pregnancy.dueDays];
  if (numeric.some(n => typeof n !== 'number' || !Number.isFinite(n)) || p.cycle.lengthDays < 2 || p.cycle.lengthDays > 365
      || p.cycle.periodDays < 1 || p.cycle.periodDays > p.cycle.lengthDays || p.pregnancy.dueDays < 1 || p.pregnancy.dueDays > 1000) {
    toast('请填写有效天数：经期长度不能超过周期长度', 'warning'); return;
  }
  if (p.cycle.day !== null && (p.cycle.day < 1 || p.cycle.day > p.cycle.lengthDays)) { toast('周期当前天数需在周期长度范围内', 'warning'); return; }
  if (write({ ops: [{ op: 'configure', subject: p.subject, patch: { enabled: p.enabled, notes: p.notes, autoNeeds: p.autoNeeds, cycle: p.cycle, pregnancy: p.pregnancy, needs: p.needs } }] })) {
    editing.value = null; shown.value = true;
  }
}
function setNullable(target: Record<string, unknown>, key: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value; target[key] = value === '' ? null : Number(value);
}
function openEvent(p: BioProfile): void { eventDraft.value = { subject: p.subject, kind: 'note', text: '', days: '' }; }
function saveEvent(): void {
  const e = eventDraft.value; if (!e || !eventOptions.value.some(o => o.value === e.kind)) return;
  const p = memory.physiology.find(p => sameBioSubject(p.subject, e.subject)); if (!p?.enabled) return;
  const days = e.kind === 'pregnancy_confirm' && e.days.trim() ? Number(e.days) : undefined;
  if (days !== undefined && (!Number.isFinite(days) || days < 0 || days > 36500)) { toast('孕期天数需为有效非负数字', 'warning'); return; }
  if (write({ ops: [{ op: 'event', subject: e.subject, kind: e.kind, text: e.text.trim(), days, source: 'manual' }] })) eventDraft.value = null;
}
function advanceTime(): void {
  const n = Number(hours.value); if (!Number.isFinite(n) || n <= 0 || n > 87600) { toast('请填写大于0、最多87600的小时数', 'warning'); return; }
  if (write({ ops: [{ op: 'advance', minutes: n * 60 }] })) timeOpen.value = false;
}
function removeProfile(): void { if (write({ ops: [{ op: 'remove', subject: removing.value }] })) removing.value = ''; }
function details(p: BioProfile): string {
  const role = p.subject === 'user' ? memory.protagonist : memory.npcs.find(n => sameBioSubject(n.name, p.subject));
  return role ? [role.gender, ageDisplay(role.age, role.ageTime, memory.state.time)].filter(Boolean).join(' · ') : '名册中已移除，保留历史档案';
}
function pregnancyDay(p: BioProfile): string {
  const day = p.pregnancy.days;
  if (p.pregnancy.status === 'none') return '';
  if (day === null) return '天数未知，待校准';
  if (p.pregnancy.status === 'postpartum') return `产后第${Math.floor(day)}天`;
  return `${Math.floor(day / 7)}周${Math.floor(day % 7)}天 · 距预计孕期结束${Math.max(0, Math.ceil(p.pregnancy.dueDays - day))}天`;
}
</script>

<template>
  <section class="bio-panel" aria-label="生理档案">
    <div class="bio-head">
      <button class="bio-fold" type="button" :aria-expanded="shown" @click="shown = !shown">
        <Icon name="chevron" :class="{ collapsed: !shown }" />
        <strong>生理档案</strong><span class="bio-count">{{ memory.physiology.length }}</span>
      </button>
      <button class="bbs-item-act" type="button" title="添加生理档案" aria-label="添加生理档案" :disabled="!hasLeaf || !newOptions.length" @click="openProfile()"><Icon name="plus" /></button>
    </div>
    <div v-if="shown" class="bio-body">
      <p class="bio-hint">周期／孕期时间线＋身体需求。选择角色开启；未知值留空，可随时校准。</p>
      <p v-if="!hasLeaf" class="bio-hint">需先生成一条有效正文摘要，再添加档案。</p>
      <div v-if="!memory.physiology.length" class="bio-empty">
        尚未开启生理档案
        <button class="bbs-btn" type="button" :disabled="!hasLeaf" @click="openProfile()">选择角色并开启</button>
      </div>
      <div v-if="memory.physiology.length" class="bio-toolbar">
        <span class="bio-hint">{{ bioClock(memory.state.time) ? '按故事日期推进' : '日期暂无法计算；明确相对时长或手动推进' }}</span>
        <button class="bbs-btn" type="button" :disabled="!hasLeaf || !memory.physiology.some(p => p.enabled)" @click="timeOpen = true">手动推进时间</button>
      </div>
      <article v-for="p in memory.physiology" :key="p.subject" class="bio-card" :class="{ paused: !p.enabled }">
        <header class="bio-head">
          <div><strong>{{ nameOf(p.subject) }}</strong><small class="bio-meta">{{ details(p) }}{{ !p.enabled ? ' · 已暂停' : '' }}</small></div>
          <div class="bio-actions">
            <button class="bbs-item-act" type="button" title="校准档案" aria-label="校准生理档案" :disabled="!hasLeaf" @click="openProfile(p)"><Icon name="edit" /></button>
            <button class="bbs-item-act" type="button" title="移除档案" aria-label="移除生理档案" :disabled="!hasLeaf" @click="removing = p.subject"><Icon name="trash" /></button>
          </div>
        </header>
        <p v-if="p.notes" class="bio-notes">{{ p.notes }}</p>
        <div v-if="p.cycle.enabled" class="bio-state"><span>周期</span><strong>{{ cyclePhase(p) }}</strong><small>{{ p.cycle.day === null ? '天数未知' : `第${Math.floor(p.cycle.day)}天 / ${p.cycle.lengthDays}天` }}</small></div>
        <div v-if="p.pregnancy.enabled" class="bio-state"><span>孕期</span><strong>{{ pregnancyPhase(p) }}</strong><small>{{ pregnancyDay(p) }}</small></div>
        <div class="bio-needs">
          <div v-for="key in needKeys" :key="key" class="bio-need">
            <div><span>{{ NEED_LABELS[key] }}</span><strong>{{ p.needs[key] === null ? '未知' : Math.round(p.needs[key]!) }}</strong></div>
            <div class="bio-meter" :aria-label="`${NEED_LABELS[key]}${p.needs[key] ?? '未知'}`"><span :style="{ width: `${p.needs[key] ?? 0}%` }" :class="{ high: (p.needs[key] ?? 0) >= 70 }" /></div>
          </div>
        </div>
        <p class="bio-hint">需求越高越需要补充／休息{{ p.autoNeeds ? ' · 随故事时间变化' : ' · 时间增长已关闭' }}</p>
        <div class="bio-toolbar">
          <button class="bbs-btn" type="button" :disabled="!hasLeaf || !p.enabled" @click="openEvent(p)">登记身体事件</button>
          <button class="bio-link" type="button" :aria-expanded="!!timelineShown[p.subject]" @click="timelineShown[p.subject] = !timelineShown[p.subject]">周期／孕期时间线（{{ p.timeline.length }}）</button>
        </div>
        <ol v-if="timelineShown[p.subject] && p.timeline.length" class="bio-timeline">
          <li v-for="e in [...p.timeline].reverse()" :key="e.id"><small>{{ e.time || '故事时间未明确' }} · {{ e.source === 'manual' ? '手动' : e.source === 'clock' ? '时间推进' : '正文' }}</small><p>{{ e.text }}</p></li>
        </ol>
        <p v-else-if="timelineShown[p.subject]" class="bio-hint">暂无身体事件记录。</p>
      </article>
    </div>
  </section>

  <ModalMask :open="!!editing" @close="editing = null">
    <div v-if="editing" class="bbs-modal bio-modal" role="dialog" aria-modal="true" aria-label="编辑生理档案">
      <header class="bio-head"><strong>{{ isNew ? '开启生理档案' : `校准：${nameOf(editing.subject)}` }}</strong><button class="bbs-item-act" type="button" title="关闭" @click="editing = null"><Icon name="close" /></button></header>
      <label v-if="isNew" class="bio-field"><span>角色</span><BbsSelect v-model="editing.subject" :options="newOptions" aria-label="生理档案角色" /></label>
      <label class="bio-check"><input v-model="editing.enabled" type="checkbox" />启用档案（关闭后暂停时间与事件结算）</label>
      <label class="bio-field"><span>身体档案／注意事项</span><textarea v-model="editing.notes" class="bbs-input" rows="2" maxlength="800" placeholder="体质、长期身体情况或个人设定；可留空" /></label>
      <fieldset class="bio-fieldset">
        <legend>周期</legend><label class="bio-check"><input v-model="editing.cycle.enabled" type="checkbox" />启用周期跟踪</label>
        <div v-if="editing.cycle.enabled" class="bio-grid">
          <label class="bio-field"><span>周期长度（天）</span><input v-model.number="editing.cycle.lengthDays" class="bbs-input" type="number" min="2" max="365" /></label>
          <label class="bio-field"><span>经期长度（天）</span><input v-model.number="editing.cycle.periodDays" class="bbs-input" type="number" min="1" :max="editing.cycle.lengthDays" /></label>
          <label class="bio-field"><span>当前第几天（空＝未知）</span><input :value="editing.cycle.day ?? ''" class="bbs-input" type="number" min="1" :max="editing.cycle.lengthDays" @input="setNullable(editing.cycle, 'day', $event)" /></label>
        </div>
      </fieldset>
      <fieldset class="bio-fieldset">
        <legend>孕期</legend><label class="bio-check"><input v-model="editing.pregnancy.enabled" type="checkbox" />启用孕期跟踪</label>
        <div v-if="editing.pregnancy.enabled" class="bio-grid">
          <label class="bio-field"><span>登记状态</span><BbsSelect v-model="editing.pregnancy.status" :options="[{ value: 'none', label: '未登记怀孕' }, { value: 'pregnant', label: '已确认怀孕' }, { value: 'postpartum', label: '产后' }]" aria-label="孕期状态" /></label>
          <label class="bio-field"><span>预计孕期长度（天）</span><input v-model.number="editing.pregnancy.dueDays" class="bbs-input" type="number" min="1" max="1000" /></label>
          <label v-if="editing.pregnancy.status !== 'none'" class="bio-field"><span>{{ editing.pregnancy.status === 'pregnant' ? '怀孕' : '产后' }}天数（空＝未知）</span><input :value="editing.pregnancy.days ?? ''" class="bbs-input" type="number" min="0" max="36500" @input="setNullable(editing.pregnancy, 'days', $event)" /></label>
        </div>
        <p class="bio-hint">孕期／产后暂停周期；达到预计天数也不会自动分娩。</p>
      </fieldset>
      <fieldset class="bio-fieldset">
        <legend>身体需求</legend><label class="bio-check"><input v-model="editing.autoNeeds" type="checkbox" />随故事时间增加需求</label>
        <div class="bio-grid"><label v-for="key in needKeys" :key="key" class="bio-field"><span>{{ NEED_LABELS[key] }}（0–100）</span><input :value="editing.needs[key] ?? ''" class="bbs-input" type="number" min="0" max="100" placeholder="未知" @input="setNullable(editing.needs, key, $event)" /></label></div>
        <p class="bio-hint">RP刻度：每小时饥饿＋4、口渴＋6、疲劳＋3；未知值保持未知。进食／饮水／睡醒将对应需求设为10。可关闭时间增长。</p>
      </fieldset>
      <footer class="bio-foot"><button class="bbs-btn" type="button" @click="editing = null">取消</button><button class="bbs-btn bbs-btn-primary" type="button" :disabled="!hasLeaf" @click="saveProfile">保存</button></footer>
    </div>
  </ModalMask>
  <ModalMask :open="!!eventDraft" @close="eventDraft = null">
    <div v-if="eventDraft" class="bbs-modal bio-modal" role="dialog" aria-modal="true" aria-label="登记身体事件">
      <header class="bio-head"><strong>登记：{{ nameOf(eventDraft.subject) }}</strong><button class="bbs-item-act" type="button" title="关闭" @click="eventDraft = null"><Icon name="close" /></button></header>
      <label class="bio-field"><span>已发生的事件</span><BbsSelect v-model="eventDraft.kind" :options="eventOptions" aria-label="身体事件类别" /></label>
      <label v-if="eventDraft.kind === 'pregnancy_confirm'" class="bio-field"><span>明确的怀孕天数（未知留空）</span><input v-model="eventDraft.days" class="bbs-input" type="number" min="0" max="36500" /></label>
      <label class="bio-field"><span>记录说明</span><textarea v-model="eventDraft.text" class="bbs-input" rows="2" maxlength="800" placeholder="已发生的身体情况（可选）" /></label>
      <footer class="bio-foot"><button class="bbs-btn" type="button" @click="eventDraft = null">取消</button><button class="bbs-btn bbs-btn-primary" type="button" :disabled="!hasLeaf" @click="saveEvent">登记</button></footer>
    </div>
  </ModalMask>
  <ModalMask :open="timeOpen" @close="timeOpen = false">
    <div class="bbs-modal bio-modal" role="dialog" aria-modal="true" aria-label="手动推进生理时间">
      <header class="bio-head"><strong>手动推进时间</strong><button class="bbs-item-act" type="button" title="关闭" @click="timeOpen = false"><Icon name="close" /></button></header>
      <p class="bio-hint">按已发生但尚未结算的时长，推进所有启用档案的周期／孕期与需求。后续绝对故事时间追上时扣除这段时长，避免重复推进。</p>
      <label class="bio-field"><span>经过小时数</span><input v-model="hours" class="bbs-input" type="number" min="0.01" max="87600" step="any" /></label>
      <footer class="bio-foot"><button class="bbs-btn" type="button" @click="timeOpen = false">取消</button><button class="bbs-btn bbs-btn-primary" type="button" :disabled="!hasLeaf" @click="advanceTime">推进</button></footer>
    </div>
  </ModalMask>
  <ConfirmDialog :open="!!removing" title="移除生理档案" tone="danger" @cancel="removing = ''" @confirm="removeProfile">移除 {{ nameOf(removing) }} 的当前档案及时间线？可重新开启。</ConfirmDialog>
</template>

<style scoped>
.bio-panel { margin-bottom: 24px; }
.bio-head, .bio-toolbar, .bio-actions, .bio-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.bio-head { margin-bottom: 10px; }
.bio-fold { display: flex; align-items: center; gap: 8px; background: none; border: 0; padding: 4px 0; color: var(--bbs-ink); font-size: 15px; cursor: pointer; }
.bio-fold .collapsed { transform: rotate(-90deg); }
.bio-count { border: 1px solid var(--bbs-accent); color: var(--bbs-accent); border-radius: 20px; padding: 0 8px; font-size: 12px; }
.bio-hint, .bio-meta { font-size: 11.5px; line-height: 1.7; color: var(--bbs-ink-muted); }
.bio-meta { display: block; }
.bio-hint { margin: 8px 0; }
.bio-body { display: grid; gap: 10px; }
.bio-empty { display: grid; gap: 12px; justify-items: center; padding: 20px; border: 1px dashed var(--bbs-line); border-radius: var(--bbs-radius); color: var(--bbs-ink-muted); }
.bio-card { border: 1px solid var(--bbs-line); border-left: 3px solid var(--bbs-accent); border-radius: var(--bbs-radius); background: var(--bbs-surface); padding: 12px; }
.bio-card.paused { border-left-color: var(--bbs-line-strong); }
.bio-notes, .bio-timeline p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0; line-height: 1.7; }
.bio-state { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin: 8px 0; }
.bio-state > span { color: var(--bbs-accent); font-size: 12px; }
.bio-state small { color: var(--bbs-ink-muted); }
.bio-needs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.bio-need > div:first-child { display: flex; justify-content: space-between; font-size: 12px; gap: 4px; margin-bottom: 5px; }
.bio-meter { height: 5px; background: var(--bbs-surface-2); border-radius: 4px; overflow: hidden; }
.bio-meter span { display: block; height: 100%; background: var(--bbs-accent); }
.bio-meter span.high { background: var(--bbs-warning); }
.bio-toolbar { flex-wrap: wrap; }
.bio-link { background: none; border: 0; color: var(--bbs-accent); font-size: 12px; cursor: pointer; padding: 6px 0; }
.bio-timeline { list-style: none; padding: 0 0 0 12px; border-left: 1px solid var(--bbs-line); margin: 12px 0 0; max-height: 320px; overflow-y: auto; }
.bio-timeline li { padding: 4px 0 10px; }
.bio-timeline small { color: var(--bbs-ink-muted); font-size: 11px; }
.bio-modal { display: grid; gap: 12px; }
.bio-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; min-width: 0; }
.bio-check { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 1.7; }
.bio-fieldset { border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); padding: 12px; min-width: 0; margin: 0; }
.bio-fieldset legend { color: var(--bbs-accent); font-weight: 600; font-size: 13px; padding: 0 5px; }
.bio-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.bio-foot { justify-content: flex-end; }
@media (max-width: 420px) { .bio-grid { grid-template-columns: 1fr; } }
</style>
