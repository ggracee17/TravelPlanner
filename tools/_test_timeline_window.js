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

console.log('\n[测试A] 时间轴固定 06:00–24:00（每天等长；早于 6 点的行程照常画在行程表，顶部对齐）');
{
  const earlySpot = { id: 'sp1', name: 'Hotel', type: 'hotel', startTime: '00:10', endTime: '12:10', durationH: 12, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd1', spots: [earlySpot] };

  const wCollapsed = itin.dayWindow(day, false);
  assert(wCollapsed.start === 6 && wCollapsed.end === 24, '折叠：窗口固定 6–24（不再起点 0）');
  const wExpanded = itin.dayWindow(day, true);
  assert(wExpanded.start === 6 && wExpanded.end === 24, '展开：窗口固定 6–24');

  // 空日程也保持同样长度
  const empty = itin.dayWindow({ id: 'd0', spots: [] }, false);
  assert(empty.start === 6 && empty.end === 24, '空日程：窗口仍为 6–24（每天等长）');
}

console.log('\n[测试B] 完全早于 6 点的行程被隐藏；跨过 6 点的行程只画窗口内部分；白天行程正常；每天时间轴等高');
{
  const early = { id: 'sp1', name: 'RedEye', type: 'spot', startTime: '00:10', durationH: 1, ticket: 0, reservation: '', hoursSegments: [] };
  const cross = { id: 'spc', name: 'LongTrip', type: 'spot', startTime: '00:10', durationH: 12, ticket: 0, reservation: '', hoursSegments: [] };
  const mid = { id: 'sp2', name: 'Museum', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd2', date: '2026-08-09', spots: [early, cross, mid] };

  const html = itin.renderDayColumn(day, 0, { id: 'x' }, false);
  assert(html.includes('sp2'), '白天行程(09:00) 仍渲染在行程表');
  assert(!html.includes('sp1'), '完全早于 6 点(00:10–01:10) 的行程被隐藏（不渲染）');
  assert(html.includes('spc'), '跨过 6 点的行程(00:10–12:10) 仅绘制窗口内部分(6:00–12:10)');

  // 等高：只有凌晨行程的天 vs 只有白天行程的天，时间轴高度一致（均为 18h）
  const htmlEarlyOnly = itin.renderDayColumn({ id: 'dE', date: '2026-08-09', spots: [early] }, 0, { id: 'x' }, false);
  const htmlNormal = itin.renderDayColumn({ id: 'dN', date: '2026-08-09', spots: [mid] }, 0, { id: 'x' }, false);
  const hE = parseFloat((htmlEarlyOnly.match(/height:([\d.]+)px/) || [])[1] || '-1');
  const hN = parseFloat((htmlNormal.match(/height:([\d.]+)px/) || [])[1] || '-1');
  assert(hE > 0 && hE === hN, `每天时间轴等高（early=${hE}, normal=${hN}）`);
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

console.log('\n[测试D] 固定休息日：行程排在休息日提示「今日休」');
{
  const win = { start: 6, end: 24 };
  const sunday = { id: 'dSun', date: '2026-08-09' }; // 周日
  const monday = { id: 'dMon', date: '2026-08-10' }; // 周一
  const closedSun = { id: 'sp', name: '店', type: 'spot', startTime: '10:00', durationH: 2, hoursSegments: [], closedDays: [0] };
  const htmlSun = itin.renderBlock(closedSun, sunday, win, null);
  assert(htmlSun.includes('今日休'), '周日且 closedDays 含周日(0) → 提示「今日休」');
  const htmlMon = itin.renderBlock(closedSun, monday, win, null);
  assert(!htmlMon.includes('今日休'), '周一（非休息日）→ 不提示「今日休」');
  const noClosed = itin.renderBlock({ id: 'sp2', name: '店2', type: 'spot', startTime: '10:00', durationH: 2, hoursSegments: [] }, sunday, win, null);
  assert(!noClosed.includes('今日休'), '无 closedDays → 不提示「今日休」');
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
