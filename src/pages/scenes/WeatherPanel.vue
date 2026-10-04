<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import BbsSelect from '@/components/BbsSelect.vue';
import ModalMask from '@/components/ModalMask.vue';
import { engineActiveHere } from '@/api/settings';
import { derivedMeta } from '@/memory/store';
import { WEATHER_GROUPS, WEATHER_OPTIONS, currentWeather, normalizeWeatherValue, weatherDue, weatherLabel, weatherTemperatureLabel, type WeatherValue } from '@/weather/model';
import { cancelWeather, chooseWeather, getWeatherCalendar, getWeatherMoment, updateCurrentTemperature, updateWeather, weather } from '@/weather/store';

const expanded = ref(true);
const enabled = computed({ get: () => weather.data.enabled, set: value => {
  if (updateWeather({ enabled: value }) && value && weather.data.mode === 'auto' && !weather.data.current) void chooseWeather();
} });
const mode = computed({ get: () => weather.data.mode, set: (value: 'auto' | 'manual') => {
  if (updateWeather({ mode: value }) && value === 'auto' && weather.data.enabled && !weather.data.current) void chooseWeather();
} });
const interval = computed({ get: () => String(weather.data.intervalHours), set: value => { updateWeather({ intervalHours: Number(value) as 3 | 6 | 12 }); } });
const activeHere = computed(() => engineActiveHere());
const current = computed(() => currentWeather(weather.data));
const moment = computed(() => { void derivedMeta.rev; void weather.revision; return getWeatherMoment(); });
const calendar = computed(() => { void derivedMeta.rev; void weather.revision; return getWeatherCalendar(); });
const nextUpdate = computed(() => {
  if (!weather.data.enabled) return '未开启';
  if (weather.data.mode === 'manual') return '手动固定，等待你重新选择';
  if (!weather.data.current) return '首次选择待完成';
  if (weatherDue(weather.data, moment.value, calendar.value)) return '已到期，下次正文／推演前选择新天气和温度';
  const left = Math.max(0, weather.data.intervalHours * 60 - (moment.value.minutes - weather.data.current.minute));
  return `再推进约${Math.round(left / 60 * 10) / 10}故事小时后更新`;
});
const climateDraft = ref(weather.data.climate);
watch(() => weather.data.climate, value => { climateDraft.value = value; });
const manualOpen = ref(false);
const temperatureOpen = ref(false);
const temperatureDraft = ref('');
const group = ref<string>('天空');
const fixedDraft = ref<WeatherValue>(normalizeWeatherValue(weather.data.manual));
const groupedOptions = computed(() => WEATHER_OPTIONS.filter(o => o.group === group.value));
const canSaveFixed = computed(() => !!weatherLabel(fixedDraft.value)
  && (fixedDraft.value.temperatureC === undefined || (Number.isFinite(fixedDraft.value.temperatureC)
    && fixedDraft.value.temperatureC >= -100 && fixedDraft.value.temperatureC <= 70)));
const canSaveTemperature = computed(() => temperatureDraft.value.trim() === ''
  || (Number.isFinite(Number(temperatureDraft.value)) && Number(temperatureDraft.value) >= -100 && Number(temperatureDraft.value) <= 70));
watch(() => weather.chatKey, () => { manualOpen.value = false; temperatureOpen.value = false; climateDraft.value = weather.data.climate; });
function openFixed(): void { fixedDraft.value = normalizeWeatherValue(weather.data.manual); manualOpen.value = true; }
function openTemperature(): void {
  temperatureDraft.value = current.value?.temperatureC === undefined ? '' : String(current.value.temperatureC);
  temperatureOpen.value = true;
}
function saveTemperature(): void {
  if (!canSaveTemperature.value) return;
  const value = temperatureDraft.value.trim() === '' ? undefined : Number(temperatureDraft.value);
  if (updateCurrentTemperature(value)) temperatureOpen.value = false;
}
function toggle(id: string): void {
  const selected = fixedDraft.value.conditions;
  fixedDraft.value.conditions = selected.includes(id) ? selected.filter(x => x !== id) : selected.length < 6 ? [...selected, id] : selected;
}
function setFixedTemperature(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  if (!value) delete fixedDraft.value.temperatureC;
  else fixedDraft.value.temperatureC = Number(value);
}
function saveFixed(): void {
  if (!canSaveFixed.value) return;
  if (updateWeather({ manual: fixedDraft.value, mode: 'manual', enabled: true })) manualOpen.value = false;
}
function saveClimate(): void { updateWeather({ climate: climateDraft.value }); }
</script>

<template>
  <section class="weather-card" aria-label="天气">
    <header class="weather-head">
      <button class="weather-fold" type="button" :aria-expanded="expanded" @click="expanded = !expanded"><Icon name="weather" /><strong>天气</strong><Icon name="chevron" :class="{ collapsed: !expanded }" /></button>
      <label class="weather-check"><input v-model="enabled" type="checkbox" :disabled="!weather.available" />开启</label>
    </header>
    <div v-if="expanded" class="weather-body">
      <p v-if="!weather.available" class="weather-hint">先打开一个聊天，即可设置天气。</p>
      <div class="weather-now"><strong>{{ current ? weatherLabel(current) : weather.data.enabled ? '等待 AI 选择天气' : '天气控制未开启' }}</strong><p v-if="current?.description">{{ current.description }}</p></div>
      <div class="weather-row"><span>室外温度</span><div class="weather-temperature"><strong>{{ current ? weatherTemperatureLabel(current) || '未记录' : weather.data.enabled ? '等待天气选择' : '未开启' }}</strong><button v-if="current" type="button" class="bbs-btn" :disabled="weather.busy" @click="openTemperature">设置</button></div></div>
      <p v-if="mode === 'auto'" class="weather-hint">月份依据：{{ calendar ? `${calendar.source} · ${calendar.month ? `${calendar.month}月` : calendar.season ? `${calendar.season}季` : '未明确'}` : '正文暂无明确月份' }}。AI 会结合地点、季节和故事时间估计温度。</p>
      <p v-if="current && !weatherTemperatureLabel(current) && mode === 'auto'" class="weather-hint">当前温度未记录；下次正文或推演前会由 AI 补充，也可手动设置。</p>
      <div class="weather-row"><span>天气模式</span><BbsSelect v-model="mode" :options="[{ value: 'auto', label: 'AI 随机天气' }, { value: 'manual', label: '手动固定天气' }]" aria-label="天气模式" /></div>
      <div v-if="mode === 'auto'" class="weather-row"><span>变换间隔</span><BbsSelect v-model="interval" :options="[{ value: '3', label: '3 故事小时' }, { value: '6', label: '6 故事小时（默认）' }, { value: '12', label: '12 故事小时' }]" aria-label="天气变换间隔" /></div>
      <p class="weather-hint"><strong>下次更新：</strong>{{ nextUpdate }}<br />{{ mode === 'auto' ? '按剧情中的时间计时；状态栏月份变化时也会更新。AI 每次重新估计天气和温度。' : '所选天气持续固定，只有你重新选择或切换模式才改变。' }}</p>
      <p v-if="mode === 'auto' && !moment.clock" class="weather-hint">故事日期暂无法计算；仍可读取状态栏月份变化，或由摘要中明确经过的时长计时。</p>
      <div v-if="mode === 'auto'" class="weather-actions">
        <button class="bbs-btn" type="button" :disabled="!weather.available || !weather.data.enabled || weather.busy || !activeHere" @click="chooseWeather(true)">{{ weather.busy ? 'AI 选择中…' : current ? 'AI 立即换天气' : 'AI 选择天气' }}</button>
        <button v-if="weather.busy" class="bbs-btn" type="button" @click="cancelWeather">取消</button>
      </div>
      <button v-else class="bbs-btn" type="button" :disabled="!weather.available" @click="openFixed">选择固定天气</button>
      <p v-if="weather.error" class="weather-error" role="alert">{{ weather.error }}{{ current ? '；当前天气已保留。' : '' }}</p>
      <p v-if="weather.data.enabled && !activeHere" class="weather-hint">柏宝书总开关关闭或当前角色被排除，天气暂不发送给模型。</p>
      <details class="weather-details"><summary>气候设定与选择记录</summary>
        <label class="weather-field"><span>气候／环境补充（可选）</span><textarea v-model="climateDraft" class="bbs-input" rows="2" maxlength="400" placeholder="例如：沿海城市，秋季；或架空世界的特殊气候" /></label>
        <button class="bbs-btn" type="button" :disabled="!weather.available || climateDraft === weather.data.climate" @click="saveClimate">保存气候设定</button>
        <p class="weather-hint">AI沿用摘要 API 渠道，在首次、到期、状态栏月份变化或主动更换时调用。设置随聊天保存。天气控制会发送给正文与推演，独立于记忆注入分项。</p>
        <ol v-if="weather.data.history.length" class="weather-history"><li v-for="(record, i) in [...weather.data.history].reverse()" :key="i"><small>{{ record.time || '故事时间未明确' }}</small><strong>{{ weatherLabel(record.value) }}<span v-if="weatherTemperatureLabel(record.value)"> · {{ weatherTemperatureLabel(record.value) }}</span></strong><p v-if="record.transition">{{ record.transition }}</p></li></ol>
      </details>
    </div>
  </section>
  <ModalMask :open="manualOpen" @close="manualOpen = false">
    <div class="bbs-modal weather-modal" role="dialog" aria-modal="true" aria-label="选择固定天气">
      <header class="bbs-modal-head"><strong class="bbs-modal-title">选择固定天气</strong><button class="bbs-item-act" type="button" title="关闭" @click="manualOpen = false"><Icon name="close" /></button></header>
      <p class="weather-hint">可选择最多6项组成一种固定天气，也可补充自定义天气和室外温度。保存后持续固定。</p>
      <BbsSelect v-model="group" :options="WEATHER_GROUPS.map(value => ({ value, label: value }))" aria-label="天气分类" />
      <div class="weather-options"><label v-for="option in groupedOptions" :key="option.value" class="weather-option" :class="{ selected: fixedDraft.conditions.includes(option.value) }"><input type="checkbox" :checked="fixedDraft.conditions.includes(option.value)" :disabled="fixedDraft.conditions.length >= 6 && !fixedDraft.conditions.includes(option.value)" @change="toggle(option.value)" />{{ option.label }}</label></div>
      <div class="weather-selected"><span>已选：</span><button v-for="id in fixedDraft.conditions" :key="id" type="button" @click="toggle(id)">{{ WEATHER_OPTIONS.find(o => o.value === id)?.label }} ×</button><span v-if="!fixedDraft.conditions.length">无预设天气</span></div>
      <label class="weather-field"><span>自定义／其他天气（可选）</span><input v-model="fixedDraft.custom" class="bbs-input" type="text" maxlength="120" placeholder="用于补充未列出的天气或特殊组合" /></label>
      <label class="weather-field"><span>室外温度（℃，可选）</span><input :value="fixedDraft.temperatureC ?? ''" class="bbs-input" type="number" min="-100" max="70" step="0.1" placeholder="例如：18" @input="setFixedTemperature" /></label>
      <label class="weather-field"><span>具体表现（可选）</span><textarea v-model="fixedDraft.description" class="bbs-input" rows="2" maxlength="600" placeholder="例如：细雨伴微风，地面湿润，能见度稍低" /></label>
      <footer class="weather-actions"><button class="bbs-btn" type="button" @click="manualOpen = false">取消</button><button class="bbs-btn bbs-btn-primary" type="button" :disabled="!canSaveFixed || !weather.available" @click="saveFixed">保存并固定</button></footer>
    </div>
  </ModalMask>
  <ModalMask :open="temperatureOpen" @close="temperatureOpen = false">
    <div class="bbs-modal weather-modal" role="dialog" aria-modal="true" aria-label="设置室外温度">
      <header class="bbs-modal-head"><strong class="bbs-modal-title">设置当前室外温度</strong><button class="bbs-item-act" type="button" title="关闭" @click="temperatureOpen = false"><Icon name="close" /></button></header>
      <p class="weather-hint">只修改当前这次天气的温度，不改变天气类型。留空并保存可清除温度；AI 下次换天气时会重新估计。</p>
      <label class="weather-field"><span>温度（℃，-100 至 70）</span><input v-model="temperatureDraft" class="bbs-input" type="number" min="-100" max="70" step="0.1" placeholder="例如：18" /></label>
      <footer class="weather-actions"><button class="bbs-btn" type="button" @click="temperatureOpen = false">取消</button><button class="bbs-btn bbs-btn-primary" type="button" :disabled="!canSaveTemperature" @click="saveTemperature">保存温度</button></footer>
    </div>
  </ModalMask>
</template>

<style scoped>
.weather-card { padding: 14px; margin-bottom: 22px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius); background: var(--bbs-surface); }
.weather-head, .weather-fold, .weather-check, .weather-actions { display: flex; align-items: center; gap: 8px; }
.weather-head { justify-content: space-between; }
.weather-fold { padding: 0; border: 0; background: none; font-size: 15px; color: var(--bbs-ink); cursor: pointer; }
.weather-fold > :last-child { width: 14px; }
.weather-fold .collapsed { transform: rotate(-90deg); }
.weather-check { font-size: 12px; }
.weather-body, .weather-modal { display: flex; flex-direction: column; gap: 12px; }
.weather-body { margin-top: 14px; }
.weather-now { padding: 12px; border-radius: var(--bbs-radius-sm); background: var(--bbs-accent-soft); color: var(--bbs-accent); overflow-wrap: anywhere; }
.weather-now p { color: var(--bbs-ink-soft); margin: 7px 0 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; }
.weather-row { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 12px; font-size: 12px; }
.weather-temperature { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.weather-temperature strong { font-size: 13px; color: var(--bbs-ink); }
.weather-temperature .bbs-btn { flex: 0 0 auto; padding: 5px 10px; font-size: 12px; }
.weather-hint { margin: 0; font-size: 11.5px; color: var(--bbs-ink-muted); line-height: 1.8; }
.weather-error { margin: 0; font-size: 12px; color: var(--bbs-danger); overflow-wrap: anywhere; }
.weather-details { border-top: 1px solid var(--bbs-line); padding-top: 12px; }
.weather-details summary { cursor: pointer; font-size: 12px; color: var(--bbs-ink-soft); }
.weather-details[open] > :not(summary) { margin-top: 12px; }
.weather-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.weather-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.weather-option { display: flex; align-items: center; gap: 7px; padding: 9px; font-size: 12px; border: 1px solid var(--bbs-line); border-radius: var(--bbs-radius-sm); cursor: pointer; }
.weather-option.selected { border-color: var(--bbs-accent); background: var(--bbs-accent-soft); }
.weather-selected { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.weather-selected button { font: inherit; padding: 4px 7px; border-radius: 6px; border: 1px solid var(--bbs-line); background: var(--bbs-surface-2); color: var(--bbs-ink); cursor: pointer; }
.weather-history { list-style: none; padding: 0 0 0 12px; margin: 0; border-left: 1px solid var(--bbs-line); max-height: 260px; overflow-y: auto; }
.weather-history li { margin-bottom: 14px; display: grid; gap: 5px; }
.weather-history small { font-size: 11px; color: var(--bbs-ink-muted); }
.weather-history strong { font-size: 12px; }
.weather-history p { margin: 0; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
</style>
