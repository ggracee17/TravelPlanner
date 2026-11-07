/*
 * 回归：货币模型新增「人民币(CNY)」并支持「勾选保留哪些币种」隐藏 AUD/TWD。
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
  return { app };
}

const captured = { modalHtml: '' };

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log('  PASS: ' + msg); } else { failed++; console.log('  FAIL: ' + msg); } }

console.log('\n[货币工具：符号/标签/可见币种]');
{
  const { app } = makeClient();
  assert(app.modules.expenses.symOf('TWD') === '¥', 'symOf(TWD) = ¥');
  assert(app.modules.expenses.symOf('AUD') === 'A$', 'symOf(AUD) = A$');
  assert(app.modules.expenses.symOf('CNY') === 'CN¥', 'symOf(CNY) = CN¥（区分台币的 ¥）');
  assert(app.modules.expenses.labelOf('CNY') === '人民币 (CN¥)', 'labelOf(CNY) = 人民币 (CN¥)');
  assert(app.modules.expenses.shortName('CNY') === '人民币', 'shortName(CNY) = 人民币');

  const dAll = { enabledCurrencies: ['TWD', 'AUD', 'CNY'] };
  const vAll = app.modules.expenses.visibleCurrencies(dAll);
  assert(vAll.length === 3 && vAll.includes('CNY'), '默认全开时可见币种含 CNY');

  const dHideAud = { enabledCurrencies: ['TWD', 'CNY'] };
  const vHide = app.modules.expenses.visibleCurrencies(dHideAud);
  assert(!vHide.includes('AUD') && vHide.includes('CNY') && vHide.includes('TWD'), '隐藏 AUD 后可见币种为 TWD+CNY');

  const dEmpty = { enabledCurrencies: [] };
  assert(app.modules.expenses.visibleCurrencies(dEmpty).join() === 'TWD', '空列表回落到至少 TWD');

  const dNoField = {};
  assert(app.modules.expenses.visibleCurrencies(dNoField).length === 3, '无 enabledCurrencies 字段时默认全开');
}

console.log('\n[消费/预算货币下拉含 CNY 且受可见币种控制]');
{
  const { app } = makeClient();
  app.state = {
    destinations: [{ id: 'd1', name: 'Taipei', budget: 10000, audToTwd: 21, cnyToTwd: 4.5 }],
    activeDestinationId: 'd1',
    d1: { itinerary: [], media: [], expenses: [] }
  };
  app.modules.expenses.openForm();
  const eHtml = captured.modalHtml;
  assert(eHtml.includes('人民币 (CN¥)'), '消费货币下拉含「人民币 (CN¥)」');
  assert(eHtml.includes('台币 (NT$)') && eHtml.includes('澳币 (A$)'), '消费货币下拉含台币与澳币');

  app.modules.expenses.openBudgetForm();
  const bHtml = captured.modalHtml;
  assert(bHtml.includes('人民币 (CN¥)'), '预算货币下拉含「人民币 (CN¥)」');

  // 隐藏 AUD 后，消费下拉不应再出现澳币选项
  app.state.destinations[0].enabledCurrencies = ['TWD', 'CNY'];
  app.modules.expenses.openForm();
  const eHide = captured.modalHtml;
  assert(!eHide.includes('澳币 (A$)'), '隐藏 AUD 后消费货币下拉不含澳币');
  assert(eHide.includes('人民币 (CN¥)') && eHide.includes('台币 (NT$)'), '隐藏 AUD 后仍含台币与人民币');
}

console.log('\n[折算：CNY 计入台币总额]');
{
  const { app } = makeClient();
  app.state = {
    destinations: [{ id: 'd1', name: 'Taipei', budget: 10000, audToTwd: 21, cnyToTwd: 4.5, travelers: 1 }],
    d1: { itinerary: [], media: [], expenses: [
      { id: 'e1', currency: 'TWD', amount: 100, priceType: 'per', date: '2026-01-01', detail: 'x' },
      { id: 'e2', currency: 'CNY', amount: 100, priceType: 'per', date: '2026-01-01', detail: 'y' }, // 100*4.5=450
      { id: 'e3', currency: 'AUD', amount: 10, priceType: 'per', date: '2026-01-01', detail: 'z' }   // 10*21=210
    ] }
  };
  const total = app.getExpensesTotal('d1');
  assert(Math.abs(total - (100 + 450 + 210)) < 1e-6, 'CNY/AUD/TWD 混合合计 = 760 台币（实得 ' + total + '）');

  // 缺 cnyToTwd 时回落默认 4.5
  delete app.state.destinations[0].cnyToTwd;
  const t2 = app.getExpensesTotal('d1');
  assert(Math.abs(t2 - 760) < 1e-6, '缺 cnyToTwd 回落默认 4.5：仍为 760');
}

console.log('\n[预算总额同样支持 CNY]');
{
  const { app } = makeClient();
  app.state = {
    destinations: [{ id: 'd1', name: 'Taipei', budget: 0, audToTwd: 21, cnyToTwd: 4.5, travelers: 1 }],
    d1: { itinerary: [], media: [], budgets: [
      { id: 'bg1', name: '餐饮', amount: 200, currency: 'CNY', priceType: 'per' }, // 200*4.5=900
      { id: 'bg2', name: '酒店', amount: 100, currency: 'AUD', priceType: 'per' }  // 100*21=2100
    ] }
  };
  const bt = app.getBudgetTotal('d1');
  assert(Math.abs(bt - 3000) < 1e-6, '预算总额 CNY+AUD = 3000 台币（实得 ' + bt + '）');
}

console.log('\n[fmtTwd 双币展示尊重可见币种]');
{
  const { app } = makeClient();
  const dAudOnly = { audToTwd: 21, cnyToTwd: 4.5, enabledCurrencies: ['TWD', 'AUD'] };
  const s1 = app.modules.expenses.fmtTwd(210, dAudOnly);
  assert(s1.includes('¥210') && s1.includes('A$10') && !s1.includes('CN¥'), '仅 AUD 可见：¥210（≈ A$10），不含 CN¥');

  const dAll = { audToTwd: 21, cnyToTwd: 4.5, enabledCurrencies: ['TWD', 'AUD', 'CNY'] };
  const s2 = app.modules.expenses.fmtTwd(210, dAll);
  assert(s2.includes('A$10') && s2.includes('CN¥'), 'AUD+CNY 可见：同时标注 A$ 与 CN¥');

  const dTwdOnly = { audToTwd: 21, cnyToTwd: 4.5, enabledCurrencies: ['TWD'] };
  const s3 = app.modules.expenses.fmtTwd(210, dTwdOnly);
  assert(s3 === '¥210', '仅 TWD 可见：只有 ¥210，无括号等价');
}

console.log('\n[保存汇率/可见币种写入目的地]');
{
  const { app } = makeClient();
  app.state = {
    destinations: [{ id: 'd1', name: 'Taipei', budget: 10000, audToTwd: 21 }],
    activeDestinationId: 'd1',
    d1: { itinerary: [], media: [], expenses: [] }
  };
  // saveCnyRate
  app.modules.expenses.saveCnyRate = function (val) {
    const d = app.getActiveDestination();
    d.cnyToTwd = parseFloat(val);
  };
  app.modules.expenses.saveCnyRate('4.6');
  assert(Math.abs(app.state.destinations[0].cnyToTwd - 4.6) < 1e-9, 'saveCnyRate 写入 d.cnyToTwd=4.6');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
