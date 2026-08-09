/*
 * 回归测试：地图分类「类别 + 颜色」与每日行程表(ITIN_TYPES)统一
 *   - module-map.js 的 MAP_COLORS 覆盖全部 11 个行程表类别（不再缺类、不再回退成灰色 other）
 *   - 地图购物用黄(#eab308)、小吃用橙(#f97316) 等，与行程表一致
 *   - 地图各类别颜色与 styles.css .blk-* 的 border-left-color 完全一致（统一来源）
 * 用源码级正则校验（与 _test_itinerary_partD.js 同思路），vm 环境下也可稳定跑。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log('  PASS: ' + msg); } else { failed++; console.log('  FAIL: ' + msg); } }

// 行程表 ITIN_TYPES 的 11 类（与 module-itinerary.js 保持一致）
const TYPES = ['restaurant', 'hotel', 'spot', 'transport', 'shopping', 'entertainment', 'photo', 'dessert', 'snack', 'activity', 'other'];

console.log('\n[1) 地图 MAP_COLORS 覆盖全部行程表类别 + 颜色正确]');
const m = MAP_SRC.match(/const MAP_COLORS = \{([\s\S]*?)\};/);
assert(!!m, '源码中存在 MAP_COLORS 定义');
const body = m ? m[1] : '';
const colors = {};
body.replace(/(\w+):\s*'(#[\da-fA-F]{6})'/g, (_, k, v) => { colors[k] = v; return ''; });
TYPES.forEach(t => assert(colors[t] != null, `MAP_COLORS 含 ${t}`));
assert(colors.shopping === '#eab308', '购物为黄 #eab308（与行程表一致，不再橙）');
assert(colors.snack === '#f97316', '小吃为橙 #f97316');
assert(colors.entertainment === '#6366f1', '娱乐 #6366f1');
assert(colors.photo === '#0d9488', '拍照 #0d9488');
assert(colors.dessert === '#d946ef', '甜品 #d946ef');
assert(colors.activity === '#16a34a', '活动 #16a34a');
assert(colors.transport === '#06b6d4', '交通 #06b6d4');

console.log('\n[2) 地图类别标签与行程表 ITIN_TYPES 的 label 一致]');
const TCN = { restaurant: '餐饮', hotel: '酒店', spot: '景点', transport: '交通', shopping: '购物', entertainment: '娱乐', photo: '拍照', dessert: '甜品', snack: '小吃', activity: '活动', other: '其他' };
const lm = MAP_SRC.match(/const CATEGORY_LABELS = \{([\s\S]*?)\};/);
assert(!!lm, '源码中存在 CATEGORY_LABELS 定义');
const lbody = lm ? lm[1] : '';
const labels = {};
lbody.replace(/(\w+):\s*'([^']+)'/g, (_, k, v) => { labels[k] = v; return ''; });
TYPES.forEach(t => assert(labels[t] === TCN[t], `CATEGORY_LABELS.${t} = ${TCN[t]}`));

console.log('\n[3) 地图颜色与行程表 .blk-* 左边框颜色一致（统一来源）]');
TYPES.forEach(t => {
  const re = new RegExp('\\.blk-' + t + '\\s*\\{[^}]*border-left-color:\\s*' + colors[t] + '\\s*;\\s*\\}');
  assert(re.test(CSS), `行程表 .blk-${t} 左边框 = 地图 ${t} (${colors[t]})`);
});

console.log('\n===== 结果: ' + (failed === 0 ? '全部通过 (' + passed + ')' : failed + ' 项失败') + ' =====');
process.exit(failed === 0 ? 0 : 1);
