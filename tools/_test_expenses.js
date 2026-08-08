/*
 * 仿真测试：验证本次新增的两处逻辑
 *   1) module-map._colorForItem：全部日期按「第几天」分色、单日按「地点类别」分色；
 *   2) app.getExpensesTotal：澳币(AUD)按目的地汇率换算成台币(TWD)、台币原值累加，预算判定一致。
 * 用 vm 加载真实 app.js + module-map.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');

function makeClient() {
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null },
    document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext(MAP_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.modules = app.modules || {};
  app.state = {
    destinations: [{ id: 'd1', name: 'Sydney', startDate: '2026-02-01', endDate: '2026-02-03', budget: 10000, audToTwd: 21 }],
    activeDestinationId: 'd1',
    candidates: [],
    itineraryTravelMode: 'transit',
    d1: { itinerary: [{
      id: 'day1', date: '2026-02-01', weather: '',
      spots: [
        { id: 's1', name: 'A', type: 'restaurant', startTime: '09:00', lat: 25.03, lng: 121.56 },
        { id: 's2', name: 'B', type: 'hotel', startTime: '12:00', lat: 25.04, lng: 121.57 }
      ]
    }] }
  };
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

// 从 module-map.js 里抓出 DAY_COLORS / MAP_COLORS 的取值，便于断言（避免重复硬编码）
function dayColorAt(app, idx) {
  // 借助 _colorForItem 在 __all 模式下的行为反推
  return app.modules.map._colorForItem({ spot: { type: 'other' }, dayIndex: idx }, '__all');
}
function catColorAt(app, type) {
  return app.modules.map._colorForItem({ spot: { type }, dayIndex: 0 }, 'day1');
}

console.log('\n[测试A] 地图按日期/类别分色 _colorForItem');
{
  const { app } = makeClient();
  // 全部日期：Day1 → DAY_COLORS[0]，Day2 → DAY_COLORS[1]，循环（第11天回 DAY_COLORS[0]）
  assert(dayColorAt(app, 0) === '#ef4444', '全部日期 Day1 = 红 (#ef4444)');
  assert(dayColorAt(app, 1) === '#f97316', '全部日期 Day2 = 橙 (#f97316)');
  assert(dayColorAt(app, 10) === dayColorAt(app, 0), '第11天回绕到第1天的颜色（取模）');
  // 单日：按类别取 MAP_COLORS
  assert(catColorAt(app, 'restaurant') === '#ef4444', '单日 餐厅 红');
  assert(catColorAt(app, 'hotel') === '#a855f7', '单日 酒店 紫');
  assert(catColorAt(app, 'spot') === '#3b82f6', '单日 景点 蓝');
  assert(catColorAt(app, 'unknownX') === '#64748b', '单日 未知类别 回落 other 灰');
}

console.log('\n[测试B] 澳币/台币换算 getExpensesTotal');
{
  const { app } = makeClient();
  // 默认汇率 21；澳币 100 → 2100，台币 500 → 500，合计 2600
  app.state.d1.expenses = [
    { id: 'e1', currency: 'AUD', amount: 100 },
    { id: 'e2', currency: 'TWD', amount: 500 },
    { id: 'e3', currency: 'TWD', amount: '' } // 空金额应计 0
  ];
  assert(Math.abs(app.getExpensesTotal('d1') - 2600) < 1e-6, '默认汇率(21)：A$100 + ¥500 = ¥2600');

  // 改汇率 20：A$100 → 2000（汇率是目的地级属性，写在 destinations[0].audToTwd）
  app.state.destinations[0].audToTwd = 20;
  assert(Math.abs(app.getExpensesTotal('d1') - 2500) < 1e-6, '汇率改 20：A$100 + ¥500 = ¥2500');

  // 纯台币：汇率无关
  app.state.d1.expenses = [{ id: 'e4', currency: 'TWD', amount: 1234 }];
  assert(Math.abs(app.getExpensesTotal('d1') - 1234) < 1e-6, '纯台币：汇率不影响结果');

  // 缺 audToTwd：回落默认 21（删掉目的地级属性）
  delete app.state.destinations[0].audToTwd;
  app.state.d1.expenses = [{ id: 'e5', currency: 'AUD', amount: 10 }];
  assert(Math.abs(app.getExpensesTotal('d1') - 210) < 1e-6, '缺 audToTwd 回落默认 21：A$10 = ¥210');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
