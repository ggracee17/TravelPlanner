/*
 * 仿真测试：地图板地点列表 renderList 的渲染规则
 *   1) 已定位（有坐标）→ 不显示任何附注；
 *   2) 未定位但有地图链接 → 也不显示附注（去掉「🔗 已链接（点名称打开）」）；
 *   3) 未定位且无链接 → 显示「未定位…」提示；
 *   4) 名称始终可点，但点击是「打开行程详情」(openTripForm)，【不是】跳转到地图链接；
 *   5) 地图链接降级为名称右侧独立的 🔗 图标（有坐标→经纬度、有 mapUrl→mapUrl、无则按名称搜索）；
 *   6) __all 模式带 Day N 前缀。
 * 用 vm 加载真实 app.js + module-i18n.js + module-map.js，桩掉 DOM。
 * 注意：renderList 期望的 item 形状与 collectSpots 一致（含 dayId/date/isCand/hidden），
 *       否则 openTripForm 的 dayId 参数会成 undefined —— 这里如实构造以对齐真实调用。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'module-i18n.js'), 'utf8');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');

function makeClient() {
  const store = {};
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const listEl = { innerHTML: '' };
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false } },
    document: {
      getElementById: id => (id === 'mapList' ? listEl : null),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      head: { appendChild() {} }
    },
    localStorage: ls,
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math,
    parseInt, parseFloat, isNaN, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, Set, Map
  };
  vm.createContext(ctx);
  vm.runInContext(APP_SRC + '\n;globalThis.__app = app;', ctx);
  vm.runInContext(I18N_SRC, ctx);
  vm.runInContext(MAP_SRC, ctx);
  return { app: ctx.__app, listEl };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

const spotLocated = { id: 's1', name: '台北101', lat: 25.03, lng: 121.56, startTime: '09:00', type: 'attraction' };
const spotLinked = { id: 's2', name: '士林夜市', mapUrl: 'https://www.google.com/maps/place/Shilin', startTime: '18:00', type: 'food' };
const spotBare = { id: 's3', name: '待定景点', startTime: '', type: 'attraction' };

// 与 collectSpots 一致的 item 形状
function item(spot, dayId, dayIndex, isCand) {
  return { spot, dayId, dayIndex, date: '2026-08-01', isCand: !!isCand, hidden: false };
}

// 名称是否为「点击打开行程详情」的可点元素（而非地图 <a> 链接）
function nameOpensDetail(html, dayId, spotId) {
  const call = `app.modules.itinerary.openTripForm('spot','${dayId}','${spotId}')`;
  return html.includes('onclick="' + call + '"');
}

console.log('\n[测试A] 单日模式：三种定位状态的附注渲染 + 名称/链接分工');
{
  const { app, listEl } = makeClient();
  const map = app.modules.map;
  const items = [item(spotLocated, 'd1', 0), item(spotLinked, 'd1', 0), item(spotBare, 'd1', 0)];
  map.renderList(items, [item(spotLocated, 'd1', 0)], 'd1');
  const html = listEl.innerHTML;

  assert(!html.includes('已链接'), '不再出现「已链接（点名称打开）」文案');
  assert(html.includes('🔗'), '名称旁出现独立 🔗 地图链接');
  assert(!/·\s*<span class="text-sky-600"/.test(html), '不再出现前导「·」的链接说明块');
  assert(html.includes('未定位'), '无坐标且无链接的地点仍提示「未定位」');
  assert((html.match(/未定位/g) || []).length === 1, '「未定位」只出现 1 次（仅 s3）');
  assert(html.includes('台北101') && html.includes('士林夜市') && html.includes('待定景点'), '三个地点都渲染出来了');
  // 名称点击打开行程详情，而非跳转地图
  assert(nameOpensDetail(html, 'd1', 's1'), '台北101 名称点击打开行程详情（非地图链接）');
  assert(nameOpensDetail(html, 'd1', 's2'), '士林夜市 名称点击打开行程详情（非地图链接）');
  assert(nameOpensDetail(html, 'd1', 's3'), '待定景点 名称点击打开行程详情（非地图链接）');
}

console.log('\n[测试B] 名称打开详情 + 🔗 独立链接指向正确地址');
{
  const { app, listEl } = makeClient();
  const map = app.modules.map;
  map.renderList([item(spotLinked, 'd1', 0)], [], 'd1');
  const html = listEl.innerHTML;
  assert(html.includes('href="https://www.google.com/maps/place/Shilin"'), '🔗 地图链接指向用户粘贴的 mapUrl');
  assert(html.includes('target="_blank"'), '链接新窗口打开');
  assert(html.includes('opacity-60'), '未定位地点仍置灰（视觉上可区分）');
  assert(nameOpensDetail(html, 'd1', 's2'), '名称点击打开行程详情');
  // 名称本身不应被包进地图 <a>：链接的可见文案是 🔗 而非地点名
  assert(!new RegExp('href="https://www.google.com/maps/place/Shilin"[^>]*>士林夜市').test(html), '名称未被包进地图链接（链接仅在 🔗 图标）');
}
{
  const { app, listEl } = makeClient();
  const map = app.modules.map;
  map.renderList([item(spotLocated, 'd1', 0)], [item(spotLocated, 'd1', 0)], 'd1');
  const html = listEl.innerHTML;
  assert(html.includes('maps?q=25.03%2C121.56'), '🔗 地图链接用经纬度（逗号已 URL 编码）');
  assert(!html.includes('opacity-60'), '已定位地点不置灰');
  assert(!html.includes('未定位'), '已定位地点无任何附注');
  assert(nameOpensDetail(html, 'd1', 's1'), '名称点击打开行程详情');
}
{
  const { app, listEl } = makeClient();
  const map = app.modules.map;
  map.renderList([item(spotBare, 'd1', 0)], [], 'd1');
  const html = listEl.innerHTML;
  assert(html.includes('maps/search/?api=1&query='), '🔗 无坐标无链接时按名称搜索 Google Maps');
  assert(nameOpensDetail(html, 'd1', 's3'), '名称点击打开行程详情');
}

console.log('\n[测试C] __all 模式 Day 前缀仍正常');
{
  const { app, listEl } = makeClient();
  const map = app.modules.map;
  map.renderList([item(spotLinked, 'd3', 2)], [], '__all');
  const html = listEl.innerHTML;
  assert(html.includes('Day 3 ·'), '全部日期模式显示 Day 3 前缀');
  assert(!html.includes('已链接'), '全部日期模式同样不显示「已链接」');
}

console.log('\n[测试D] 英文模式下也不出现链接说明');
{
  const { app, listEl } = makeClient();
  app.i18nEnabled = true;   // UI 上切换按钮已隐藏，这里显式开启以验证英文文案
  app.setLang('en');
  const map = app.modules.map;
  map.renderList([item(spotLinked, 'd1', 0), item(spotBare, 'd1', 0)], [], 'd1');
  const html = listEl.innerHTML;
  assert(!/Linked \(click name to open\)/.test(html), '英文下不出现 "Linked (click name to open)"');
  assert(html.includes('Not located'), '英文下未定位提示仍在');
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========\n`);
process.exit(failed ? 1 : 0);
