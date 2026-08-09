/*
 * 验证用户需求（消息9）：有填地图链接的地点，按地图链接里的坐标显示在地图上，不用按名称定位。
 *   - 行程块/候选只要 mapUrl 能解析出坐标，就直接用链接坐标（免费、最准），不再调用 Google 按名称地理编码；
 *   - 候选坐标应回写持久化；无链接或链接无坐标时才按名称兜底（省 Credits 模式直接跳过）。
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
  app.toast = () => {};
  app.saveState = () => {};
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

const { app, ctx } = makeClient();
const map = app.modules.map;
app.state.candidates = [];

// 可控的地理编码桩：记录被调用的查询，并返回预设结果
let geoLog = [];
let geoResult = null; // null = 地理编码查不到
map.geocodeCached = (q) => { geoLog.push(q); return Promise.resolve(geoResult); };

(async () => {
console.log('\n[测试] 地图链接坐标优先于按名称定位');
{
  geoLog = [];
  const it = { spot: { name: '台北101', mapUrl: 'https://www.google.com/maps/@25.033,121.565,15z', lat: null, lng: null }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'located', '有 @lat,lng 链接 → located');
  assert(it.spot.lat === 25.033 && it.spot.lng === 121.565, '坐标取自地图链接（25.033,121.565）');
  assert(geoLog.length === 0, '有地图链接坐标时不调用按名称地理编码（不消耗配额）');
}
{
  geoLog = [];
  const it = { spot: { name: '店', mapUrl: 'https://maps.google.com/?q=22.5431,114.0579&z=16', lat: null, lng: null }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'located' && it.spot.lat === 22.5431 && it.spot.lng === 114.0579, 'q=lat,lng 链接 → 用链接坐标');
  assert(geoLog.length === 0, 'q= 链接不触发名称地理编码');
}
{
  geoLog = [];
  const it = { spot: { name: '店', mapUrl: 'https://maps.google.com/maps/place/X/@39.9042,116.4074,15z', lat: null, lng: null }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'located' && Math.abs(it.spot.lat - 39.9042) < 1e-6, '!3d!4d / @ 混合链接 → 用链接坐标');
  assert(geoLog.length === 0, '混合格式链接不触发名称地理编码');
}

console.log('\n[测试] 候选坐标回写（来自链接）');
{
  geoLog = [];
  const cand = { id: 'cc1', name: '分店A', lat: null, lng: null };
  app.state.candidates = [cand];
  const it = { spot: { id: 'cc1', name: '分店A', mapUrl: 'https://www.google.com/maps/@-33.8688,151.2093,15z', lat: null, lng: null }, isCand: true };
  const st = await map._resolveItemCoord(it);
  assert(st === 'located' && cand.lat === -33.8688 && cand.lng === 151.2093, '候选经地图链接定位后坐标回写持久化');
  assert(geoLog.length === 0, '候选链接定位不触发名称地理编码');
}

console.log('\n[测试] 无链接 / 链接无坐标 → 按名称兜底（或省 Credits 跳过）');
{
  geoLog = []; geoResult = { lat: 10.0, lng: 20.0 };
  const it = { spot: { name: '某店', mapUrl: '', lat: null, lng: null }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'located' && it.spot.lat === 10 && it.spot.lng === 20, '无链接但有名称 → 按名称地理编码定位');
  assert(geoLog.length === 1 && geoLog[0].includes('某店'), '无链接时调用名称地理编码');
}
{
  geoLog = []; geoResult = null;
  app.state.ecoMode = true;
  const it = { spot: { name: '某店', mapUrl: 'https://maps.google.com/maps/place/OnlyName', lat: null, lng: null }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'failed-new' && it.spot.lat == null, '省 Credits + 链接无坐标 → 不按名称定位（failed-new，保持未定位）');
  assert(geoLog.length === 0, '省 Credits 下不调用名称地理编码');
  app.state.ecoMode = false;
}
{
  geoLog = []; geoResult = null;
  const it = { spot: { name: '查不到的店', mapUrl: '', lat: null, lng: null }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'failed-new' && it.spot.lat == null, '有名称但地理编码查不到 → failed-new（不误用链接）');
  assert(geoLog.length === 1, '地理编码被调用一次（按名称兜底）');
}
{
  const it = { spot: { name: '已有', mapUrl: '', lat: 31.2, lng: 121.5 }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'existing', '已有坐标 → existing，不重复定位');
}

console.log('\n[测试] 地图链接坐标覆盖已有/旧坐标（修复「台北到悉尼」被错定到悉尼）');
{
  // 已有坐标指向旧位置（悉尼 151, -33），但行程链接坐标在香港/台北 → 链接应覆盖
  geoLog = [];
  const it = { spot: { name: '台北到悉尼', mapUrl: 'https://www.google.com/maps/@25.033,121.565,15z', lat: -33.8688, lng: 151.2093 }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'located', '已有坐标但链接坐标不同 → located（链接覆盖）');
  assert(Math.abs(it.spot.lat - 25.033) < 1e-6 && Math.abs(it.spot.lng - 121.565) < 1e-6, '坐标被行程链接坐标覆盖（不再停在旧位置）');
  assert(geoLog.length === 0, '有链接坐标时不调用名称地理编码');
}
{
  // 链接坐标与现有坐标一致 → 视为 existing（无需回写）
  const it = { spot: { name: 'X', mapUrl: 'https://www.google.com/maps/@25.033,121.565,15z', lat: 25.033, lng: 121.565 }, isCand: false };
  const st = await map._resolveItemCoord(it);
  assert(st === 'existing', '链接坐标与现有坐标一致 → existing');
}

console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
process.exit(failed ? 1 : 0);
})();
