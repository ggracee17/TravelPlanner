/*
 * 验证待办事项（板块3 第三张卡片）：
 *   1) ensureChecklists 兜底创建 todos 数组（默认空，不覆盖已有）；
 *   2) normalizeState 把非数组/缺失的 todos 还原为数组；
 *   3) toggleTodo 翻转 done；saveTodo / removeTodo 增删（经 app.state）。
 * 用 vm 加载真实 app.js + module-checklists.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CK_SRC = fs.readFileSync(path.join(ROOT, 'module-checklists.js'), 'utf8');

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
  vm.runInContext(CK_SRC, ctx);
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

console.log('\n[测试] 待办事项数据模型');
app.state.checklists = { documents: [], luggage: [] };
app.ensureChecklists();
assert(Array.isArray(app.state.checklists.todos), 'ensureChecklists 创建 todos 数组');
assert(app.state.checklists.todos.length === 0, 'todos 默认空（不注入默认值）');

console.log('\n[测试] normalizeState 兜底 todos');
const fixed = app.normalizeState({ destinations: [], checklists: { documents: [], luggage: [] }, searchHistory: [] });
assert(Array.isArray(fixed.checklists.todos), '缺失 todos → 归一为数组');
const fixed2 = app.normalizeState({ destinations: [], checklists: { documents: [], luggage: [], todos: { 0: { id: 'x', name: '坏数据' } } }, searchHistory: [] });
assert(Array.isArray(fixed2.checklists.todos) && fixed2.checklists.todos.length === 1, 'todos 为对象 → 还原为数组(保留项)');

console.log('\n[测试] saveTodo / toggleTodo / removeTodo');
// 直接构造一个待办，验证 toggleTodo 翻转 done
app.state.checklists.todos = [{ id: 'td_1', name: '预约博物馆', detail: '提前3天', done: false }];
app.modules.checklists.toggleTodo('td_1', true);
assert(app.state.checklists.todos[0].done === true, 'toggleTodo 置为已完成');
app.modules.checklists.toggleTodo('td_1', false);
assert(app.state.checklists.todos[0].done === false, 'toggleTodo 取消已完成');
// removeTodo（confirm 桩返回 true）
const before = app.state.checklists.todos.length;
app.modules.checklists.removeTodo('td_1');
assert(app.state.checklists.todos.length === before - 1, 'removeTodo 删除该待办');

// saveTodo 经 DOM：桩 ctx.document.getElementById 返回待办字段；其余 id 返回 null（让 toast/closeModal 等安全跳过 DOM 操作）
ctx.document.getElementById = (id) => {
  const v = { td_name: '买伴手礼', td_detail: '机场免税店', td_done: { checked: true } };
  if (id in v) return { value: v[id], checked: v[id].checked, focus() {} };
  return null;
};
app.modules.checklists.saveTodo('');
const added = app.state.checklists.todos[app.state.checklists.todos.length - 1];
assert(added.name === '买伴手礼' && added.detail === '机场免税店' && added.done === true, 'saveTodo 新增待办（名称/详情/完成）');

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
