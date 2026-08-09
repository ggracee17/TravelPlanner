/*
 * 验证用户需求（消息15 - 子需求1）：把「全站刷新最新数据」下放到每个地图地点。
 *   - 点击地点上的「📍 用链接定位」按钮（forceResolveFromLinkById）后，用该地点地图链接坐标
 *     【强制覆盖】旧坐标 / 地理编码坐标，无视是否已存在坐标、无视省 Credits 模式；
 *   - 行程块与候选库均生效；
 *   - 没有地图链接 / 链接无法解析坐标时，给出提示且不动原坐标。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-map.js + module-candidates.js，桩掉 DOM / Google API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8') +
  '\n;globalThis.extractCoordsFromMapUrl = extractCoordsFromMapUrl;';
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');
const CAND_SRC = fs.readFileSync(path.join(ROOT, 'module-candidates.js'), 'utf8');

function makeClient() {
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', gmapsMapId: '', enabled: false }, google: null, I18N: undefined },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, addEventListener: () => {} },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;', ctx);
  vm.runInContext(ITIN_SRC, ctx);
  vm.runInContext(MAP_SRC, ctx);
  vm.runInContext(CAND_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.renderAll = () => {};
  app.closeModal = () => {};
  app.saveState = () => {};
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

const { app } = makeClient();
const map = app.modules.map;
let toasts = [];
app.toast = (msg, type) => { toasts.push({ msg: msg || '', type }); };

// 构造一个目的地 + 一天 + 一个带「旧坐标」和「新地图链接」的行程块。
// 注意真实 app 的行程数据存于 app.state[destId].itinerary（按目的地 id 的平行映射），并非嵌套在 destinations[] 内。
function setup() {
  const spot = {
    id: 'spot1', name: '老地点', startTime: '09:00',
    lat: -33.8688, lng: 151.2093, // 旧坐标（错误地停在悉尼）
    mapUrl: 'https://www.google.com/maps/@25.033,121.565,15z' // 新粘贴的链接指向台北
  };
  app.state = {
    activeDestinationId: 'dest1',
    destinations: [{ id: 'dest1' }],
    dest1: { itinerary: [{ id: 'day1', date: '2026-01-01', spots: [spot] }] },
    candidates: []
  };
  return spot;
}

(async () => {
  console.log('\n[测试] 行程块：用新地图链接坐标强制覆盖旧坐标');
  {
    const spot = setup();
    await map.forceResolveFromLinkById('day1', 'spot1', false);
    assert(Math.abs(spot.lat - 25.033) < 1e-6 && Math.abs(spot.lng - 121.565) < 1e-6,
      '旧坐标(悉尼)被地图链接坐标(台北)覆盖');
    assert(spot._geoFailed === false && spot._geoFailQ === '', '覆盖后清除地理编码失败标记');
    assert(toasts.some(t => /已用地图链接坐标更新/.test(t.msg)), '成功时给出已更新提示');
  }

  console.log('\n[测试] 候选库：链接坐标回写候选对象');
  {
    const spot = setup();
    const cand = { id: 'c1', name: '分店', lat: 1, lng: 2, mapUrl: 'https://www.google.com/maps/@10.0,20.0,15z' };
    app.state.candidates = [cand];
    await map.forceResolveFromLinkById('', 'c1', true);
    assert(cand.lat === 10 && cand.lng === 20, '候选坐标被其地图链接坐标覆盖（直接改的是候选对象本身）');
  }

  console.log('\n[测试] 没有地图链接 → 提示且不改坐标');
  {
    const spot = setup();
    spot.mapUrl = '';
    toasts = [];
    await map.forceResolveFromLinkById('day1', 'spot1', false);
    assert(toasts.some(t => /还没有地图链接/.test(t.msg)), '无链接 → 警告提示');
    assert(spot.lat === -33.8688 && spot.lng === 151.2093, '无链接时不改变原坐标');
  }

  console.log('\n[测试] 链接无法解析坐标 → 提示且不改坐标');
  {
    const spot = setup();
    spot.mapUrl = 'https://example.com/not-a-map';
    toasts = [];
    await map.forceResolveFromLinkById('day1', 'spot1', false);
    assert(toasts.some(t => /无法从地图链接解析/.test(t.msg)), '链接无坐标 → 警告提示');
    assert(spot.lat === -33.8688 && spot.lng === 151.2093, '链接无坐标时不改变原坐标');
  }

  console.log('\n[测试] 找不到地点对象 → 安全退出');
  {
    setup();
    toasts = [];
    await map.forceResolveFromLinkById('dayX', 'nope', false);
    assert(toasts.some(t => /未找到该地点/.test(t.msg)), '不存在的地点 → 提示未找到');
  }

  console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
  process.exit(failed ? 1 : 0);
})();
