/*
 * 仿真测试：验证「每日行程表 → Google Distance Matrix 计算相邻行程点交通时间」功能。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-map.js，桩掉 DOM / 浏览器 API，
 * 并提供假的 DistanceMatrixService，断言：
 *   1) 成功计算：spots[1]/spots[2] 拿到交通时间，spots[0]（第一天首站）无「距上一站」；
 *   2) 无 API Key 守卫：直接报错且不改动已有数据；
 *   3) clearTravelForDay：任何结构变更后交通时间被清除；
 *   4) moveSpotToTime 后交通时间被清除；
 *   5) 地理编码兜底：缺坐标的行程块会先按名称地理编码，再参与计算。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');

// 假的 DistanceMatrixService：返回 n×n 矩阵（真实 API 行为），每个元素 12分钟 / 2.1 公里
function FakeService() {}
FakeService.prototype.getDistanceMatrix = function (req, cb) {
  const n = req.origins.length, m = req.destinations.length;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const elements = [];
    for (let j = 0; j < m; j++) {
      elements.push({ status: 'OK', duration: { text: '12分钟', value: 720 }, distance: { text: '2.1 公里', value: 2100 } });
    }
    rows.push({ elements });
  }
  cb({ rows }, 'OK');
};

function makeClient(opts) {
  opts = opts || {};
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: opts.key !== undefined ? opts.key : 'test', enabled: false }, google: opts.google || null },
    document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext(MAP_SRC, ctx);
  vm.runInContext(ITIN_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.modules = app.modules || {};
  app.state = {
    destinations: [{ id: 'd1', name: 'Tokyo', startDate: '2026-01-01', endDate: '2026-01-03' }],
    activeDestinationId: 'd1',
    candidates: [],
    itineraryTravelMode: 'transit',
    d1: { itinerary: [{
      id: 'day1', date: '2026-01-01', weather: '',
      spots: [
        { id: 's1', name: 'A', type: 'spot', startTime: '09:00', durationH: 2, lat: 25.03, lng: 121.56, travelFromPrev: null },
        { id: 's2', name: 'B', type: 'spot', startTime: '12:00', durationH: 2, lat: 25.04, lng: 121.57, travelFromPrev: null },
        { id: 's3', name: 'C', type: 'spot', startTime: '15:00', durationH: 2, lat: 25.05, lng: 121.58, travelFromPrev: null }
      ]
    }] }
  };
  app.renderAll = () => {};
  app.toast = (msg, type) => { ctx.__toasts.push({ msg, type }); };
  ctx.__toasts = [];
  if (opts.google) ctx.window.google = opts.google;
  return { app, ctx };
}

function dumpDay(app) {
  return app.state.d1.itinerary[0].spots.map(s => s.travelFromPrev ? (s.travelFromPrev.durText + '|' + s.travelFromPrev.mode) : 'null');
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

(async () => {
  // ===== 测试 1：成功计算 =====
  console.log('\n[测试1] 用 Google 成功计算相邻行程点交通时间');
  {
    const google = { maps: { DistanceMatrixService: FakeService, TravelMode: { DRIVING: 'DRIVING', WALKING: 'WALKING', TRANSIT: 'TRANSIT', BICYCLING: 'BICYCLING' }, UnitSystem: { METRIC: 'METRIC' } } };
    const { app, ctx } = makeClient({ key: 'test', google });
    await app.modules.itinerary.computeTravel('day1');
    const day = dumpDay(app);
    console.log('  计算结果 =', JSON.stringify(day));
    assert(day[0] === 'null', '首站（第一天第一个行程块）无「距上一站」');
    assert(day[1] === '12分钟|transit', '第二站拿到交通时间（transit / 12分钟）');
    assert(day[2] === '12分钟|transit', '第三站拿到交通时间（transit / 12分钟）');
    assert(ctx.__toasts.some(t => /已计算/.test(t.msg)), '提示「交通时间已计算」');
  }

  // ===== 测试 2：无 API Key 守卫 =====
  console.log('\n[测试2] 未配置 GMAPS_API_KEY 时直接报错、不改动数据');
  {
    const { app, ctx } = makeClient({ key: '' });
    app.state.d1.itinerary[0].spots[1].travelFromPrev = { mode: 'transit', durText: '旧值', distText: '' };
    await app.modules.itinerary.computeTravel('day1');
    assert(ctx.__toasts.some(t => /GMAPS_API_KEY/.test(t.msg)), '提示需配置 GMAPS_API_KEY');
    assert(app.state.d1.itinerary[0].spots[1].travelFromPrev.durText === '旧值', '无 Key 时不改动已有交通时间');
  }

  // ===== 测试 3：clearTravelForDay =====
  console.log('\n[测试3] clearTravelForDay 清除整天的交通时间');
  {
    const { app } = makeClient({ key: 'test' });
    app.state.d1.itinerary[0].spots.forEach(s => s.travelFromPrev = { mode: 'transit', durText: 'x' });
    app.modules.itinerary.clearTravelForDay('day1');
    assert(dumpDay(app).every(v => v === 'null'), '整天的交通时间被清空');
  }

  // ===== 测试 4：moveSpotToTime 后清除 =====
  console.log('\n[测试4] 拖动改时间后，相关段交通时间被清除');
  {
    const { app } = makeClient({ key: 'test' });
    app.state.d1.itinerary[0].spots[0].travelFromPrev = { mode: 'transit', durText: 'a' };
    app.state.d1.itinerary[0].spots[1].travelFromPrev = { mode: 'transit', durText: 'b' };
    app.modules.itinerary.moveSpotToTime('s2', 'day1', '10:00');
    const day = dumpDay(app);
    assert(day[0] === 'null' && day[1] === 'null' && day[2] === 'null', '移动后所有交通时间被清除（待重算）');
  }

  // ===== 测试 5：地理编码兜底（缺坐标先按名称定位）=====
  console.log('\n[测试5] 缺坐标的行程块先地理编码再参与计算');
  {
    const google = { maps: { DistanceMatrixService: FakeService, TravelMode: { TRANSIT: 'TRANSIT' }, UnitSystem: { METRIC: 'METRIC' } } };
    const { app, ctx } = makeClient({ key: 'test', google });
    // s2 缺坐标
    delete app.state.d1.itinerary[0].spots[1].lat;
    delete app.state.d1.itinerary[0].spots[1].lng;
    // 桩掉 geocodeCached，让它返回坐标
    app.modules.map.geocodeCached = (q) => Promise.resolve({ lat: 99.9, lng: 88.8 });
    await app.modules.itinerary.computeTravel('day1');
    const s2 = app.state.d1.itinerary[0].spots[1];
    assert(s2.lat === 99.9 && s2.lng === 88.8, 's2 被地理编码补上了坐标');
    assert(s2.travelFromPrev && s2.travelFromPrev.durText === '12分钟', '补坐标后 s2 仍正常计算出交通时间');
  }

  console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
  process.exit(failed === 0 ? 0 : 1);
})();
