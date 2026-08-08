/*
 * 验证两个新功能：
 *   1) 复制行程块到其它日期（共享同一行程库 sourceId，不在行程库重复添加）；
 *      行程库 _buildPlacedMap 能统计「已加入 N 个日期」。
 *   2) 清除所有天的交通时间 clearTravelAll。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-candidates.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
const CAND_SRC = fs.readFileSync(path.join(ROOT, 'module-candidates.js'), 'utf8');

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
  vm.runInContext(CAND_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.state = {
    destinations: [{ id: 'd1', name: 'Tokyo', startDate: '2026-01-01', endDate: '2026-01-04' }],
    activeDestinationId: 'd1',
    candidates: [{ id: 'c_hotel', name: 'Hotel', type: '住宿', checked: false, durationH: 0.5 }],
    d1: { itinerary: [
      { id: 'it_1', date: '2026-01-01', spots: [{ id: 'sp1', sourceId: 'c_hotel', name: 'Hotel', type: 'hotel', startTime: '22:00', durationH: 0.5, travelFromPrev: { mode: 'transit', durText: '12分钟' } }] },
      { id: 'it_2', date: '2026-01-02', spots: [] },
      { id: 'it_3', date: '2026-01-03', spots: [] },
      { id: 'it_4', date: '2026-01-04', spots: [{ id: 'spX', sourceId: 'c_other', name: 'Other', type: 'spot', startTime: '10:00', durationH: 2, travelFromPrev: { mode: 'transit', durText: '5分钟' } }] }
    ] }
  };
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

const { app, ctx } = makeClient();
const itin = app.modules.itinerary;
const cand = app.modules.candidates;

console.log('\n[测试A] 复制行程块到其它日期（共享 sourceId，行程库不重复）');
{
  // 复制前：c_hotel 仅落在 Day1
  let pm = cand._buildPlacedMap('d1');
  assert(pm['c_hotel'] && pm['c_hotel'].count === 1, '复制前 Hotel 仅落在 1 天');
  assert(pm['c_hotel'].firstDayIndex === 0, '复制前 Hotel firstDayIndex=0');

  // 桩：模拟勾选了 Day2 / Day3 两个复选框
  ctx.document.querySelectorAll = (sel) => sel === '.copy-day-cb:checked'
    ? [{ value: 'it_2' }, { value: 'it_3' }]
    : [];
  // 桩：避免 renderAll / openModal 副作用（仅计数调用）
  let renderCalls = 0;
  app.renderAll = () => { renderCalls++; };
  app.closeModal = () => {};
  app.toast = () => {};

  itin.confirmCopyTrip('it_1', 'sp1');

  const days = app.state.d1.itinerary;
  const d2 = days.find(x => x.id === 'it_2');
  const d3 = days.find(x => x.id === 'it_3');
  assert(d2.spots.length === 1, 'Day2 已新增 1 个行程块');
  assert(d3.spots.length === 1, 'Day3 已新增 1 个行程块');
  assert(d2.spots[0].sourceId === 'c_hotel', 'Day2 新块 sourceId 复用 c_hotel（未新建行程库项）');
  assert(d3.spots[0].sourceId === 'c_hotel', 'Day3 新块 sourceId 复用 c_hotel');
  assert(d2.spots[0].id !== 'sp1' && d3.spots[0].id !== 'sp1', '新块拥有独立 id（非原地移动）');
  assert(app.state.candidates.length === 1, '行程库项目数仍为 1（未重复添加）');
  assert(app.state.candidates[0].checked === true, '行程库 Hotel 项标记为已加入');

  // 复制后：c_hotel 落在 3 天（Day1 原 + Day2 + Day3）
  pm = cand._buildPlacedMap('d1');
  assert(pm['c_hotel'] && pm['c_hotel'].count === 3, '复制后 Hotel 已加入 3 个日期');
  assert(pm['c_hotel'].days.map(x => x.dayIndex + 1).join(',') === '1,2,3', 'dayIndex 列表为 1,2,3');
}

console.log('\n[测试B] _buildPlacedMap 多日期排序键 firstDayIndex');
{
  // 同一 sourceId 跨 Day2、Day4：firstDayIndex 应取最早(1)
  const fake = { 'c_x': { count: 2, days: [{ dayIndex: 1 }, { dayIndex: 3 }], firstDayIndex: 1 } };
  const sorted = cand.sortCandidates(
    [{ id: 'c_x' }, { id: 'c_y' }],
    Object.assign({ 'c_y': { count: 1, days: [{ dayIndex: 0 }], firstDayIndex: 0 } }, fake)
  );
  // c_y(firstDayIndex=0) 应排在 c_x(firstDayIndex=1) 之前
  assert(sorted[0].id === 'c_y' && sorted[1].id === 'c_x', '排序按最早落入日期：未加入/早日期在前');
}

console.log('\n[测试C] 清除所有天的交通时间 clearTravelAll');
{
  // 给 Day1/Day4 设置交通时间（已在初始化里），再清除
  itin.clearTravelAll();
  const days = app.state.d1.itinerary;
  const allCleared = days.every(d => (d.spots || []).every(s => s.travelFromPrev === null));
  assert(allCleared, '清除后所有行程块的 travelFromPrev 均为 null');
  assert((days.find(d => d.id === 'it_1').spots[0].sourceId) === 'c_hotel', '清除交通时间不影响行程块其它字段');
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
