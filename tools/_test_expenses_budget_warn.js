/*
 * 回归：预算占用「提醒」条里的百分比必须被正确插值，不能原样显示模板字符串 ${pct.toFixed(0)}%。
 * 触发条件：pct ∈ [80,100)。用 vm 加载真实 app.js + module-expenses.js + module-i18n.js，桩掉 DOM。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const EXP_SRC = fs.readFileSync(path.join(ROOT, 'module-expenses.js'), 'utf8');
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'module-i18n.js'), 'utf8');

function makeClient() {
  const sec = { _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
  const document = {
    querySelector: (sel) => (sel === '[data-section=expenses]' ? sec : null),
    getElementById: () => null, addEventListener: () => {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} },
    querySelectorAll: () => []
  };
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null, I18N: undefined },
    document,
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;', ctx);
  vm.runInContext(EXP_SRC, ctx);
  vm.runInContext(I18N_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.renderAll = () => {};
  app.closeModal = () => {};
  app.toast = () => {};
  app.saveState = () => {};
  return { app, sec };
}

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log('  PASS: ' + msg); } else { failed++; console.log('  FAIL: ' + msg); } }

console.log('\n[预算「提醒」条百分比必须插值，不能显示原始模板字符串]');
{
  const { app, sec } = makeClient();
  // 预算 10000；花费 8500 TWD（travelers=1，无 priceType → 不翻倍）→ pct = 85% ∈ [80,100)，触发琥珀色提醒
  app.state = {
    destinations: [{ id: 'd1', name: 'Sydney', budget: 10000, audToTwd: 21, travelers: 1 }],
    activeDestinationId: 'd1',
    d1: {
      itinerary: [], media: [],
      expenses: [{ id: 'e1', name: '机票', category: '交通', currency: 'TWD', amount: 8500, date: '2026-01-01' }]
    }
  };
  app.modules.expenses.render();
  const html = sec.innerHTML || '';
  assert(html.includes('预算已使用 85%'), '提醒条显示插值后的真实百分比「预算已使用 85%」');
  assert(!html.includes('${pct.toFixed(0)}%'), '提醒条不再原样显示模板字符串 ${pct.toFixed(0)}%');
}

console.log('\n[对照：pct < 80% 时不出现该提醒条]');
{
  const { app, sec } = makeClient();
  app.state = {
    destinations: [{ id: 'd1', name: 'Sydney', budget: 10000, audToTwd: 21, travelers: 1 }],
    activeDestinationId: 'd1',
    d1: {
      itinerary: [], media: [],
      expenses: [{ id: 'e1', name: '机票', category: '交通', currency: 'TWD', amount: 5000, date: '2026-01-01' }]
    }
  };
  app.modules.expenses.render();
  const html = sec.innerHTML || '';
  assert(!html.includes('预算已使用') || !html.includes('请注意控制消费'), 'pct=50% 时不显示「请注意控制消费」提醒');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
