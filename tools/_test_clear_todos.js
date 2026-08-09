/*
 * 验证用户需求（消息15 - 子需求3）：任务列表太长，能「清除已完成」的待办，使其不再显示。
 *   - clearCompletedTodos：删除所有 done=true 的待办（带二次确认）；
 *   - 没有已完成项时给出提示且不改动列表。
 * 用 vm 加载真实 app.js + module-checklists.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CK_SRC = fs.readFileSync(path.join(ROOT, 'module-checklists.js'), 'utf8');

function makeClient(confirmRet) {
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => confirmRet, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
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

const { app } = makeClient(true);
let toasts = [];
app.toast = (msg, type) => { toasts.push({ msg: msg || '', type }); };

console.log('\n[测试] 清除已完成待办');
{
  app.state.checklists = {
    documents: [], luggage: [],
    todos: [
      { id: 't1', name: '买机票', detail: '', done: true },
      { id: 't2', name: '订酒店', detail: '', done: false },
      { id: 't3', name: '办签证', detail: '', done: true }
    ]
  };
  app.modules.checklists.clearCompletedTodos();
  assert(app.state.checklists.todos.length === 1, '已完成项(2条)被清除，仅剩未完成的 1 条');
  assert(app.state.checklists.todos[0].id === 't2', '剩下的待办是未完成的那条');
  assert(toasts.some(t => /已清除 2 条/.test(t.msg)), '提示已清除 2 条');
}

console.log('\n[测试] 没有已完成项 → 不改动且提示');
{
  app.state.checklists.todos = [{ id: 't1', name: 'A', detail: '', done: false }];
  toasts = [];
  app.modules.checklists.clearCompletedTodos();
  assert(app.state.checklists.todos.length === 1, '无已完成项时列表不变');
  assert(toasts.some(t => /没有已完成的待办事项/.test(t.msg)), '提示没有已完成项');
}

console.log('\n[测试] 取消确认 → 不清除');
{
  const { app: app2 } = makeClient(false); // confirm 返回 false
  app2.state.checklists = {
    todos: [
      { id: 'a', name: 'X', detail: '', done: true },
      { id: 'b', name: 'Y', detail: '', done: false }
    ]
  };
  app2.modules.checklists.clearCompletedTodos();
  assert(app2.state.checklists.todos.length === 2, '确认取消时不清除任何项');
}

console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
process.exit(failed ? 1 : 0);
