/*
 * 验证两个修复：
 *   1) 早于 06:00 的行程块（如 12:10am=00:10）在时间轴上的窗口/位置不再被错钳到 6:00；
 *   2) 时间选择菜单改为 24 小时制（itinTimeOptions 支持任意分钟档，start/end 用 5 分钟档）。
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

console.log('\n[测试A] 早于 06:00 的行程块：时间轴窗口不再钳到 6:00');
{
  const earlySpot = { id: 'sp1', name: 'Hotel', type: 'hotel', startTime: '00:10', endTime: '12:10', durationH: 12, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd1', spots: [earlySpot] };

  const wCollapsed = itin.dayWindow(day, false);
  assert(wCollapsed.start === 0, '折叠模式：窗口起点应为 0（含 00:10），而非 6');
  assert(wCollapsed.end >= 13, '折叠模式：窗口终点应覆盖到块结束之后');

  const wExpanded = itin.dayWindow(day, true);
  assert(wExpanded.start === 0, '展开模式：窗口起点应为 0（含 00:10），而非 6');

  // 位置计算：top 应反映真实时间（00:10 → 约 8px），而不是被钳到 0（即 6:00 处）
  const html = itin.renderBlock(earlySpot, day, wCollapsed, null);
  const m = html.match(/top:([\d.]+)px/);
  const top = m ? parseFloat(m[1]) : -1;
  assert(top > 0 && top < 48, `00:10 块 top≈8px（top=${top}），未被钳到 6:00 位置`);
  assert(html.includes('00:10') && html.includes('12:10'), '块标签显示真实时间 00:10–12:10（而非 6:00–18:00）');
}

console.log('\n[测试B] 普通白天行程：行为不变（窗口仍为实际段，展开仍 6–24）');
{
  const daySpot = { id: 'sp2', name: 'Museum', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd2', spots: [daySpot] };
  const wC = itin.dayWindow(day, false);
  assert(wC.start === 9 && wC.end === 11, '折叠：窗口为 9–11（与修复前一致）');
  const wE = itin.dayWindow(day, true);
  assert(wE.start === 6 && wE.end === 24, '展开：窗口为 6–24（与修复前一致）');
}

console.log('\n[测试C] 时间菜单 24 小时制');
{
  const opts = itin.itinTimeOptions('12:10', 5);
  assert(/<option value="12:10" selected/.test(opts), '5 分钟档含 12:10 且被选中');
  assert(/<option value="00:10"/.test(opts), '5 分钟档含 00:10（支持 12:10am 录入）');
  assert(/<option value="23:55"/.test(opts), '5 分钟档覆盖到 23:55');
  // 营业时间默认 30 分钟档仍可用
  const opts30 = itin.itinTimeOptions('09:00');
  assert(/<option value="09:00" selected/.test(opts30) && /<option value="09:30"/.test(opts30) && !/09:10/.test(opts30), '默认 30 分钟档（营业时间）保持，且不含 09:10');
  // itinTimeToNum 解析 24 小时串
  assert(Math.abs(ctx.itinTimeToNum('00:10') - (1/6)) < 1e-6, 'itinTimeToNum("00:10") = 1/6 小时');
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
