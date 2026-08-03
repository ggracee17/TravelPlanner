/*
 * 验证逐项预算逻辑 getBudgetTotal：
 *   1) 有预算项时：按货币折算成台币求和（AUD × audToTwd，TWD 原值）；
 *   2) 无预算项时：回落到整体预算 d.budget；
 *   3) 目的地缺失时返回 0。
 * 用 vm 加载真实 app.js，桩掉 DOM / 浏览器 API。
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
  return { app, ctx };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

console.log('\n[测试C] 逐项预算 getBudgetTotal');
{
  const { app } = makeClient();
  app.state = {
    destinations: [{ id: 'd1', name: 'Sydney', budget: 10000, audToTwd: 21 }],
    activeDestinationId: 'd1',
    d1: { itinerary: [], expenses: [], media: [] }
  };

  // 1) 无预算项 → 回落 d.budget
  assert(Math.abs(app.getBudgetTotal('d1') - 10000) < 1e-6, '无逐项预算时回落整体预算 ¥10000');

  // 2) 有逐项预算：TWD 5000 + AUD 100(×21=2100) = 7100，d.budget 被忽略
  app.state.d1.budgets = [
    { id: 'bg1', name: '机票预算', amount: 5000, currency: 'TWD' },
    { id: 'bg2', name: '酒店预算', amount: 100, currency: 'AUD' }
  ];
  assert(Math.abs(app.getBudgetTotal('d1') - 7100) < 1e-6, '逐项预算：¥5000 + A$100(汇率21)=¥7100，忽略 d.budget');

  // 3) 改汇率 → AUD 重新折算
  app.state.destinations[0].audToTwd = 20;
  assert(Math.abs(app.getBudgetTotal('d1') - 7000) < 1e-6, '汇率改 20：¥5000 + A$100(×20)=¥7000');

  // 4) 目的地不存在 → 0
  assert(app.getBudgetTotal('nope') === 0, '未知目的地返回 0');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
