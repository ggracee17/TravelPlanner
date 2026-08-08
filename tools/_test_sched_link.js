/*
 * 仿真测试：行程块表单 开始/时长/结束 时间联动 onSchedChange
 *   - 改「开始」或「时长」→ 结束 = 开始 + 时长（封顶 23:55）
 *   - 改「结束」→ 时长 = 结束 - 开始（结束早于开始则不更新）
 * 用 vm 加载真实 app.js + module-itinerary.js，桩掉 DOM（仅提供 t_start/t_dur/t_end 三个 mock 元素）。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');

function makeClient() {
  const els = { t_start: { value: '09:00' }, t_dur: { value: '2' }, t_end: { value: '' } };
  const ctx = {
    window: {},
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {},
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }
    },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(APP_SRC + '\n;globalThis.app = app;', ctx);
  vm.runInContext(ITIN_SRC, ctx);
  ctx.app.modules = ctx.app.modules || {};
  return { app: ctx.app, els };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

console.log('\n[测试] 行程块 开始/时长/结束 联动 onSchedChange');
{
  const { app, els } = makeClient();

  // 改「时长」→ 结束 = 开始 + 时长
  els.t_start.value = '09:00'; els.t_dur.value = '2'; els.t_end.value = '';
  app.modules.itinerary.onSchedChange('dur');
  assert(els.t_end.value === '11:00', '开始09:00 + 时长2h → 结束11:00 (实际 ' + els.t_end.value + ')');

  // 改「开始」→ 结束 = 开始 + 时长
  els.t_start.value = '13:30'; els.t_dur.value = '1.5'; els.t_end.value = '';
  app.modules.itinerary.onSchedChange('start');
  assert(els.t_end.value === '15:00', '开始13:30 + 时长1.5h → 结束15:00 (实际 ' + els.t_end.value + ')');

  // 超出范围封顶 23:55
  els.t_start.value = '23:00'; els.t_dur.value = '2'; els.t_end.value = '';
  app.modules.itinerary.onSchedChange('dur');
  assert(els.t_end.value === '23:55', '23:00 + 2h 超出下拉上限 → 封顶23:55 (实际 ' + els.t_end.value + ')');

  // 改「结束」→ 时长 = 结束 - 开始
  els.t_start.value = '09:00'; els.t_dur.value = '2'; els.t_end.value = '12:30';
  app.modules.itinerary.onSchedChange('end');
  assert(parseFloat(els.t_dur.value) === 3.5, '结束12:30 - 开始09:00 → 时长3.5h (实际 ' + els.t_dur.value + ')');

  // 结束早于开始 → 时长不更新
  els.t_start.value = '10:00'; els.t_dur.value = '2'; els.t_end.value = '09:00';
  app.modules.itinerary.onSchedChange('end');
  assert(parseFloat(els.t_dur.value) === 2, '结束早于开始 → 时长保持不变2h (实际 ' + els.t_dur.value + ')');
}

console.log('\n[测试] 营业时间午夜跨越(00:00=24:00) 不再误报非营业');
{
  const { app } = makeClient();
  // 16:00-00:00 表示营业到午夜；19:00-22:00 应判为营业内（返回 null）
  const r1 = app.modules.itinerary.outsideHours('19:00', 3, [{ open: '16:00', close: '00:00' }]);
  assert(r1 === null, '19:00-22:00 落在 16:00-00:00 营业时间内（不再误报非营业）');
  // 普通段 16:00-21:00，22:00 结束应报非营业
  const r2 = app.modules.itinerary.outsideHours('19:00', 3, [{ open: '16:00', close: '21:00' }]);
  assert(r2 !== null, '19:00-22:00 超出 16:00-21:00 → 提示非营业');
  // 多段，其一覆盖即营业
  const r3 = app.modules.itinerary.outsideHours('19:00', 3, [{ open: '10:00', close: '12:00' }, { open: '16:00', close: '00:00' }]);
  assert(r3 === null, '多段含 16:00-00:00 → 营业内');
  // 无营业时间返回 null
  const r4 = app.modules.itinerary.outsideHours('19:00', 3, '');
  assert(r4 === null, '无营业时间 → null（不报错）');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
