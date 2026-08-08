/*
 * 验证用户本轮需求（消息6）：
 *   1) 营业时间新增「24 小时开放」选项（alwaysOpen → 00:00~24:00，全天营业、时间轴不再提示非营业）；
 *   2) 每日营业时间默认「不填」(继承通用营业时间)；添加通用营业时间后每天默认与之相同；
 *      展开后改某天则按该天详情时间为准（effectiveHours 优先级：dailyHours[wd] > 通用）。
 * 用 vm 加载真实 app.js + module-itinerary.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8') +
  '\n;globalThis.ITIN_TYPES = ITIN_TYPES;';

function makeClient() {
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext(ITIN_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

const { app, ctx } = makeClient();
const itin = app.modules.itinerary;

console.log('\n[测试] 24 小时开放（alwaysOpen）');
assert(JSON.stringify(itin.hoursToSegments({ alwaysOpen: true })) === JSON.stringify([{ open: '00:00', close: '24:00' }]),
  'hoursToSegments({alwaysOpen}) 返回 00:00~24:00');
assert(JSON.stringify(itin.effectiveHours({ alwaysOpen: true }, 1)) === JSON.stringify([{ open: '00:00', close: '24:00' }]),
  'effectiveHours 对 24h 地点返回全天时段（任何星期）');
// 24h 地点：任意安排都不应提示「非营业」
assert(itin.outsideHours('23:00', 1, itin.effectiveHours({ alwaysOpen: true }, 1)) === null,
  '24 小时开放：深夜安排也不报「非营业」');
// 24h 优先级低于某天的每日覆盖（改某天则按详情为准）
assert(JSON.stringify(itin.effectiveHours({ alwaysOpen: true, dailyHours: { 5: [{ open: '08:00', close: '12:00' }] } }, 5)) === JSON.stringify([{ open: '08:00', close: '12:00' }]),
  '24h 地点下，某天设了详情时间则按该天为准');

console.log('\n[测试] 每日营业时间默认不填，继承通用；改某天按详情为准');
const gen = { hoursSegments: [{ open: '09:00', close: '18:00' }] };
// 每天默认（dailyHours 为空）→ 沿用通用
assert(JSON.stringify(itin.effectiveHours(gen, 1)) === JSON.stringify([{ open: '09:00', close: '18:00' }]), '周一（未单独设置）沿用通用 09:00~18:00');
assert(JSON.stringify(itin.effectiveHours(gen, 3)) === JSON.stringify([{ open: '09:00', close: '18:00' }]), '周三（未单独设置）沿用通用 09:00~18:00');
// 给周一单独设置 → 周一用详情，其余沿用通用
const mixed = { hoursSegments: [{ open: '09:00', close: '18:00' }], dailyHours: { 1: [{ open: '10:00', close: '20:00' }] } };
assert(JSON.stringify(itin.effectiveHours(mixed, 1)) === JSON.stringify([{ open: '10:00', close: '20:00' }]), '改了周一 → 按周一详情 10:00~20:00');
assert(JSON.stringify(itin.effectiveHours(mixed, 3)) === JSON.stringify([{ open: '09:00', close: '18:00' }]), '未改的周三仍沿用通用 09:00~18:00');

console.log('\n[测试] 表单 UI：24h 开关 + 每日默认「不填」');
const htmlNormal = itin._commonFields({});
assert(htmlNormal.includes('id="t_24h"'), '表单含「24 小时开放」勾选框');
assert(htmlNormal.includes('id="t_hours_body"'), '营业时间分段编辑器包裹在 #t_hours_body');
// 每日营业时间默认「不填」：下拉首项是「— 不填 —」且无时间值被默认 selected
assert(htmlNormal.includes('<option value="">— 不填 —</option>'), '每日营业时间下拉含「— 不填 —」选项');
const dhOpenOpts = htmlNormal.split('t_dh_open')[1] || '';
assert(!/selected/.test(dhOpenOpts.slice(0, dhOpenOpts.indexOf('</select>'))), '每日营业时间（未填时）没有默认选中的时间值（即默认不填）');
// 24h 已勾选时：勾选框 checked，且分段编辑器隐藏
const html24 = itin._commonFields({ alwaysOpen: true });
assert(html24.includes('id="t_24h" checked'), 'alwaysOpen 时 24h 勾选框为 checked');
assert(html24.includes('id="t_hours_body" class="hidden"') || /id="t_hours_body" class="hidden"/.test(html24), 'alwaysOpen 时分段编辑器默认隐藏');

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
