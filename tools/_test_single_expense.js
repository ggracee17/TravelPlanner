/*
 * 仿真测试：消费「仅我一人」(single) 不按旅行人数翻倍
 * 用 vm 加载真实 app.js，桩掉 DOM / 浏览器 API，直接校验 getExpensesTotal。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function makeClient() {
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null },
    document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.modules = app.modules || {};
  app.state = {
    destinations: [{ id: 'd1', name: 'Sydney', startDate: '2026-02-01', endDate: '2026-02-03', budget: 10000, audToTwd: 21, travelers: 2 }],
    activeDestinationId: 'd1',
    d1: { expenses: [] }
  };
  return { app };
}

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  PASS: ' + m); } else { failed++; console.log('  FAIL: ' + m); } }

console.log('\n[测试] 仅我一人(single) 不按旅行人数翻倍（2 人旅行）');
{
  const { app } = makeClient();

  // 仅我 ¥700 + 普通单人价 ¥700×2 = 2100
  app.state.d1.expenses = [
    { id: 'e1', currency: 'TWD', amount: 700, priceType: 'per', single: true },
    { id: 'e2', currency: 'TWD', amount: 700, priceType: 'per' }
  ];
  assert(Math.abs(app.getExpensesTotal('d1') - 2100) < 1e-6, '仅我¥700 + 普通¥700×2 = ¥2100 (实际 ' + app.getExpensesTotal('d1') + ')');

  // 仅我 A$100 → 只算 ¥2100，不×2
  app.state.d1.expenses = [{ id: 'e1', currency: 'AUD', amount: 100, priceType: 'per', single: true }];
  assert(Math.abs(app.getExpensesTotal('d1') - 2100) < 1e-6, '仅我 A$100 = ¥2100（不×2，实际 ' + app.getExpensesTotal('d1') + '）');

  // single 与 total 都 mult=1
  app.state.d1.expenses = [{ id: 'e1', currency: 'TWD', amount: 700, priceType: 'total', single: true }];
  assert(Math.abs(app.getExpensesTotal('d1') - 700) < 1e-6, '仅我+总价 仍为 ¥700 (实际 ' + app.getExpensesTotal('d1') + ')');

  // single 覆盖旧 people 乘数
  app.state.d1.expenses = [{ id: 'e1', currency: 'TWD', amount: 700, people: 3, single: true }];
  assert(Math.abs(app.getExpensesTotal('d1') - 700) < 1e-6, '仅我 覆盖旧 people 乘数 = ¥700 (实际 ' + app.getExpensesTotal('d1') + ')');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
