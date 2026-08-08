/*
 * 验证用户消息2 的改动：
 *   1) 行程分类：新增「活动」(activity)；「餐厅」→「餐饮」(ITIN_TYPES / 中英映射 / candidates TYPE_KEY)；
 *   2) 每日营业时间：effectiveHours 按星期取 dailyHours，否则回退通用营业时间；
 *   3) 行程库新增项默认不加入行程表：addToItinerary 仅在勾选时加入，且按 preferredDayId 入对应日期，
 *      并复制 dailyHours。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-candidates.js，桩掉 DOM / 浏览器 API。
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
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

const { app, ctx } = makeClient();

console.log('\n[测试] 行程分类：新增「活动」+「餐厅」→「餐饮」');
const T = ctx.ITIN_TYPES;
assert(T.activity && T.activity.label === '活动' && T.activity.cls === 'blk-activity', 'ITIN_TYPES 含 activity（label=活动）');
assert(T.restaurant && T.restaurant.label === '餐饮', 'restaurant 的 label 改为「餐饮」');
assert(ctx.CN_TO_ITIN_KEY['活动'] === 'activity', 'CN_TO_ITIN_KEY 含 活动→activity');
assert(ctx.CN_TO_ITIN_KEY['餐饮'] === 'restaurant', 'CN_TO_ITIN_KEY 含 餐饮→restaurant');
assert(ctx.ITIN_KEY_TO_CN['activity'] === '活动', 'ITIN_KEY_TO_CN 含 activity→活动');
assert(ctx.ITIN_KEY_TO_CN['restaurant'] === '餐饮', 'ITIN_KEY_TO_CN 含 restaurant→餐饮');
assert(!ctx.CN_TO_ITIN_KEY['餐厅'], '旧 key「餐厅」已从映射中移除');

console.log('\n[测试] 每日营业时间：effectiveHours');
const itin = app.modules.itinerary;
const sGen = { hoursSegments: [{ open: '09:00', close: '22:00' }] };
const sDaily = { hoursSegments: [{ open: '09:00', close: '22:00' }], dailyHours: { '1': [{ open: '10:00', close: '18:00' }] } };
const gen = itin.effectiveHours(sGen, 1);
assert(gen.length === 1 && gen[0].open === '09:00', '通用营业时间（无 dailyHours）按 wd 回退到 hoursSegments');
const daily = itin.effectiveHours(sDaily, 1); // 周一
assert(daily.length === 1 && daily[0].open === '10:00' && daily[0].close === '18:00', '周一取 dailyHours[1] = 10:00~18:00');
const dailyOther = itin.effectiveHours(sDaily, 3); // 周三（无单独设置）
assert(dailyOther.length === 1 && dailyOther[0].open === '09:00', '周三（dailyHours 无该键）回退通用 09:00~22:00');

console.log('\n[测试] 行程库新增项默认不加入；addToItinerary 按 preferredDayId 加入并复制 dailyHours');
// 构造目的地 + 两天日程
app.state.destinations = [{ id: 'd1', name: '测试目的地', startDate: '2026-08-01', endDate: '2026-08-03' }];
app.state.activeDestinationId = 'd1';
app.state.d1 = { itinerary: [
  { id: 'day1', date: '2026-08-01', spots: [] },
  { id: 'day2', date: '2026-08-02', spots: [] }
] };
app.state.candidates = [];
// 模拟「新增行程库项目」saveTrip 产出的候选：checked=false，仅记录 preferredDayId
const cand = {
  id: 'c1', name: '夏日音乐节', type: '活动', durationH: 3, checked: false, preferredDayId: 'day2',
  dailyHours: { '6': [{ open: '14:00', close: '22:00' }], '0': [{ open: '14:00', close: '22:00' }] },
  hoursSegments: [{ open: '09:00', close: '22:00' }]
};
app.state.candidates.push(cand);
// 创建后尚未勾选：两天都不应包含该候选
assert(app.state.d1.itinerary[0].spots.length === 0 && app.state.d1.itinerary[1].spots.length === 0,
  '新增候选后默认【未】加入行程表（两天均空）');
// 用户勾选 → addToItinerary
const ok = app.modules.candidates.addToItinerary(cand);
assert(ok === true, 'addToItinerary 返回成功');
assert(app.state.d1.itinerary[1].spots.length === 1, '勾选后加入「偏好日期」day2');
assert(app.state.d1.itinerary[0].spots.length === 0, '未加入非偏好日期 day1');
const placed = app.state.d1.itinerary[1].spots[0];
assert(placed.type === 'activity', '加入的块分类为 activity');
assert(placed.sourceId === 'c1', '块与候选通过 sourceId 关联');
assert(placed.dailyHours && placed.dailyHours['6'] && placed.dailyHours['6'][0].open === '14:00',
  '块的 dailyHours 从候选复制（周末 14:00~22:00）');
// 取消勾选 → 移除
app.modules.candidates.removeFromItinerary('c1');
assert(app.state.d1.itinerary[1].spots.length === 0, '取消勾选后从行程表移除');

console.log('\n[测试] 每日营业时间区：默认折叠，展开后才显示（消息4）');
const htmlEmpty = itin._commonFields({});
assert(htmlEmpty.includes('<details class="dh-details"'), '每日营业时间区使用 <details> 折叠容器');
assert(!htmlEmpty.includes('dh-details" open') && !htmlEmpty.includes('dh-details open'), '无每日营业时间数据时，默认【折叠】（无 open 属性）');
// 折叠时内部 DOM 仍需存在，否则 saveTrip 收集不到
assert(htmlEmpty.includes('id="t_daily_hours"'), '折叠时 #t_daily_hours 容器仍在 DOM 中');
const rowsEmpty = (htmlEmpty.match(/data-dh="/g) || []).length;
assert(rowsEmpty === 7, `折叠时 7 个星期行（data-dh）仍在 DOM 中（实际 ${rowsEmpty}）`);

const htmlWith = itin._commonFields({ dailyHours: { '1': [{ open: '10:00', close: '18:00' }] } });
assert(htmlWith.includes('<details class="dh-details" open>'), '已设置每日营业时间时，默认【展开】（带 open 属性）');
const rowsWith = (htmlWith.match(/data-dh="/g) || []).length;
assert(rowsWith === 7, `展开时 7 个星期行（data-dh）均在 DOM 中（实际 ${rowsWith}）`);

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
