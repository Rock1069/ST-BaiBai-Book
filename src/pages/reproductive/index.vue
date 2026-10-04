<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import BbsSelect from '@/components/BbsSelect.vue';
import Icon from '@/components/Icon.vue';
import { appendOpToLatestLeaf } from '@/memory/apply';
import { projectReproductive, parseGregorianDate, storyGregorianDate } from '@/memory/reproductive';
import { derivedMeta, memory } from '@/memory/store';
import type { PregnancyDating, PregnancyStatus, ReproductiveCycleType, ReproductiveRegularity } from '@/memory/types';
import { getContext } from '@/st/context';
import { toast } from '@/st/toast';

const cycleTypes: { value: ReproductiveCycleType; label: string }[] = [
  { value: 'unknown', label: '尚未确认' }, { value: 'human', label: '适用人类生理' }, { value: 'nonhuman', label: '非人类／自定义设定' },
];
const regularities: { value: ReproductiveRegularity; label: string }[] = [
  { value: 'unknown', label: '未知' }, { value: 'regular', label: '已确认规律' }, { value: 'irregular', label: '不规律' },
];
const pregnancyStatuses: { value: PregnancyStatus; label: string }[] = [
  { value: 'unknown', label: '未确认' }, { value: 'confirmed', label: '已确认怀孕' }, { value: 'ended', label: '妊娠已结束' },
];
type DatingBasis = PregnancyDating['basis'] | '';
const datingBases: { value: DatingBasis; label: string }[] = [
  { value: '', label: '暂无日期依据' }, { value: 'ultrasoundDueDate', label: '超声确定的预产期' },
  { value: 'lastPeriod', label: '末次月经首日' }, { value: 'conception', label: '已知受孕日期' },
];

const selectedActor = ref('');
const draft = reactive({
  cycleType: 'unknown' as ReproductiveCycleType,
  regularity: 'unknown' as ReproductiveRegularity,
  pregnancyStatus: 'unknown' as PregnancyStatus,
  lastPeriodStart: '', cycleLengthDays: '', periodLengthDays: '',
  datingBasis: '' as DatingBasis, datingDate: '',
});
const error = ref('');
const available = computed(() => {
  void derivedMeta.rev;
  return !!getContext()?.getCurrentChatId?.();
});
const actors = computed(() => {
  if (!available.value) return [];
  const names = new Set<string>();
  const ctx = getContext();
  for (const name of [ctx?.name2, ctx?.name1, ...memory.npcs.map(n => n.name), ...memory.reproductive.map(p => p.subject)]) {
    if (name?.trim()) names.add(name.trim());
  }
  return [...names];
});
const actorOptions = computed(() => actors.value.map(name => ({ value: name, label: name })));
watch(actors, list => {
  if (!list.includes(selectedActor.value)) selectedActor.value = list[0] ?? '';
}, { immediate: true });
const profile = computed(() => memory.reproductive.find(p => p.subject === selectedActor.value));
const storyDate = computed(() => storyGregorianDate(memory.state.time));
const projection = computed(() => profile.value ? projectReproductive(profile.value, storyDate.value) : null);
const actorAge = computed(() => selectedActor.value === getContext()?.name1
  ? memory.protagonist.age : memory.npcs.find(n => n.name === selectedActor.value)?.age);

watch([selectedActor, profile], () => {
  const p = profile.value;
  draft.cycleType = p?.cycleType ?? 'unknown';
  draft.regularity = p?.regularity ?? 'unknown';
  draft.pregnancyStatus = p?.pregnancyStatus ?? 'unknown';
  draft.lastPeriodStart = p?.lastPeriodStart ?? '';
  draft.cycleLengthDays = p?.cycleLengthDays ? String(p.cycleLengthDays) : '';
  draft.periodLengthDays = p?.periodLengthDays ? String(p.periodLengthDays) : '';
  draft.datingBasis = p?.dating?.basis ?? '';
  draft.datingDate = p?.dating?.date ?? '';
  error.value = '';
}, { immediate: true });

function save() {
  error.value = '';
  if (!selectedActor.value) { error.value = '请先选择角色'; return; }
  if (!derivedMeta.hasLeaf) { error.value = '请先完成至少一楼摘要，再保存角色状态'; return; }
  if (draft.lastPeriodStart && !parseGregorianDate(draft.lastPeriodStart)) { error.value = '经期首日需要有效公历日期'; return; }
  if (draft.cycleLengthDays && (!/^\d+$/.test(draft.cycleLengthDays) || Number(draft.cycleLengthDays) < 15 || Number(draft.cycleLengthDays) > 60)) {
    error.value = '周期长度需为 15–60 天的整数'; return;
  }
  if (draft.periodLengthDays && (!/^\d+$/.test(draft.periodLengthDays) || Number(draft.periodLengthDays) < 1 || Number(draft.periodLengthDays) > 10)) {
    error.value = '经期天数需为 1–10 天的整数'; return;
  }
  if (draft.pregnancyStatus === 'confirmed' && ((draft.datingBasis && !parseGregorianDate(draft.datingDate)) || (!draft.datingBasis && draft.datingDate))) {
    error.value = '孕期日期与日期依据必须同时填写'; return;
  }
  const ok = appendOpToLatestLeaf({ reproductive: { upsert: [{
    subject: selectedActor.value,
    cycleType: draft.cycleType,
    regularity: draft.regularity,
    pregnancyStatus: draft.pregnancyStatus,
    lastPeriodStart: draft.lastPeriodStart || null,
    cycleLengthDays: draft.cycleLengthDays ? Number(draft.cycleLengthDays) : null,
    periodLengthDays: draft.periodLengthDays ? Number(draft.periodLengthDays) : null,
    dating: draft.pregnancyStatus === 'confirmed' && draft.datingBasis ? { basis: draft.datingBasis, date: draft.datingDate } : null,
    source: '用户手动设定',
  }] } });
  if (ok) toast(`已保存「${selectedActor.value}」的生理时间线`, 'success');
  else error.value = '未找到可写入的摘要楼层';
}
function remove() {
  if (!profile.value || !derivedMeta.hasLeaf) return;
  if (!window.confirm(`删除「${selectedActor.value}」的生理时间线记录？`)) return;
  if (appendOpToLatestLeaf({ reproductive: { remove: [selectedActor.value] } })) toast('已删除记录', 'success');
  else error.value = '未找到可写入的摘要楼层';
}
</script>

<template>
  <section class="reproductive-page">
    <header>
      <h2 class="bbs-title bbs-title-sub"><Icon name="reproductive" /> 生理时间线</h2>
      <p>用故事里的真实日期锚点追踪经期与孕期；模型负责提取事实，日期由代码按公历计算。</p>
    </header>
    <p v-if="!available" class="notice">请先打开一个聊天。</p>
    <template v-else>
      <div class="notice">
        <strong>准确度边界</strong>
        <p>年龄和世界书可帮助判断适用的人物设定，但不能单独推出某人的经期、排卵或怀孕。这里不提供“绝对安全期”：日历窗口外仍可能受孕；不规律、资料缺失、超过预计下次经期或非人类生理时停止推算。</p>
      </div>

      <div class="panel">
        <label>角色
          <BbsSelect v-model="selectedActor" :options="actorOptions" aria-label="选择生理时间线角色" />
        </label>
        <p v-if="selectedActor" class="hint">角色年龄：{{ actorAge || '未记录' }}。年龄只作背景参考，不代入日期公式。</p>
        <p class="hint">当前故事时间：{{ memory.state.time || '未知' }} <template v-if="!storyDate">· 无完整公历日期，不能自动按天推算</template></p>
      </div>

      <div v-if="selectedActor" class="panel">
        <h3>{{ selectedActor }} · 已记录事实</h3>
        <p v-if="!profile" class="hint">暂无记录。摘要只在正文有明确依据时添加；也可在下方手动填写。</p>
        <template v-else>
          <dl class="facts">
            <div><dt>生理规则</dt><dd>{{ cycleTypes.find(x => x.value === profile?.cycleType)?.label }}</dd></div>
            <div><dt>末次经期首日</dt><dd>{{ profile.lastPeriodStart || '未记录' }}</dd></div>
            <div><dt>周期长度</dt><dd>{{ profile.cycleLengthDays ? `${profile.cycleLengthDays} 天` : '未记录' }}</dd></div>
            <div><dt>规律性</dt><dd>{{ regularities.find(x => x.value === profile?.regularity)?.label }}</dd></div>
            <div><dt>孕期状态</dt><dd>{{ pregnancyStatuses.find(x => x.value === profile?.pregnancyStatus)?.label }}</dd></div>
            <div v-if="profile.dating"><dt>孕期日期依据</dt><dd>{{ datingBases.find(x => x.value === profile?.dating?.basis)?.label }} · {{ profile.dating.date }}</dd></div>
          </dl>
          <p v-if="profile.source" class="hint">最近来源：{{ profile.source }}</p>
        </template>
      </div>

      <div v-if="selectedActor" class="panel">
        <h3>按故事时间推算</h3>
        <p v-if="!projection || projection.kind === 'unavailable'" class="hint">{{ projection?.reason || '暂无可推算的记录' }}</p>
        <template v-else-if="projection.kind === 'pregnancy'">
          <p class="result">孕 {{ projection.gestationWeeks }} 周 {{ projection.gestationDays }} 天</p>
          <p>预产期约 {{ projection.dueDate }}</p>
          <p class="hint">孕周与预产期是日期估算；剧情中若有更可靠的超声日期，可在下方更新依据。</p>
        </template>
        <template v-else>
          <p class="result">本周期第 {{ projection.cycleDay }} 天</p>
          <p>下次经期预计：{{ projection.nextPeriodStart }}<template v-if="projection.periodEnd"> · 按记录推算经期至 {{ projection.periodEnd }}</template></p>
          <p>可能排卵范围：{{ projection.ovulationFrom }} ～ {{ projection.ovulationTo }}</p>
          <p>可能受孕／“危险期”参考窗口：{{ projection.possibleFertileFrom }} ～ {{ projection.possibleFertileTo }}</p>
          <p class="phase">当前：{{ projection.phase === 'estimated-period' ? '按记录推算的经期' : projection.phase === 'possible-fertile' ? '位于可能受孕窗口' : '日历窗口外，仍不能视作安全避孕' }}</p>
          <p class="hint">排卵范围和风险窗口均为保守日历估算，不表示实际排卵已发生，也不能用于确定某天不会受孕。</p>
        </template>
      </div>

      <details v-if="selectedActor" class="panel editor">
        <summary>手动填写或校正 {{ selectedActor }} 的锚点</summary>
        <p class="hint">保存到最新有效摘要楼层，随聊天同步；删除楼层或切换回复页时按有效叶子重放。自动摘要只记录有正文证据的新变化。</p>
        <div class="form-grid">
          <label>适用生理规则<BbsSelect v-model="draft.cycleType" :options="cycleTypes" aria-label="适用生理规则" /></label>
          <label>周期规律性<BbsSelect v-model="draft.regularity" :options="regularities" aria-label="周期规律性" /></label>
          <label>实际末次经期首日<input v-model="draft.lastPeriodStart" type="date" /></label>
          <label>本人周期长度（天）<input v-model.trim="draft.cycleLengthDays" type="number" min="15" max="60" placeholder="没有记录就留空" /></label>
          <label>通常经期天数<input v-model.trim="draft.periodLengthDays" type="number" min="1" max="10" placeholder="没有记录就留空" /></label>
          <label>孕期状态<BbsSelect v-model="draft.pregnancyStatus" :options="pregnancyStatuses" aria-label="孕期状态" /></label>
          <label v-if="draft.pregnancyStatus === 'confirmed'">孕期日期依据<BbsSelect v-model="draft.datingBasis" :options="datingBases" aria-label="孕期日期依据" /></label>
          <label v-if="draft.pregnancyStatus === 'confirmed' && draft.datingBasis">依据日期<input v-model="draft.datingDate" type="date" /></label>
        </div>
        <p v-if="!derivedMeta.hasLeaf" class="hint">当前聊天还没有有效摘要楼层，暂不能保存手动记录。</p>
        <p v-if="error" class="notice error" role="alert">{{ error }}</p>
        <div class="actions">
          <button class="bbs-btn bbs-btn-primary" type="button" :disabled="!derivedMeta.hasLeaf" @click="save">保存记录</button>
          <button v-if="profile" class="bbs-btn" type="button" :disabled="!derivedMeta.hasLeaf" @click="remove">删除整条记录</button>
        </div>
      </details>

      <details class="panel">
        <summary>计算依据</summary>
        <p class="hint">通常周期可为 21–35 天；这里仅对明确规律、26–32 天的周期使用较保守的标准日法范围。排卵可能在下次经期前约 10–16 天，怀孕日期依据末次月经、明确受孕日或超声确定的预产期计算。</p>
        <ul class="sources">
          <li><a href="https://www.cdc.gov/contraception/hcp/usspr/standard-days-method.html" target="_blank" rel="noopener noreferrer">CDC：标准日法与适用范围</a></li>
          <li><a href="https://www.nhs.uk/conditions/periods/fertility-in-the-menstrual-cycle/" target="_blank" rel="noopener noreferrer">NHS：月经周期与排卵范围</a></li>
          <li><a href="https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date" target="_blank" rel="noopener noreferrer">ACOG：孕周与预产期推定</a></li>
        </ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.reproductive-page { display: grid; gap: 16px; }
header h2 { display: flex; align-items: center; gap: 8px; }
header p, .hint { color: var(--bbs-ink-muted); font-size: 12px; line-height: 1.6; }
header p { margin: 6px 0 0; }
.panel, .notice { min-width: 0; padding: 15px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); background: var(--bbs-surface); }
.notice { border-left: 3px solid var(--bbs-accent); background: var(--bbs-surface-2); }
.notice p { margin: 5px 0 0; color: var(--bbs-ink-muted); font-size: 12px; line-height: 1.6; }
.notice.error { margin-top: 10px; }
.panel h3 { margin: 0 0 10px; font-size: 15px; }
.panel label { display: grid; gap: 6px; font-size: 13px; }
.panel input { width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--bbs-line-strong); border-radius: var(--bbs-radius-sm); background: var(--bbs-bg); color: var(--bbs-ink); font: inherit; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 0; }
.facts div { min-width: 0; }
.facts dt { color: var(--bbs-ink-muted); font-size: 11px; }
.facts dd { margin: 2px 0 0; overflow-wrap: anywhere; font-size: 13px; }
.result { margin: 0 0 10px; font-size: 19px; font-weight: 700; color: var(--bbs-accent); }
.phase { font-weight: 600; }
summary { cursor: pointer; font-size: 13px; font-weight: 600; }
.editor .hint { margin: 12px 0; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.sources { margin: 10px 0 0; padding-left: 20px; font-size: 12px; line-height: 1.8; }
.sources a { color: var(--bbs-accent); }
@media (max-width: 520px) { .form-grid, .facts { grid-template-columns: 1fr; } }
</style>
