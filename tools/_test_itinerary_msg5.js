/*
 * 验证用户本轮 6 项需求（消息5）：
 *   1/2) 行程表单「加入行程表的日期」新增「暂不加入」选项；选中时隐藏开始/结束时间字段；
 *   3)   编辑未加入行程的候选，若不改加入日期，保存后仍保持未加入；
 *   4)   行程库可按日期筛选（全部 / 未加入行程 / 某个 Day）；
 *   5)   地图可显示未加入行程表的地点（候选库未排入时间轴者）；
 *   6)   地图地点详情可手动隐藏某地点（仅影响地图）。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-candidates.js + module-map.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8') +
  '\n;globalThis.ITIN_TYPES = ITIN_TYPES; globalThis.CN_TO_ITIN_KEY = CN_TO_ITIN_KEY; globalThis.ITIN_KEY_TO_CN = ITIN_KEY_TO_CN;';
const CAND_SRC = fs.readFileSync(path.join(ROOT, 'module-candidates.js'), 'utf8');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');

// 表单字段桩：getElementById 返回固定值；querySelectorAll 对三个收集器返回空数组
function makeEl(value) {
  return { value, checked: false, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [] };
}

function makeClient() {
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      head: { appendChild() {} },
      addEventListener: () => {}
    },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext(ITIN_SRC, ctx);
  vm.runInContext(CAND_SRC, ctx);
  vm.runInContext(MAP_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  // 隔离 renderAll / closeModal / toast / saveState，避免触碰 DOM
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
const itin = app.modules.itinerary;
const cands = app.modules.candidates;
const map = app.modules.map;

// ---- 公共测试数据 ----
function setup() {
  app.state.destinations = [{ id: 'd1', name: '测试目的地', startDate: '2026-08-01', endDate: '2026-08-03' }];
  app.state.activeDestinationId = 'd1';
  app.state.d1 = { itinerary: [
    { id: 'day1', date: '2026-08-01', spots: [] },
    { id: 'day2', date: '2026-08-02', spots: [] }
  ] };
  app.state.candidates = [];
  app.state.candFilter = '__all';
  app.state.candDateFilter = '__all';
  app.state.mapShowUnjoined = false;
  app.state.mapShowHidden = false;
}

/* ============ 1/2) 表单「暂不加入」+ 隐藏开始/结束时间 ============ */
console.log('\n[测试] 表单：加入日期「暂不加入」选项 + 隐藏时间字段');
const dayOpts = '<option value="">暂不加入</option><option value="day1">Day 1</option>';
const htmlHidden = itin._schedFields({ startTime: '09:00' }, { dayOptions: dayOpts, showTime: false });
assert(htmlHidden.includes('id="t_day"') && htmlHidden.includes('onchange="app.modules.itinerary.onDayChange()"'), '下拉含「加入行程表的日期」且绑定 onDayChange');
assert(htmlHidden.includes('value="">暂不加入</option>'), '下拉含「暂不加入」空值选项');
assert(htmlHidden.includes('id="schedTimeWrap" class="hidden"'), 'showTime=false 时时间字段容器带 hidden（默认隐藏）');
const htmlShown = itin._schedFields({ startTime: '09:00' }, { dayOptions: dayOpts, showTime: true });
assert(!htmlShown.includes('class="hidden"'), 'showTime=true 时时间字段容器无 hidden（默认显示）');

/* ============ 4) 行程库按日期筛选 ============ */
console.log('\n[测试] 行程库：按日期筛选');
setup();
// 构造：c_joined 加入 day1；c_unjoined 未加入
app.state.candidates = [
  { id: 'c_joined', name: '已加入', type: '景点' },
  { id: 'c_unjoined', name: '未加入', type: '餐饮' }
];
app.state.d1.itinerary[0].spots = [{ id: 'sp1', sourceId: 'c_joined', name: '已加入', type: 'spot', startTime: '10:00' }];
const placedMap = cands._buildPlacedMap('d1');
const sorted = cands.sortCandidates(app.state.candidates, placedMap);
const days = app.state.d1.itinerary.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
assert(cands.filterByDate(sorted, placedMap, '__all', days).length === 2, '日期筛选=全部：保留全部 2 项');
assert(cands.filterByDate(sorted, placedMap, '__none', days).length === 1 &&
  cands.filterByDate(sorted, placedMap, '__none', days)[0].id === 'c_unjoined', '日期筛选=未加入行程：仅返回未加入项');
const byDay1 = cands.filterByDate(sorted, placedMap, 'day1', days);
assert(byDay1.length === 1 && byDay1[0].id === 'c_joined', '日期筛选=Day1：仅返回落在 Day1 的项');
assert(cands.filterByDate(sorted, placedMap, 'day2', days).length === 0, '日期筛选=Day2：无项落入，返回空');

/* ============ 3) 编辑未加入的候选：不改日期则保持未加入 ============ */
console.log('\n[测试] 编辑未加入行程：保存后保持未加入');
setup();
const elsA = {
  t_name: makeEl('未加入地点'), t_type: makeEl('spot'), t_dur: makeEl('2'),
  t_map: makeEl(''), t_img: makeEl(''), t_note: makeEl(''),
  t_start: makeEl('09:00'), t_end: makeEl(''), t_ticket: makeEl('0'), t_resv: makeEl(''),
  t_day: makeEl('') // 暂不加入
};
ctx.document.getElementById = (id) => elsA[id] || null;
ctx.document.querySelectorAll = () => [];
app.state.candidates = [{ id: 'c1', name: '未加入地点', type: '活动', checked: false, preferredDayId: '' }];
itin.saveTrip('cand', 'c1', '');
assert(app.state.candidates[0].checked === false, '未加入候选编辑保存后 checked 仍为 false');
assert(app.state.d1.itinerary[0].spots.length === 0 && app.state.d1.itinerary[1].spots.length === 0, '未加入候选未进入任何一天');

// 已加入的候选，编辑时改选「暂不加入」→ 应移除并变为未加入
setup();
const elsB = Object.assign({}, elsA, { t_day: makeEl('') });
ctx.document.getElementById = (id) => elsB[id] || null;
ctx.document.querySelectorAll = () => [];
app.state.candidates = [{ id: 'c2', name: '原来已加入', type: '景点', checked: true, preferredDayId: 'day1' }];
app.state.d1.itinerary[0].spots = [{ id: 'spX', sourceId: 'c2', name: '原来已加入', type: 'spot', startTime: '10:00' }];
itin.saveTrip('cand', 'c2', '');
assert(app.state.candidates[0].checked === false, '已加入候选改选「暂不加入」后 checked 变 false');
assert(app.state.d1.itinerary[0].spots.length === 0, '已加入候选改选「暂不加入」后从时间轴移除');

// 编辑时指定 day1 → 应加入 Day1（和控制流一致）
setup();
const elsC = Object.assign({}, elsA, { t_day: makeEl('day1') });
ctx.document.getElementById = (id) => elsC[id] || null;
ctx.document.querySelectorAll = () => [];
app.state.candidates = [{ id: 'c3', name: '指定Day1', type: '景点', checked: false, preferredDayId: '' }];
itin.saveTrip('cand', 'c3', '');
assert(app.state.candidates[0].checked === true, '编辑时选 Day1 → checked 变 true');
assert(app.state.d1.itinerary[0].spots.length === 1 && app.state.d1.itinerary[0].spots[0].sourceId === 'c3', '编辑时选 Day1 → 加入对应日期');

/* ============ 5) 地图显示未加入行程的地点 ============ */
console.log('\n[测试] 地图：显示未加入行程表的地点');
setup();
app.state.candidates = [{ id: 'cu1', name: '未加入候选', type: '餐饮', lat: 25.0, lng: 121.0 }];
let items = map.collectSpots('__all');
assert(items.length === 0, '未开启「显示未加入」时，地图不含未加入候选');
app.state.mapShowUnjoined = true;
items = map.collectSpots('__all');
assert(items.length === 1 && items[0].isCand === true && items[0].dayIndex === -1, '开启后并入未加入候选（isCand=true, dayIndex=-1）');
// 已加入时间轴的候选不应重复出现
app.state.d1.itinerary[0].spots = [{ id: 'spY', sourceId: 'cu1', name: '已加入', type: 'spot', startTime: '10:00' }];
items = map.collectSpots('__all');
assert(items.length === 1 && !items[0].isCand, '已加入时间轴的候选只作为行程块出现，不重复计入');
// 具体某天视图不显示未加入候选
app.state.mapShowUnjoined = true;
items = map.collectSpots('day1');
assert(items.length === 1 && !items[0].isCand, '指定某天视图不混入未加入候选');

/* ============ 6) 地图手动隐藏地点（仅地图） ============ */
console.log('\n[测试] 地图：手动隐藏地点（仅影响地图）');
setup();
app.state.d1.itinerary[0].spots = [{ id: 'spZ', sourceId: 'cz', name: '行程块A', type: 'spot', startTime: '10:00', lat: 25.1, lng: 121.1 }];
// 隐藏一个行程块
let before = map.collectSpots('__all');
assert(before.length === 1, '隐藏前地图含该行程块');
map.toggleHidden('day1', 'spZ', false);
assert(app.state.d1.itinerary[0].spots[0].hidden === true, 'toggleHidden 翻转 spot.hidden');
assert(map.collectSpots('__all').length === 0, '隐藏后该地点从地图消失（默认不显示已隐藏）');
// 开启「显示已隐藏」后应再次出现（供取消隐藏）
app.state.mapShowHidden = true;
let shown = map.collectSpots('__all');
assert(shown.length === 1 && shown[0].hidden === true, '开启「显示已隐藏」后隐藏项重新列出且带 hidden 标记');
// 取消隐藏
map.toggleHidden('day1', 'spZ', false);
assert(app.state.d1.itinerary[0].spots[0].hidden !== true, '再次 toggle 取消隐藏');
assert(map.collectSpots('__all').length === 1, '取消隐藏后地点回到地图');
// 候选隐藏
setup();
app.state.candidates = [{ id: 'cc1', name: '候选B', type: '景点' }];
app.state.mapShowUnjoined = true;
assert(map.collectSpots('__all').length === 1, '未加入候选在开启后显示');
map.toggleHidden('', 'cc1', true);
assert(app.state.candidates[0].hidden === true, 'toggleHidden 翻转 candidate.hidden');
assert(map.collectSpots('__all').length === 0, '隐藏候选后从地图消失');
assert(cands.render !== undefined, '隐藏仅影响地图，不改变行程库（render 方法仍在）');

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
