/*
 * 验证用户本轮 3 项需求（消息7）：
 *   1) 从行程表移除行程后，行程库对应候选标记「未加入」（checked=false）；
 *      若该候选仍出现在其它日期（共享源），则不取消勾选。
 *   2) 待办事项卡片置顶到核对清单最上方；「行前核对清单」改名为「核对清单」。
 *   3) 行程库「餐厅」分类改为「餐饮」（含地图分类标签）。
 * 用 vm 加载真实 app.js + 各模块，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
const CAND_SRC = fs.readFileSync(path.join(ROOT, 'module-candidates.js'), 'utf8');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8') +
  '\n;globalThis.CATEGORY_LABELS = CATEGORY_LABELS;';
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'module-i18n.js'), 'utf8');

function makeClient() {
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null, I18N: undefined },
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
  vm.runInContext(I18N_SRC, ctx);
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
const itin = app.modules.itinerary;
const cands = app.modules.candidates;
const map = app.modules.map;

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

/* ===== 1) 从行程表移除 → 候选库标记未加入 ===== */
console.log('\n[测试] 从行程表移除后，行程库候选标记为未加入');
setup();
app.state.candidates = [{ id: 'c1', name: '某餐厅', type: '餐饮', checked: true }];
app.state.d1.itinerary[0].spots = [{ id: 'sp1', sourceId: 'c1', name: '某餐厅', type: 'restaurant', startTime: '10:00' }];
itin.deleteTrip('day1', 'sp1');
assert(app.state.d1.itinerary[0].spots.length === 0, 'Day1 上的行程块已被移除');
assert(app.state.candidates[0].checked === false, '候选 c1 的 checked 变为 false（未加入行程）');

// 共享同一候选（两个日期都有），仅移除其中一天 → 仍应标记已加入
setup();
app.state.candidates = [{ id: 'c2', name: '共享项', type: '餐饮', checked: true }];
app.state.d1.itinerary[0].spots = [{ id: 'spA', sourceId: 'c2', name: '共享项', type: 'restaurant', startTime: '10:00' }];
app.state.d1.itinerary[1].spots = [{ id: 'spB', sourceId: 'c2', name: '共享项', type: 'restaurant', startTime: '14:00' }];
itin.deleteTrip('day1', 'spA');
assert(app.state.d1.itinerary[0].spots.length === 0, 'Day1 上的 spA 被移除');
assert(app.state.d1.itinerary[1].spots.length === 1, 'Day2 上的 spB 仍保留');
assert(app.state.candidates[0].checked === true, '候选 c2 仍在 Day2，checked 保持 true（共享源不误取消）');

/* ===== 2) removeFromItinerary → 不再出现在任何天则标记未加入 ===== */
console.log('\n[测试] removeFromItinerary 后候选标记未加入');
setup();
app.state.candidates = [{ id: 'c3', name: '将被取消勾选', type: '餐饮', checked: true }];
app.state.d1.itinerary[0].spots = [{ id: 'spC', sourceId: 'c3', name: '将被取消勾选', type: 'restaurant', startTime: '10:00' }];
cands.removeFromItinerary('c3');
assert(app.state.d1.itinerary[0].spots.length === 0, '候选 c3 的行程块已从时间轴移除');
assert(app.state.candidates[0].checked === false, '候选 c3 不再出现在任何天，checked 变 false');

/* ===== 3) i18n 改名：行前核对清单 → 核对清单 ===== */
console.log('\n[测试] i18n：核对清单改名');
assert(app.t('nav.checklist') === '✅ 3·核对清单', 'nav.checklist = 「✅ 3·核对清单」');
assert(app.t('checklist.title') === '✅ 板块3 · 核对清单', 'checklist.title = 「✅ 板块3 · 核对清单」');
assert(!app.t('nav.checklist').includes('行前'), 'nav.checklist 不再含「行前」');

/* ===== 4) 地图分类标签 餐厅 → 餐饮 ===== */
console.log('\n[测试] 地图：restaurant 分类标签改为「餐饮」');
assert(ctx.CATEGORY_LABELS.restaurant === '餐饮', 'CATEGORY_LABELS.restaurant = 「餐饮」');

/* ===== 5) 行程库「餐饮」分类（无「餐厅」残留） ===== */
console.log('\n[测试] 行程库分类使用「餐饮」');
const candSrc = fs.readFileSync(path.join(ROOT, 'module-candidates.js'), 'utf8');
assert(candSrc.includes("'餐饮'") && !candSrc.includes("'餐厅'"), 'module-candidates.js 使用「餐饮」且无「餐厅」残留');

/* ===== 6) 待办事项卡片置顶（结构顺序：todo 在 docs 之前） ===== */
console.log('\n[测试] 核对清单：待办事项卡片置顶');
const clSrc = fs.readFileSync(path.join(ROOT, 'module-checklists.js'), 'utf8');
const todoIdx = clSrc.indexOf("📋 ${app.t('todo.title')}");
const docsIdx = clSrc.indexOf("app.t('checklist.docsTitle')");
assert(todoIdx >= 0 && docsIdx >= 0 && todoIdx < docsIdx, '待办事项卡片排在证件清单卡片之前（置顶）');

console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
process.exit(failed ? 1 : 0);
