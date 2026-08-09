/*
 * 验证用户本轮 2 项需求（消息8）：
 *   1) 选择「24 小时开放」后，详情里每日营业时间也变成「每天 00:00~24:00（全天）」并锁定；
 *      保存后候选的 dailyHours 覆盖全部 7 天且均为全天。
 *   2) 修复 bug：行程库已加入某天的候选（如清晨航班 台北→珀斯），在行程表里不显示。
 *      根因：renderDayColumn 曾把 6 点以前开始的行程块整体过滤掉；改为照常渲染（仅在时间轴顶部对齐）。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-candidates.js + module-i18n.js，桩掉 DOM。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
const CAND_SRC = fs.readFileSync(path.join(ROOT, 'module-candidates.js'), 'utf8');
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'module-i18n.js'), 'utf8');

function makeClient() {
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener: () => {}
  };
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null, I18N: undefined },
    document,
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;', ctx);
  vm.runInContext(ITIN_SRC, ctx);
  vm.runInContext(CAND_SRC, ctx);
  vm.runInContext(I18N_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.renderAll = () => {};
  app.closeModal = () => {};
  app.toast = () => {};
  app.saveState = () => {};
  return { app, ctx, document };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

const { app, ctx, document } = makeClient();
const itin = app.modules.itinerary;

function setup() {
  app.state.destinations = [{ id: 'd1', name: '测试目的地', startDate: '2026-08-01', endDate: '2026-08-03' }];
  app.state.activeDestinationId = 'd1';
  app.state.d1 = { itinerary: [{ id: 'day1', date: '2026-08-01', spots: [] }] };
  app.state.candidates = [];
}

/* ===== 1) 24 小时开放 → 每日营业时间也变成全天 ===== */
console.log('\n[测试] 24 小时开放：详情每日时间段也变成「每天 00:00~24:00」');
const html24 = itin._commonFields({ name: 'X', type: 'restaurant', alwaysOpen: true, dailyHours: {} });
assert(/id="t_24h"[^>]*checked/.test(html24), '表单中「24 小时开放」勾选框为勾选状态');
assert(html24.includes('class="t_dh_close" value="24:00"') && html24.includes('value="24" selected'), '每日营业时间的「结束」默认 24:00（小时段选 24，隐藏输入 24:00）');
assert((html24.match(/disabled/g) || []).length >= 14, '每日 7 行时间框均被禁用（锁定为全天）');
assert(html24.includes('每天均按 <strong>00:00~24:00（全天）</strong>'), '显示「每天 00:00~24:00 全天」提示');

const htmlNormal = itin._commonFields({ name: 'Y', type: 'restaurant', alwaysOpen: false, dailyHours: {} });
assert(!htmlNormal.includes('value="24:00" selected'), '普通（非 24h）时每日结束不默认 24:00');
assert(!/t_dh_open flex-1" disabled/.test(htmlNormal), '普通时每日时间框可编辑（未禁用）');

/* ===== 2) 保存「24 小时开放」后，dailyHours 覆盖 7 天且均为全天 ===== */
console.log('\n[测试] 保存 24 小时开放：dailyHours 覆盖全部 7 天且每天 00:00~24:00');
setup();
function el(v, checked) { return { value: v == null ? '' : v, checked: !!checked, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [] }; }
const WD = [1, 2, 3, 4, 5, 6, 0];
const formEls = {
  t_name: el('台北夜市'), t_type: el('restaurant'), t_dur: el('2'),
  t_map: el(''), t_img: el(''), t_note: el(''),
  t_24h: el('', true),            // 勾选 24 小时开放
  t_start: el('09:00'), t_end: el(''),
  t_ticket: el('0'), t_resv: el(''), t_day: el('day1')
};
ctx.document.getElementById = (id) => formEls[id] || null;
ctx.document.querySelectorAll = (sel) => {
  if (sel.indexOf('t_hours_segs') >= 0) return [];
  if (sel.indexOf('t_closed') >= 0) return [];
  if (sel.indexOf('t_daily_hours') >= 0) {
    return WD.map(wd => ({
      dataset: { dh: String(wd) },
      querySelector: (cls) => cls.indexOf('open') >= 0 ? { value: '00:00' } : { value: '24:00' }
    }));
  }
  return [];
};
app.state.candidates = [{ id: 'c1', name: '台北夜市', type: '餐饮', checked: false, preferredDayId: '' }];
itin.saveTrip('cand', 'c1', '');
const cand = app.state.candidates[0];
assert(cand.alwaysOpen === true, '保存后候选 alwaysOpen = true');
assert(cand.dailyHours && Object.keys(cand.dailyHours).length === 7, '保存后 dailyHours 含全部 7 天');
const all24 = WD.every(wd => cand.dailyHours[wd] && cand.dailyHours[wd][0] && cand.dailyHours[wd][0].open === '00:00' && cand.dailyHours[wd][0].close === '24:00');
assert(all24, '每天营业时间均为 00:00~24:00（全天）');
assert(cand.checked === true && app.state.d1.itinerary[0].spots.length === 1, '候选已加入 day1 且行程块进入行程表');

/* ===== 3) 修复 bug：清晨航班（startTime < 6:00）也出现在行程表 ===== */
console.log('\n[测试] 修复：6 点前开始的行程块不再被隐藏');
setup();
const dest = { id: 'd1', name: '台北', startDate: '2026-08-01' };
const day = {
  id: 'day1', date: '2026-08-01', weather: '晴',
  spots: [
    { id: 'spEarly', type: 'transport', name: '台北→珀斯 航班', startTime: '05:00', durationH: 6, ticket: 0, reservation: '' },
    { id: 'spNoon', type: 'spot', name: '下午自由活动', startTime: '14:00', durationH: 2, ticket: 0, reservation: '' }
  ]
};
const colHtml = itin.renderDayColumn(day, 0, dest, false);
assert(colHtml.includes('台北→珀斯 航班'), '清晨航班（05:00）出现在行程表渲染中');
assert(colHtml.includes('下午自由活动'), '普通行程块正常渲染');
assert((colHtml.match(/class="tl-block /g) || []).length === 2, '两张行程块均渲染（清晨航班不再被过滤成 1 个）');

/* ===== 4) 修复 bug：24 小时开放（00:00~24:00）的跨午夜夜间行程不再误报「非营业」 ===== */
console.log('\n[测试] 24 小时开放：跨午夜夜间行程不误报非营业（如「台北到悉尼」夜间航班）');
// 显式全天营业段：白天普通行程
assert(itin.outsideHours('09:00', 2, [{ open: '00:00', close: '24:00' }]) === null, '24h 开放·白天行程 → 无经营时间警告');
// 跨午夜夜间行程（22:00 出发、10h 到次日 08:00）：此前因 en>24 被误判为非营业
assert(itin.outsideHours('22:00', 10, [{ open: '00:00', close: '24:00' }]) === null, '24h 开放·跨午夜夜间行程 → 仍无警告（修复点）');
// 等价写法 00:00~00:00（午夜到午夜）也视为全天
assert(itin.outsideHours('23:30', 1, [{ open: '00:00', close: '00:00' }]) === null, '00:00~00:00 视为全天营业 → 无警告');
// 普通营业时间 09:00~18:00：夜间行程仍应正常警告（对照，确保未过度放宽）
assert(itin.outsideHours('22:00', 2, [{ open: '09:00', close: '18:00' }]) !== null, '普通 09~18 营业·夜间行程 → 正常提示非营业');
// alwaysOpen 标记（经 effectiveHours 取值）同样覆盖跨午夜
const aoSpot = { name: '台北到悉尼', alwaysOpen: true, dailyHours: {} };
assert(itin.outsideHours('22:00', 10, itin.effectiveHours(aoSpot, 6)) === null, 'alwaysOpen 标记·跨午夜行程 → 无警告');

console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
process.exit(failed ? 1 : 0);
