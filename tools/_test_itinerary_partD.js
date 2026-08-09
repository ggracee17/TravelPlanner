/*
 * Part D 回归测试：行程表 4 项修复
 *   1) 滚动默认到顶部（scrollTop=0），不再停在底部（6:00–24:00）
 *   2) 新增行程默认开始时间：空天 09:00；当天排满（末块结束过晚）回退 09:00 而非 00:00；正常链式接在末块之后
 *   3) 拖拽链路：drop 失败时 _drag 不会残留（硬化后），避免「后续所有块都拖不动」
 *   4) 购物(黄) 与 小吃(橙) 颜色区分
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
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, addEventListener: () => {} };
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

const { app } = makeClient();
const itin = app.modules.itinerary;

console.log('\n[1) defaultStart 默认开始时间]');
assert(itin.defaultStart({ spots: [] }, 2) === '09:00', '空天 → 09:00');
assert(itin.defaultStart({ spots: [{ startTime: '09:00', durationH: 2 }] }, 2) === '11:00', '正常链式 → 接在末块之后(11:00)');
assert(itin.defaultStart({ spots: [{ startTime: '21:00', durationH: 2 }] }, 2) === '09:00', '当天排满(末块 21:00) → 回退 09:00（修复前为 00:00）');
assert(itin.defaultStart({ spots: [{ startTime: '23:00', durationH: 2 }] }, 2) === '09:00', '极端排满(末块 23:00) → 仍回退 09:00');

console.log('\n[2) 时间轴默认停在 6:00–00:00（最大滚动值，常用行程区间）]');
const itinSrc = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
assert(/querySelectorAll\('\.timeline'\)\.forEach\(tl => \{\s*const target = parseFloat\(tl\.getAttribute\('data-default-scroll'\)\)[\s\S]*tl\.scrollTop =/.test(itinSrc), 'render 把 timeline 默认滚到 6:00–00:00 常用区间（用显式 data-default-scroll 偏移，不依赖 scrollHeight 求值）');
assert(!/tl\.scrollTop = 0;/.test(itinSrc.replace(/\s+/g, ' ')), '不再默认停在顶部（00:00）');

console.log('\n[3) 拖拽硬化：drop 失败也清空 _drag]');
// 直接验证 onDrop 在 moveSpotToTime 抛错时仍把 _drag 置空（模拟 _drag 已设置）
itin._drag = { spotId: 'spX', fromDayId: 'day1' };
let threw = false;
const origMove = itin.moveSpotToTime;
itin.moveSpotToTime = () => { throw new Error('模拟落点处理失败'); };
try {
  // 构造一个最小 drop 事件；onDrop 内部会调用 moveSpotToTime（故意抛错）并进入 finally/_drag=null
  itin.onDrop({
    preventDefault() {},
    currentTarget: {
      dataset: { winStart: '0', winEnd: '24', dayId: 'day1' },
      querySelector: () => null,
      getBoundingClientRect: () => ({ top: 0 }),
      scrollTop: 0
    }
  });
} catch (e) { threw = true; }
itin.moveSpotToTime = origMove;
assert(!threw, 'onDrop 吞掉 moveSpotToTime 异常（不向上抛）');
assert(itin._drag === null, '异常后 _drag 已清空（不会卡死后续拖拽）');

console.log('\n[4) 颜色：购物黄 / 小吃橙]');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
assert(/\.blk-shopping\s+\.tl-block-cat-v\s*\{\s*color:#a16207/.test(css), '购物分类字为黄(#a16207)');
assert(/\.blk-shopping\s*\{[^}]*border-left-color:\s*#eab308/.test(css), '购物块左边框为黄(#eab308)');
assert(/\.blk-snack\s*\{[^}]*border-left-color:\s*#f97316/.test(css), '小吃仍为橙(#f97316)');

console.log('\n===== 结果: ' + (failed === 0 ? '全部通过 (' + passed + ')' : failed + ' 项失败') + ' =====');
process.exit(failed === 0 ? 0 : 1);
