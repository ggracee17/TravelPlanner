/*
 * 回归测试（Message 10 / 本轮）：行程块在完整 00:00–24:00 时间轴上渲染。
 *   - 完整 0–24 时间轴：所有行程（含 6 点以前的凌晨行程）都渲染并可拖动；
 *   - 跨过 24:00 的块（如 20:00–26:00）只画到 24:00，标签显示「20:00–24:00」；
 *   - 完全落在窗口内的块保持原始终止时间。
 * 用 vm 加载真实 app.js + module-itinerary.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');

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
const WIN = { start: 0, end: 24 };
const HPX = ctx.itinHourPx(); // 'normal' → 48

function blockGeom(html) {
  // 取第一个 .tl-block 的 top / height
  const m = html.match(/class="tl-block[^"]*"[^>]*style="top:([\d.]+)px;height:([\d.]+)px;/);
  return m ? { top: parseFloat(m[1]), height: parseFloat(m[2]) } : null;
}
function blockTime(html) {
  const m = html.match(/tl-block-time">([^<]+)</);
  return m ? m[1] : null;
}

console.log('\n[测试1] 完整 0–24 时间轴：0:10–12:10 的块完整渲染（不再裁切到 6:00）');
{
  const s = { id: 'c1', name: 'LongTrip', type: 'spot', startTime: '00:10', durationH: 12, ticket: 0, reservation: '', hoursSegments: [] };
  const html = itin.renderBlock(s, { id: 'd', date: '2026-08-09' }, WIN, null);
  const g = blockGeom(html);
  assert(g && Math.abs(g.top - (1 / 6) * HPX) < 1e-6, `顶部对齐开始时间 0:10（top=${g && g.top}，应为 ${(1 / 6) * HPX}）`);
  assert(g && Math.abs(g.height - 12 * HPX) < 1.5, `高度约为整段 12h * ${HPX}px（height=${g && g.height}）`);
  const t = blockTime(html);
  assert(t === '00:10–12:10 · 12h', `时间标签显示完整范围「00:10–12:10 · 12h」（实际：${t}）`);
}

console.log('\n[测试2] 完全早于 6:00 的块（00:10–01:10）也渲染在行程表（可拖动，不再隐藏）');
{
  const early = { id: 'e1', name: 'RedEye', type: 'spot', startTime: '00:10', durationH: 1, ticket: 0, reservation: '', hoursSegments: [] };
  const mid = { id: 'm1', name: 'Museum', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd', date: '2026-08-09', spots: [early, mid] };
  const html = itin.renderDayColumn(day, 0, { id: 'x' }, false);
  assert(html.includes('e1'), '凌晨块(00:10–01:10) 出现在行程表 HTML 中（修复「6 点前无法移动」）');
  assert(html.includes('m1'), '白天块(09:00) 正常出现');
  // 行程块计数应包含凌晨块：共 2 个
  const n = (html.match(/class="tl-block /g) || []).length;
  assert(n === 2, `行程块数量=2（凌晨块也参与渲染，实际=${n}）`);
}

console.log('\n[测试3] 跨过 24:00 的块（20:00–26:00）只显示到 24:00');
{
  const s = { id: 'c2', name: 'NightTrip', type: 'spot', startTime: '20:00', durationH: 6, ticket: 0, reservation: '', hoursSegments: [] };
  const html = itin.renderBlock(s, { id: 'd', date: '2026-08-09' }, WIN, null);
  const g = blockGeom(html);
  // 可见 20:00–24:00 → top = 20*48 = 960, height = 4*48 = 192
  assert(g && Math.abs(g.top - 20 * HPX) < 1e-6, `顶部对齐 20:00（top=${g && g.top}，应为 ${20 * HPX}）`);
  assert(g && Math.abs(g.height - 4 * HPX) < 1.5, `高度约为可见段 4h * ${HPX}px（height=${g && g.height}）`);
  const t = blockTime(html);
  assert(t === '20:00–24:00 · 6h', `时间标签显示裁切后范围「20:00–24:00 · 6h」（实际：${t}）`);
}

console.log('\n[测试4] 完全落在窗口内的块（09:00–11:00）保持原始终止时间');
{
  const s = { id: 'c3', name: 'Museum', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', hoursSegments: [] };
  const html = itin.renderBlock(s, { id: 'd', date: '2026-08-09' }, WIN, null);
  const g = blockGeom(html);
  assert(g && Math.abs(g.top - 9 * HPX) < 1e-6, `顶部对齐 9:00（top=${g && g.top}）`);
  assert(g && Math.abs(g.height - 2 * HPX) < 1.5, `高度=2h * ${HPX}px（height=${g && g.height}）`);
  const t = blockTime(html);
  assert(t === '09:00–11:00 · 2h', `时间标签保持原始终止时间「09:00–11:00 · 2h」（实际：${t}）`);
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
