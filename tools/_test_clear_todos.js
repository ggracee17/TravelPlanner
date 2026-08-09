/*
 * 验证用户需求（消息16 - 子需求1）：把已完成的待办「归档」而非删除。
 *   - archiveCompletedTodos：把 done=true 的待办移入 archived（不删除），缩短待办列表；
 *   - restoreTodo：把归档项移回待办（保持已完成状态）；
 *   - deleteArchived / clearArchive：永久删除（带二次确认）；
 *   - 无已完成项时归档按钮不出现、归档为空。
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

console.log('\n[测试] 归档已完成（移入 archived，不删除）');
{
  app.state.checklists = {
    documents: [], luggage: [],
    todos: [
      { id: 't1', name: '买机票', detail: '', done: true },
      { id: 't2', name: '订酒店', detail: '', done: false },
      { id: 't3', name: '办签证', detail: '需要材料', done: true }
    ],
    archived: []
  };
  app.modules.checklists.archiveCompletedTodos();
  assert(app.state.checklists.todos.length === 1, '待办列表仅剩未完成的 1 条');
  assert(app.state.checklists.todos[0].id === 't2', '剩下的是未完成项');
  assert(app.state.checklists.archived.length === 2, '2 条已完成被移入 archived');
  assert(app.state.checklists.archived.find(x => x.id === 't3') && app.state.checklists.archived.find(x => x.id === 't3').detail === '需要材料', '归档项保留详情字段');
  assert(toasts.some(t => /归档/.test(t.msg) && /2 条/.test(t.msg)), '提示已归档 2 条');
}

console.log('\n[测试] 移出归档 → 回到待办（保持已完成）');
{
  const arch = app.state.checklists.archived.find(x => x.id === 't1');
  app.modules.checklists.restoreTodo('t1');
  assert(app.state.checklists.archived.find(x => x.id === 't1') === undefined, 't1 已移出归档');
  const back = app.state.checklists.todos.find(x => x.id === 't1');
  assert(back && back.done === true, '移出后保持已完成状态');
}

console.log('\n[测试] 永久删除单条归档 / 清空归档');
{
  // 重新归档一条用于后续清空测试
  app.modules.checklists.archiveCompletedTodos();
  const before = app.state.checklists.archived.length;
  app.modules.checklists.deleteArchived(app.state.checklists.archived[0].id);
  assert(app.state.checklists.archived.length === before - 1, '单条归档被永久删除');
  // 清空归档（confirm 返回 true）
  app.modules.checklists.clearArchive();
  assert(app.state.checklists.archived.length === 0, '清空归档后 archived 为空');
}

console.log('\n[测试] 无已完成项 → 不动作');
{
  const { app: app2 } = makeClient(false);
  app2.state.checklists = { documents: [], luggage: [], todos: [{ id: 'a', name: 'X', detail: '', done: false }], archived: [] };
  let called = false;
  app2.toast = () => { called = true; };
  app2.modules.checklists.archiveCompletedTodos();
  assert(app2.state.checklists.archived.length === 0, '无已完成项时 archived 不变');
  assert(called, '无已完成项时给出提示');
}

console.log('\n[测试] 取消确认 → 不清空归档');
{
  const { app: app3 } = makeClient(false); // confirm 返回 false
  app3.state.checklists = { documents: [], luggage: [], todos: [], archived: [{ id: 'z', name: 'Z', done: true }] };
  app3.modules.checklists.clearArchive();
  assert(app3.state.checklists.archived.length === 1, '确认取消时清空归档被取消');
}

console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`);
process.exit(failed ? 1 : 0);
