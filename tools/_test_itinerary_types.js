/*
 * 验证本批改动：
 *   1) itinDateLabel 紧凑视图隐藏年份（MM-DD），普通视图显示完整 YYYY-MM-DD；
 *   2) 行程块分类新增 娱乐/拍照/甜品/小吃（ITIN_TYPES + 中英映射）。
 * 用 vm 加载真实 app.js + module-itinerary.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
// 把 module-itinerary.js 顶层的 const（ITIN_TYPES 等）暴露到 globalThis，便于断言
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8') +
  '\n;globalThis.ITIN_TYPES = ITIN_TYPES; globalThis.CN_TO_ITIN_KEY = CN_TO_ITIN_KEY; globalThis.ITIN_KEY_TO_CN = ITIN_KEY_TO_CN;';

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

console.log('\n[测试] itinDateLabel 紧凑视图隐藏年份');
// 普通视图（默认）= 完整日期
delete app.state.itineraryZoom;
assert(ctx.itinDateLabel('2026-08-09') === '2026-08-09', '普通视图显示完整 YYYY-MM-DD');
assert(ctx.itinDateLabel(null) === '未填日期', '空日期回退「未填日期」');
assert(ctx.itinDateLabel('') === '未填日期', '空串回退「未填日期」');
// 紧凑视图 = 仅 MM-DD
app.state.itineraryZoom = 'compact';
assert(ctx.itinDateLabel('2026-08-09') === '08-09', '紧凑视图隐藏年份 → 08-09');
assert(ctx.itinDateLabel('2025-12-31') === '12-31', '紧凑视图跨年 → 12-31（不含年份）');
app.state.itineraryZoom = 'normal';
assert(ctx.itinDateLabel('2026-08-09') === '2026-08-09', '切回普通视图恢复完整日期');

console.log('\n[测试] 行程块分类新增 娱乐/拍照/甜品/小吃');
const T = ctx.ITIN_TYPES;
['entertainment', 'photo', 'dessert', 'snack'].forEach(k => {
  assert(T[k] && T[k].label && T[k].cls, `ITIN_TYPES 含 ${k}（label=${T[k] && T[k].label}）`);
});
assert(T.entertainment.label === '娱乐' && T.photo.label === '拍照' && T.dessert.label === '甜品' && T.snack.label === '小吃', '四个新分类中文标签正确');
// 中英映射双向一致
assert(ctx.CN_TO_ITIN_KEY['娱乐'] === 'entertainment' && ctx.CN_TO_ITIN_KEY['拍照'] === 'photo' && ctx.CN_TO_ITIN_KEY['甜品'] === 'dessert' && ctx.CN_TO_ITIN_KEY['小吃'] === 'snack', 'CN_TO_ITIN_KEY 含四个新分类');
assert(ctx.ITIN_KEY_TO_CN['entertainment'] === '娱乐' && ctx.ITIN_KEY_TO_CN['snack'] === '小吃', 'ITIN_KEY_TO_CN 含四个新分类（双向一致）');

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
