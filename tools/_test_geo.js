/*
 * 仿真测试：验证地理编码离线缓存（#53）
 *   1) geocodeCached 结果持久化到 localStorage（travel_geo_cache_v1），二次相同查询不再调 geocode；
 *   2) 失败 query 持久化到 fail 列表，二次不再重试；
 *   3) clearGeoCache 清空内存与 localStorage；
 *   4) 模拟刷新：预置的缓存可被新会话装载复用（省 Geocoding 配额）。
 * 用 vm 加载真实 app.js + module-map.js，桩掉 DOM / 浏览器 API。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'module-map.js'), 'utf8');
const GEO_KEY = 'travel_geo_cache_v1';

function makeClient() {
  const ls = (() => {
    const s = {};
    return {
      getItem: k => (k in s ? s[k] : null),
      setItem: (k, v) => { s[k] = String(v); },
      removeItem: k => { delete s[k]; },
      _store: s
    };
  })();
  const ctx = {
    window: { BOARD_CONFIG: { gmapsApiKey: '', enabled: false } },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
    localStorage: ls,
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(APP_SRC + '\n;globalThis.__app = app;', ctx);
  vm.runInContext(MAP_SRC, ctx);
  const app = ctx.__app;
  return { app, ctx, ls };
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

(async () => {
  console.log('\n[测试A] geocodeCached 命中缓存并持久化到 localStorage');
  {
    const { app, ls } = makeClient();
    const map = app.modules.map;
    let calls = 0;
    map.geocode = (q) => { calls++; return Promise.resolve({ lat: 1, lng: 2 }); };

    await map.geocodeCached('台北101');
    assert(calls === 1, '首次调用触发了 geocode（calls=1）');
    const raw = ls.getItem(GEO_KEY);
    assert(!!raw, '已写入 localStorage 缓存键 ' + GEO_KEY);
    const d = JSON.parse(raw);
    assert(d.cache && d.cache['台北101'] && d.cache['台北101'].lat === 1, '缓存含 台北101 坐标');

    await map.geocodeCached('台北101');
    assert(calls === 1, '第二次相同查询复用缓存，未再调用 geocode（calls 仍为 1）');
  }

  console.log('\n[测试B] 失败 query 持久化去重（跨调用不重试）');
  {
    const { app, ls } = makeClient();
    const map = app.modules.map;
    let calls = 0;
    map.geocode = () => { calls++; return Promise.resolve(null); };

    const r1 = await map.geocodeCached('不存在地点');
    assert(r1 === null, '失败查询返回 null');
    assert(calls === 1, '失败查询调用了 geocode 一次');
    const d = JSON.parse(ls.getItem(GEO_KEY));
    assert(d.fail.indexOf('不存在地点') >= 0, '失败 query 已持久化到 fail 列表');

    await map.geocodeCached('不存在地点');
    assert(calls === 1, '同一失败 query 第二次不再调用 geocode（失败去重持久化）');
  }

  console.log('\n[测试C] clearGeoCache 清空内存与 localStorage');
  {
    const { app, ls } = makeClient();
    const map = app.modules.map;
    map.geocode = () => Promise.resolve({ lat: 1, lng: 2 });
    await map.geocodeCached('某点');
    assert(!!ls.getItem(GEO_KEY), '清空前缓存存在');
    map.clearGeoCache();
    assert(ls.getItem(GEO_KEY) === null, 'clearGeoCache 已删除 localStorage 缓存键');
    assert(Object.keys(map._geoCache).length === 0, '内存缓存已清空');
    assert(map._geoFail.size === 0, '内存失败集合已清空');
  }

  console.log('\n[测试D] 离线缓存跨会话复用（模拟刷新后重新加载）');
  {
    const { app, ls } = makeClient();
    // 预置一份已有缓存（模拟上一会话写入）
    ls.setItem(GEO_KEY, JSON.stringify({ cache: { '旧缓存点': { lat: 5, lng: 6 } }, fail: ['旧失败点'] }));
    const map = app.modules.map;
    let calls = 0;
    map.geocode = () => { calls++; return Promise.resolve({ lat: 99, lng: 99 }); };

    const r1 = await map.geocodeCached('旧缓存点');
    assert(calls === 0, '命中旧会话缓存，未调用 geocode（calls=0）');
    assert(r1 && r1.lat === 5, '返回的是旧缓存坐标（lat=5）');
    const r2 = await map.geocodeCached('旧失败点');
    assert(calls === 0, '命中旧会话失败集合，未调用 geocode（calls=0）');
    assert(r2 === null, '旧失败点仍返回 null');
  }

  console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
