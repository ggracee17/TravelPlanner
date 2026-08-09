/*
 * 验证两个修复：
 *   1) 时间轴为完整 00:00–24:00 时间轴：所有行程（含 6 点以前的凌晨行程）都渲染并可拖动，
 *      修复「6 点前添加的行程块无法移动」的问题；每天时间轴等高（可视区高度一致）。
 *   2) 时间选择菜单改为「先选小时，再选分钟」的两段式选择器（并保留 24 小时制选项）。
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

console.log('\n[测试A] 时间轴为完整 00:00–24:00（每天等长；凌晨行程同样渲染）');
{
  const earlySpot = { id: 'sp1', name: 'Hotel', type: 'hotel', startTime: '00:10', endTime: '12:10', durationH: 12, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd1', spots: [earlySpot] };

  const wCollapsed = itin.dayWindow(day, false);
  assert(wCollapsed.start === 0 && wCollapsed.end === 24, '折叠：窗口固定 0–24（完整一天）');
  const wExpanded = itin.dayWindow(day, true);
  assert(wExpanded.start === 0 && wExpanded.end === 24, '展开：窗口固定 0–24（完整一天）');

  // 空日程也保持同样长度
  const empty = itin.dayWindow({ id: 'd0', spots: [] }, false);
  assert(empty.start === 0 && empty.end === 24, '空日程：窗口仍为 0–24（每天等长）');
}

console.log('\n[测试B] 凌晨/跨 6 点/白天行程都渲染；每天时间轴可视区等高');
{
  const early = { id: 'sp1', name: 'RedEye', type: 'spot', startTime: '00:10', durationH: 1, ticket: 0, reservation: '', hoursSegments: [] };
  const cross = { id: 'spc', name: 'LongTrip', type: 'spot', startTime: '00:10', durationH: 12, ticket: 0, reservation: '', hoursSegments: [] };
  const mid = { id: 'sp2', name: 'Museum', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', hoursSegments: [] };
  const day = { id: 'd2', date: '2026-08-09', spots: [early, cross, mid] };

  const html = itin.renderDayColumn(day, 0, { id: 'x' }, false);
  assert(html.includes('sp2'), '白天行程(09:00) 仍渲染在行程表');
  assert(html.includes('sp1'), '凌晨行程(00:10–01:10) 也渲染在行程表（修复「6 点前无法移动」）');
  assert(html.includes('spc'), '跨 6 点的行程(00:10–12:10) 完整渲染（00:10–12:10）');

  // 等高：只有凌晨行程的天 vs 只有白天行程的天，时间轴可视区高度一致
  const htmlEarlyOnly = itin.renderDayColumn({ id: 'dE', date: '2026-08-09', spots: [early] }, 0, { id: 'x' }, false);
  const htmlNormal = itin.renderDayColumn({ id: 'dN', date: '2026-08-09', spots: [mid] }, 0, { id: 'x' }, false);
  const hE = parseFloat((htmlEarlyOnly.match(/height:([\d.]+)px/) || [])[1] || '-1');
  const hN = parseFloat((htmlNormal.match(/height:([\d.]+)px/) || [])[1] || '-1');
  assert(hE > 0 && hE === hN, `每天时间轴可视区等高（early=${hE}, normal=${hN}）`);
}

console.log('\n[测试C] 时间菜单：两段式选择器提供 24 小时制小时与分钟');
{
  // itinTimeOptions 仍可用作底层 24 小时制选项来源（小时 0–23 全覆盖）
  const opts = itin.itinTimeOptions('12:10', 5);
  assert(/<option value="12:10" selected/.test(opts), '5 分钟档含 12:10 且被选中');
  assert(/<option value="00:10"/.test(opts), '5 分钟档含 00:10（支持 12:10am 录入）');
  assert(/<option value="23:55"/.test(opts), '5 分钟档覆盖到 23:55');
  // 营业时间默认 30 分钟档仍可用
  const opts30 = itin.itinTimeOptions('09:00');
  assert(/<option value="09:00" selected/.test(opts30) && /<option value="09:30"/.test(opts30) && !/09:10/.test(opts30), '默认 30 分钟档（营业时间）保持，且不含 09:10');
  // itinTimeToNum 解析 24 小时串
  assert(Math.abs(ctx.itinTimeToNum('00:10') - (1 / 6)) < 1e-6, 'itinTimeToNum("00:10") = 1/6 小时');
}

console.log('\n[测试D] 固定休息日：行程排在休息日提示「今日休」');
{
  const win = { start: 0, end: 24 };
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
