/*
 * 回归测试：拖动行程块修复 + 待办勾选计数刷新
 *   1) onDragStart 不再用 html/body 的 overflow:hidden(drag-lock) 锁定整页 —— 该做法会打断原生 HTML5 拖拽（拖不动）
 *   2) 改用 document 级 dragover 的 preventDefault 阻止整页自动滚动（_preventPageScroll 注册/移除）
 *   3) onDragStart 不再在 dragstart 中重建/改动时间轴 DOM（重建 .tl-hours 也会打断原生拖拽）
 *   4) toggleTodo 调用 this.render() 以刷新头部「已勾选 N / 总数」计数与「归档已完成」按钮显隐
 * 采用源码级正则校验（与 _test_itinerary_partD.js 同思路），vm 环境下稳定可跑。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ITIN_SRC = fs.readFileSync(path.join(ROOT, 'module-itinerary.js'), 'utf8');
const CHK_SRC = fs.readFileSync(path.join(ROOT, 'module-checklists.js'), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log('  PASS: ' + msg); } else { failed++; console.log('  FAIL: ' + msg); } }

console.log('\n[1) onDragStart 不再用 overflow:hidden 锁定整页（否则打断原生拖拽）]');
assert(!/drag-lock/.test(ITIN_SRC), 'module-itinerary.js 不再引用 drag-lock');
assert(!/classList\.(add|remove)\(['"]drag-lock['"]/.test(ITIN_SRC), '不再对 html/body 加/去 drag-lock 类');

console.log('\n[2) 改用 document 级 dragover preventDefault 阻止整页自动滚动]');
assert(/addEventListener\('dragover', this\._preventPageScroll/.test(ITIN_SRC), 'onDragStart 注册 document dragover 监听(_preventPageScroll)');
assert(/removeEventListener\('dragover', this\._preventPageScroll/.test(ITIN_SRC), 'onDragEnd 移除该监听');
assert(/if \(this\._drag\) ev\.preventDefault\(\)/.test(ITIN_SRC), '监听仅在拖拽中 preventDefault（阻止整页滚动）');

console.log('\n[3) onDragStart 不再在 dragstart 中重建/改动时间轴 DOM（否则打断原生拖拽）]');
assert(!/拖拽时展开所有时间轴/.test(ITIN_SRC), '移除「展开所有时间轴」的 dragstart DOM 重建');
assert(!/\.tl-hours'\)\.innerHTML = hh/.test(ITIN_SRC), '不再重建 .tl-hours 内容');

console.log('\n[4) 待办勾选切换会重渲以刷新「已勾选 N / 总数」计数]');
assert(/toggleTodo\(id, done\) \{[\s\S]*?this\.render\(\);/.test(CHK_SRC), 'toggleTodo 内调用 this.render() 重渲计数与归档按钮');

console.log('\n===== 结果: ' + (failed === 0 ? '全部通过 (' + passed + ')' : failed + ' 项失败') + ' =====');
process.exit(failed === 0 ? 0 : 1);
