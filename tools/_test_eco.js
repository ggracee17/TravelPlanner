/*
 * 仿真测试：验证本次新增的两处逻辑
 *   1) extractCoordsFromMapUrl：从各类 Google Maps 链接离线解析经纬度（零 credits）；
 *   2) 省 Credits 模式下地图不再做地理编码（showMap 跳过 geocode 循环）。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-map.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');

function makeClient(opts) {
  opts = opts || {};
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: opts.key || '', enabled: false }, google: opts.google || null },
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
    destinations: [{ id: 'd1', name: 'X', startDate: '2026-01-01', endDate: '2026-01-01' }],
    activeDestinationId: 'd1',
    candidates: [], searchHistory: [], checklists: { documents: [], luggage: [] },
    itineraryTravelMode: 'transit', ecoMode: false,
    d1: { itinerary: [{ id: 'day1', date: '2026-01-01', spots: [{ id: 's1', name: 'X', type: 'spot', startTime: '09:00', lat: null, lng: null }] }] }
  };
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

// extractCoordsFromMapUrl 是 module-itinerary.js 顶层函数，加载后挂在 ctx 全局
function parse(ctx, url) { return ctx.extractCoordsFromMapUrl(url); }

console.log('\n[测试A] extractCoordsFromMapUrl 解析各类 Google Maps 链接');
{
  const { ctx } = makeClient();
  let c = parse(ctx, 'https://www.google.com/maps/place/Taipei+101/@25.0339,121.5645,15z');
  assert(c && Math.abs(c.lat - 25.0339) < 1e-6 && Math.abs(c.lng - 121.5645) < 1e-6, '@lat,lng,z 解析正确');
  c = parse(ctx, 'https://maps.google.com/maps/place/SpotName/data=!3d-33.8568!4d151.2153');
  assert(c && Math.abs(c.lat + 33.8568) < 1e-6 && Math.abs(c.lng - 151.2153) < 1e-6, '!3d!4d 编码坐标解析正确');
  c = parse(ctx, 'https://www.google.com/maps?q=35.68,139.76');
  assert(c && Math.abs(c.lat - 35.68) < 1e-6 && Math.abs(c.lng - 139.76) < 1e-6, '?q=lat,lng 解析正确');
  c = parse(ctx, 'https://www.google.com/maps/search/?api=1&query=35.68,139.76');
  assert(c && Math.abs(c.lat - 35.68) < 1e-6 && Math.abs(c.lng - 139.76) < 1e-6, '?query=lat,lng（Maps URL API）解析正确');
  c = parse(ctx, 'https://www.google.com/maps/search/?api=1&query=Tokyo+Tower');
  assert(c === null, '名称搜索链接无法离线解析 → null（不误报坐标）');
  c = parse(ctx, 'https://maps.app.goo.gl/abc123');
  assert(c === null, '短链无法离线解析 → null');
  assert(parse(ctx, '') === null, '空字符串 → null');
  assert(parse(ctx, null) === null, 'null → null');
}

console.log('\n[测试B] 省 Credits 模式下地图跳过地理编码（不消耗 Geocoding API）');
{
  const google = {
    maps: {
      Map: function () { this.fitBounds = () => {}; },
      LatLngBounds: function () { this.extend = () => {}; },
      Marker: function () { this.addListener = () => {}; },
      InfoWindow: function () {},
      Geocoder: function () { this.geocode = (q, cb) => cb([{ geometry: { location: { lat: () => 9, lng: () => 9 } } }], 'OK'); }
    }
  };
  (async () => {
    const { app } = makeClient({ key: 'test', google });
    let geo = 0;
    app.modules.map.geocodeCached = () => { geo++; return Promise.resolve(null); };

    app.state.ecoMode = false;
    await app.modules.map.showMap();
    const off = geo; geo = 0;

    app.state.ecoMode = true;
    await app.modules.map.showMap();
    const on = geo;

    assert(off >= 1, 'eco 关闭时：对缺坐标地点调用了地理编码（off=' + off + '）');
    assert(on === 0, 'eco 开启时：完全跳过地理编码，0 次调用（省 credits）');

    console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
    process.exit(failed === 0 ? 0 : 1);
  })();
}
