/*
 * 行程表：① 拖动行程块后保持横向滚动位置（不跳回最左）；② 导出每日行程为 Excel。
 * 用 vm 加载真实 app.js + module-itinerary.js + module-candidates.js + module-i18n.js，桩掉 DOM。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
const CAND_SRC = fs.readFileSync(path.join(ROOT, 'module-candidates.js'), 'utf8');
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'module-i18n.js'), 'utf8');

function makeClient() {
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }), head: { appendChild() {} }, addEventListener: () => {} };
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
  vm.runInContext(ITIN_SRC, ctx);
  vm.runInContext(CAND_SRC, ctx);
  vm.runInContext(I18N_SRC, ctx);
  const app = ctx.__app;
  app.backend = { enabled: false, base: '' };
  app.renderAll = () => {};
  app.closeModal = () => {};
  app.toast = () => {};
  app.saveState = () => {};
  return { app, ctx, document };
}

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log('  PASS: ' + msg); } else { failed++; console.log('  FAIL: ' + msg); } }

const { app, ctx } = makeClient();
const itin = app.modules.itinerary;

console.log('\n[1) 拖动后保持横向滚动位置（不跳回最左）]');
const itinSrc = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
assert(/const prevRowsScrollLeft = \(sec\.querySelector && sec\.querySelector\('\.itinerary-rows'\)\)\s*\n?\s*\? sec\.querySelector\('\.itinerary-rows'\)\.scrollLeft : 0;/.test(itinSrc), 'render 在重建 innerHTML 前先记录 .itinerary-rows 的 scrollLeft');
assert(/const rowsEl = sec\.querySelector\('\.itinerary-rows'\);\s*\n?\s*if \(rowsEl\) rowsEl\.scrollLeft = prevRowsScrollLeft;/.test(itinSrc), 'render 重建后同步恢复横向 scrollLeft');
assert(/if \(re\) re\.scrollLeft = prevRowsScrollLeft;/.test(itinSrc), 'settle 循环中再次恢复横向 scrollLeft（覆盖二次重渲）');

console.log('\n[2) 导出每日行程为 Excel：XLSX 可用时写 .xlsx 且 sheet 名为「目的地-每日行程」]');
app.state.destinations = [{ id: 'd1', name: '台北', startDate: '2026-01-01', endDate: '2026-01-03' }];
app.state.activeDestinationId = 'd1';
app.state.d1 = {
  itinerary: [{
    id: 'day1', date: '2026-01-01', weather: '晴', notes: '带伞',
    spots: [{ id: 'sp1', name: '台北101', type: 'spot', startTime: '09:00', durationH: 2, endTime: '11:00', ticket: 100, reservation: 'needed', address: '信义', note: '地标', mapUrl: 'http://x' }]
  }]
};
let written = null, sheetName = null;
ctx.XLSX = {
  utils: {
    book_new: () => ({}),
    json_to_sheet: () => ({}),
    book_append_sheet: (wb, ws, name) => { sheetName = name; }
  },
  writeFile: (wb, name) => { written = name; }
};
itin.exportXlsx();
assert(/^itinerary_台北_/.test(written || ''), 'XLSX.writeFile 文件名以 itinerary_台北_ 开头');
assert(sheetName === '台北-每日行程', '导出的 sheet 名为「台北-每日行程」');

console.log('\n[3) 导出内容：每行一个行程块，字段正确（含当日备注 / 起止 / 分类 / 门票 / 需预约）]');
// 复用上面已 spy 的 XLSX，但改为捕获 json_to_sheet 的 rows
let sheetRows = null;
ctx.XLSX.utils.json_to_sheet = (rows) => { sheetRows = rows; return {}; };
itin.exportXlsx();
const spotRow = (sheetRows || []).find(r => r.名称 === '台北101');
assert(!!spotRow, '导出含「台北101」这一行');
assert(spotRow && spotRow.Day === 1, 'Day=1');
assert(spotRow && spotRow.日期 === '2026-01-01', '日期正确');
assert(spotRow && spotRow.当日备注 === '带伞', '当日备注带入（拖到表格前/天气前）');
assert(spotRow && spotRow.开始时间 === '09:00' && spotRow.结束时间 === '11:00', '开始/结束时间 09:00–11:00');
assert(spotRow && spotRow.时长h === 2, '时长 2h');
assert(spotRow && spotRow.分类 === '景点', '分类取 ITIN_TYPES.spot.label=景点');
assert(spotRow && spotRow.门票 === 100, '门票 100');
assert(spotRow && spotRow.需预约 === '需预约', '需预约字段映射为「需预约」');
assert(spotRow && spotRow.地图链接 === 'http://x', '地图链接带入');

console.log('\n[4) 降级：无 XLSX 时回退 downloadCSV（文件名仍 itinerary_开头）]');
let fallback = {};
app.downloadCSV = (fn, rows) => { fallback.fn = fn; fallback.rows = rows; };
ctx.XLSX = undefined;
itin.exportXlsx();
assert(/^itinerary_台北_.*\.csv$/.test(fallback.fn || ''), '无 XLSX 时降级为 itinerary_台北_*.csv');
assert(Array.isArray(fallback.rows) && fallback.rows.some(r => r.名称 === '台北101'), '降级 CSV 含行程块行');

console.log('\n===== 结果: ' + (failed === 0 ? '全部通过 (' + passed + ')' : failed + ' 项失败') + ' =====');
process.exit(failed === 0 ? 0 : 1);
