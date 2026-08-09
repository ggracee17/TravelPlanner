/*
 * 回归测试（Message 10）：行程块裁切到时间轴窗口 [6, 24]。
 *   - 完全早于 6 点的块（如 00:10–01:10）不渲染；
 *   - 跨过 6 点的块（如 0:10–12:10）只画窗口内部分，标签显示「6:00–12:10」；
 *   - 跨过 24 点的块（如 20:00–26:00）只画到 24:00，标签显示「20:00–24:00」。
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
const WIN = { start: 6, end: 24 };
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

console.log('\n[测试1] 跨过 6:00 的块（0:10–12:10）只显示 6:00–12:10 这一段');
{
  const s = { id: 'c1', name: 'LongTrip', type: 'spot', startTime: '00:10', durationH: 12, ticket: 0, reservation: '', hoursSegments: [] };
  const html = itin.renderBlock(s, { id: 'd', date: '2026-08-09' }, WIN, null);
  const g = blockGeom(html);
  assert(g && Math.abs(g.top - 0) < 1e-6, `顶部对齐窗口起点（top=${g && g.top}，应为 0）`);
  // 可见 6:00–12:10 ≈ 6.1667h → 6.1667 * 48 ≈ 296px
  assert(g && Math.abs(g.height - (12 + 1/6 - 6) * HPX) < 1.5, `高度约为可见段 6.17h * ${HPX}px（height=${g && g.height}）`);
  const t = blockTime(html);
  assert(t === '06:00–12:10 · 12h', `时间标签显示裁切后范围「6:00–12:10 · 12h」（实际：${t}）`);
}

console.log('\n[测试2] 完全早于 6:00 的块（00:10–01:10）不渲染在行程表');
{
  const early = { id: 'e1', name: 'RedEye', type: 'spot', startTime: '00:10', durationH: 1, ticket: 0, reservation: '', hoursSegments: [] };
  const mid = { id: 'm1', name: 'Museum', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd', date: '2026-08-09', spots: [early, mid] };
  const html = itin.renderDayColumn(day, 0, { id: 'x' }, false);
  assert(!html.includes('e1'), '凌晨块(00:10–01:10) 不出现在行程表 HTML 中');
  assert(html.includes('m1'), '白天块(09:00) 正常出现');
  // 行程块计数应排除被隐藏的凌晨块：只剩 1 个
  const n = (html.match(/class="tl-block /g) || []).length;
  assert(n === 1, `行程块数量=1（已排除被隐藏的凌晨块，实际=${n}）`);
}

console.log('\n[测试3] 跨过 24:00 的块（20:00–26:00）只显示到 24:00');
{
  const s = { id: 'c2', name: 'NightTrip', type: 'spot', startTime: '20:00', durationH: 6, ticket: 0, reservation: '', hoursSegments: [] };
  const html = itin.renderBlock(s, { id: 'd', date: '2026-08-09' }, WIN, null);
  const g = blockGeom(html);
  // 可见 20:00–24:00 → top = 14*48 = 672, height = 4*48 = 192
  assert(g && Math.abs(g.top - (20 - 6) * HPX) < 1e-6, `顶部对齐 20:00（top=${g && g.top}，应为 ${(20 - 6) * HPX}）`);
  assert(g && Math.abs(g.height - 4 * HPX) < 1.5, `高度约为可见段 4h * ${HPX}px（height=${g && g.height}）`);
  const t = blockTime(html);
  assert(t === '20:00–24:00 · 6h', `时间标签显示裁切后范围「20:00–24:00 · 6h」（实际：${t}）`);
}

console.log('\n[测试4] 完全落在窗口内的块（09:00–11:00）保持原始终止时间');
{
  const s = { id: 'c3', name: 'Museum', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', hoursSegments: [] };
  const html = itin.renderBlock(s, { id: 'd', date: '2026-08-09' }, WIN, null);
  const g = blockGeom(html);
  assert(g && Math.abs(g.top - (9 - 6) * HPX) < 1e-6, `顶部对齐 9:00（top=${g && g.top}）`);
  assert(g && Math.abs(g.height - 2 * HPX) < 1.5, `高度=2h * ${HPX}px（height=${g && g.height}）`);
  const t = blockTime(html);
  assert(t === '09:00–11:00 · 2h', `时间标签保持原始终止时间「09:00–11:00 · 2h」（实际：${t}）`);
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
