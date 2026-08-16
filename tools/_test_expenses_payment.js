/*
 * 回归：消费明细「支付方式」下拉需包含 AMEX / UP / 2UP / CommBank / Wise 五个选项。
 * 用 vm 加载真实 app.js + module-expenses.js + module-i18n.js，桩掉 DOM / 浏览器 API。
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
  const document = {
    querySelector: () => null, getElementById: () => null, addEventListener: () => {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} },
    querySelectorAll: () => []
  };
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false }, google: null, I18N: undefined },
    document,
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout: () => {}, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;', ctx);
  vm.runInContext(EXP_SRC, ctx);
  vm.runInContext(I18N_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.renderAll = () => {}; app.closeModal = () => {}; app.toast = () => {}; app.saveState = () => {};
  app.openModal = (title, h) => { captured.modalHtml = h; }; app.modules.expenses.updatePreview = () => {};
  return { app, captured };
}

const captured = { modalHtml: '' };

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log('  PASS: ' + msg); } else { failed++; console.log('  FAIL: ' + msg); } }

console.log('\n[消费明细「支付方式」下拉选项]');
{
  const { app } = makeClient();
  app.state = {
    destinations: [{ id: 'd1', name: 'Sydney', budget: 10000, audToTwd: 21 }],
    activeDestinationId: 'd1',
    d1: { itinerary: [], media: [], expenses: [] }
  };
  app.modules.expenses.openForm();
  const html = captured.modalHtml;
  const expected = ['AMEX', 'UP', '2UP', 'CommBank', 'Wise'];
  expected.forEach(opt => {
    assert(html.includes('>' + opt + '<'), '支付方式下拉含选项「' + opt + '」');
  });
  // 原选项不应丢失
  ['现金', '信用卡', '支付宝', '微信', 'Apple Pay', '外币', '其他'].forEach(opt => {
    assert(html.includes('>' + opt + '<'), '原有选项「' + opt + '」仍保留');
  });
  // 选中已有值（如 AMEX）时该项应 selected
  app.modules.expenses.openForm({ payment: 'AMEX' });
  const amexSelected = captured.modalHtml;
  assert(amexSelected.includes('selected>AMEX'), '已有支付方式为 AMEX 时该项被选中');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
