/*
 * 验证新的计价模型：
 *   - 每条记录有 priceType：'per'(单人价格×本次旅行人数 travelers) / 'total'(总价不再乘人数)；
 *   - 旧数据无 priceType 时回落原 people 乘数（向后兼容）；
 *   - 总预算/总支出显示「N 人总金额」与「每人价格 = 总额 / travelers」。
 *   - 旅行设置：saveTravelers 改人数、addPerson/removePerson 维护出行人名单（驱动付款人下拉）。
 * 用 vm 加载真实 app.js + module-expenses.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const EXP_SRC = fs.readFileSync(path.join(ROOT, 'module-expenses.js'), 'utf8');

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
  vm.runInContext(EXP_SRC, ctx);
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
const exp = app.modules.expenses;

// 准备带 travelers 与 priceType 的目的地数据
app.state = {
  destinations: [{ id: 'd1', name: 'Tokyo', audToTwd: 21, travelers: 2, tripPeople: ['我', '伴侣'] }],
  activeDestinationId: 'd1',
  d1: {
    expenses: [
      { id: 'e1', amount: 700, currency: 'TWD', priceType: 'per', detail: '机票', date: '2026-01-01' },     // 700 × 2 = 1400
      { id: 'e2', amount: 100, currency: 'AUD', priceType: 'total', detail: '套票', date: '2026-01-01' },  // 100 × 21 = 2100（不乘人数）
      { id: 'e3', amount: 500, currency: 'TWD', detail: '旧数据', date: '2026-01-01' }                       // 无 priceType，people 默认 1 → 500
    ],
    budgets: [
      { id: 'b1', name: '机票', amount: 700, currency: 'TWD', priceType: 'per' },   // 700 × 2 = 1400
      { id: 'b2', name: '酒店', amount: 200, currency: 'AUD', priceType: 'total' }   // 200 × 21 = 4200
    ]
  }
};

console.log('\n[测试A] 计价模型：per / total / 旧数据回落');
{
  const expTotal = app.getExpensesTotal('d1');
  assert(expTotal === 1400 + 2100 + 500, `getExpensesTotal = 4000（per×2 + total + 旧people1），实际 ${expTotal}`);
  const budTotal = app.getBudgetTotal('d1');
  assert(budTotal === 1400 + 4200, `getBudgetTotal = 5600（per×2 + total），实际 ${budTotal}`);
}

console.log('\n[测试B] 每人均价 = 总额 / 旅行人数');
{
  const expTotal = app.getExpensesTotal('d1');
  const budTotal = app.getBudgetTotal('d1');
  assert(expTotal / 2 === 2000, `支出每人价 = 2000，实际 ${expTotal / 2}`);
  assert(budTotal / 2 === 2800, `预算每人价 = 2800，实际 ${budTotal / 2}`);
}

console.log('\n[测试C] 旅行人数变化后 per 项随之重算');
{
  const before = app.getExpensesTotal('d1');
  app.state.destinations[0].travelers = 4;
  const after = app.getExpensesTotal('d1');
  // e1 由 1400(×2) 变 2800(×4)；e2/e3 不变 → +1400
  assert(after - before === 1400, `人数 2→4，支出 +1400（仅 per 项变），实际 +${after - before}`);
  app.state.destinations[0].travelers = 2; // 复原
}

console.log('\n[测试D] 旧数据回落：无 priceType 时使用原 people 乘数');
{
  app.state.d1.expenses.push({ id: 'e4', amount: 300, currency: 'TWD', people: 3, detail: '旧3人', date: '2026-01-01' });
  const t = app.getExpensesTotal('d1');
  // 原 4000 + 300×3 = 4900
  assert(t === 4900, `旧数据 people=3 生效（300×3），实际 ${t}`);
  app.state.d1.expenses.pop();
}

console.log('\n[测试E] 旅行设置：人数与出行人名单');
{
  // saveTravelers
  exp.saveTravelers('3');
  assert(app.state.destinations[0].travelers === 3, 'saveTravelers 写入 travelers=3');
  app.state.destinations[0].travelers = 2;

  // addPerson：把 document.getElementById('expNewPerson') 桩成返回指定名字
  ctx.document.getElementById = (id) => (id === 'expNewPerson' ? { value: '朋友' } : null);
  const before = app.state.destinations[0].tripPeople.length;
  exp.addPerson();
  assert(app.state.destinations[0].tripPeople.includes('朋友'), 'addPerson 把「朋友」加入出行人名单');
  assert(app.state.destinations[0].tripPeople.length === before + 1, '出行人名单长度 +1');

  // removePerson(0) 移除第一个
  const first = app.state.destinations[0].tripPeople[0];
  exp.removePerson(0);
  assert(!app.state.destinations[0].tripPeople.includes(first), `removePerson(0) 移除了「${first}」`);
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
