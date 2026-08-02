/*
 * 仿真测试：验证两台电脑同时开页面时「勾选框自动反复勾选/取消」的两处根因修复。
 *
 * 被测代码 = 真实 app.js (+ module-checklists.js)，在 vm 中以桩对象（window/document/localStorage/
 * fetch/EventSource/手动时钟）加载，避免依赖浏览器。两个客户端 A、B 共享一个「服务端广播总线」。
 *
 * 修复点：
 *  (1) applyRemote 不再调用 ensureChecklists（否则 → saveState → pushBoard → 服务端广播 →
 *      另一端 applyRemote → 再次回推，形成冗余回声，每次远端更新都触发整段清单重渲染）。
 *  (2) _flushPendingRemote 不再把「本地有待推送改动期间暂存的远端状态」原样套回本地——
 *      那会让用户刚保存的改动被旧态冲掉（ON→OFF 抖动）。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CK_SRC = fs.readFileSync(path.join(ROOT, 'module-checklists.js'), 'utf8');

const BASE_STATE = {
  destinations: [{ id: 'd1', name: 'Tokyo', city: 'Tokyo', country: 'Japan' }],
  candidates: [],
  searchHistory: [],
  checklists: {
    documents: [
      { id: 'doc1', name: '护照', checked: false, required: true, cat: '证件' },
      { id: 'doc2', name: '签证', checked: false, required: true, cat: '证件' }
    ],
    luggage: [
      { id: 'lug1', name: '充电宝', checked: false, required: false, cat: '电子' }
    ]
  }
};

// 手动时钟 + setTimeout/clearTimeout 桩，便于确定性推进
function makeClock() {
  let clock = 0;
  const timers = [];
  let tid = 0;
  const setTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, due: clock + (ms || 0), fn }); return id; };
  const clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const advance = (ms) => {
    const target = clock + ms;
    let guard = 0;
    while (guard++ < 100000) {
      const due = timers.filter(t => t.due <= target).sort((a, b) => a.due - b.due);
      if (due.length === 0) break;
      const t = due[0];
      const idx = timers.indexOf(t); timers.splice(idx, 1);
      clock = t.due;
      t.fn();
    }
    clock = target;
  };
  return { setTimeout, clearTimeout, advance };
}

function makeClient(name, server, clock) {
  // app.js 顶层是 const app，vm 不会挂到 context；末尾追加 globalThis.app/__app 暴露
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  const ctx = {
    window: { BOARD_CONFIG: { enabled: true, base: '' } },
    document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }),
    EventSource: function () {},
    Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext(CK_SRC, ctx); // 提供 ensureChecklists（测试回声修复时需要）
  const app = ctx.__app;
  app.backend = { enabled: true, base: '' };
  app.modules = {};
  app.state = JSON.parse(JSON.stringify(BASE_STATE));
  app._lastSig = JSON.stringify(app.state);
  app._saveTimer = null;
  app._pendingRemote = null;
  // 渲染相关桩（避免触碰真实 DOM）
  app.renderSwitcher = () => {};
  app.renderAll = () => {};
  app.updateStatus = () => {};
  app.showLogin = () => {};
  app.toast = () => {};
  // 用「服务端广播总线」替换真实 pushBoard：统计广播次数并广播给所有订阅者（含自身，模拟真实 SSE）
  app.pushBoard = function () {
    this._saveTimer = null;
    this._writeLocalCache();
    const payload = JSON.stringify(this.state);
    server.broadcast(this.state, this);
    // 复刻真实 pushBoard 成功分支：更新 _lastSig 并 flush
    this._lastSig = payload;
    this._lastSaved = 'saved';
    this._flushPendingRemote();
    return Promise.resolve();
  };
  app.connectSSE = function () {
    server.subscribers.push({ client: this, onState: (st) => this.handleRemoteState(st) });
  };
  app.connectSSE();
  return app;
}

// ---- 测试框架 ----
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

// ============ 测试 1：applyRemote 回声修复 ============
console.log('\n[测试1] applyRemote 不应回推（消除冗余回声广播）');
{
  const server = { subscribers: [], count: 0,
    broadcast(state) { this.count++; if (this.count > 2000) throw new Error('RUNAWAY 广播风暴'); const snap = JSON.parse(JSON.stringify(state)); this.subscribers.forEach(s => s.onState(snap)); } };
  const clock = makeClock();
  const A = makeClient('A', server, clock);
  const B = makeClient('B', server, clock);

  // 用户在 A 上勾选 doc1
  A.state.checklists.documents[0].checked = true;
  A.saveState();           // 后端模式 → 防抖 500ms → pushBoard
  clock.advance(5000);     // 推进时钟，让所有广播/重渲染收敛

  console.log('  固定版广播次数 = ' + server.count + '（仅 A 自身 1 次推送为正确值）');
  assert(server.count === 1, '固定版：总广播次数应为 1（A 推送一次，B 收到后不再回推）');

  // —— 对照：把 applyRemote 改回「会调用 ensureChecklists」的旧版，验证确实会多一轮回声 ——
  const buggyApply = function (data) {
    this.state = this.normalizeState(data);
    this._lastSig = JSON.stringify(this.state);
    this.ensureChecklists();          // 旧版：无条件 saveState → pushBoard → 回声
    this.renderSwitcher(); this.renderAll(); this.updateStatus();
  };
  server.subscribers.length = 0; server.count = 0;
  const A2 = makeClient('A2', server, clock);
  const B2 = makeClient('B2', server, clock);
  A2.applyRemote = buggyApply; B2.applyRemote = buggyApply;
  A2.state.checklists.documents[0].checked = true;
  A2.saveState();
  clock.advance(5000);
  console.log('  旧版（带 ensureChecklists 回声）广播次数 = ' + server.count + '（>1 即证明旧版会产生冗余回声）');
  assert(server.count > 1, '旧版：会产生冗余回声广播（次数 > 1），印证根因');
}

// ============ 测试 2：_flushPendingRemote 暂存态不应冲掉本地刚保存的改动 ============
console.log('\n[测试2] 本地推送成功后，暂存的旧远端态不应把刚勾选的框冲掉（消除 ON→OFF 抖动）');
{
  const server = { subscribers: [], count: 0, broadcast() {} };
  const clock = makeClock();
  const A = makeClient('A', server, clock);

  // 模拟：A 正在编辑（本地已勾选 doc1=ON），但推送还在防抖中（_saveTimer 未触发）
  const S0 = JSON.parse(JSON.stringify(BASE_STATE)); // 服务端/对端的旧态（doc1=OFF）
  A.state = JSON.parse(JSON.stringify(BASE_STATE));
  A.state.checklists.documents[0].checked = true;    // 用户本地勾选 ON
  A._lastSig = JSON.stringify(S0);                   // 本地签名仍是旧态
  A._saveTimer = {};                                 // 有待推送改动（防抖尚未触发）

  // 此刻对端推来了旧态 S0（doc1=OFF）→ 因本地有待推送改动，应被暂存而非直接覆盖
  A.handleRemoteState(JSON.parse(JSON.stringify(S0)));
  assert(A._pendingRemote && A.state.checklists.documents[0].checked === true,
    '收到旧远端态时：本地改动应被保留（doc1 仍 ON），旧态仅暂存');

  // 本地防抖触发 → 推送成功（复刻 pushBoard 成功分支）
  A._saveTimer = null;
  const payload = JSON.stringify(A.state); // S1: doc1=ON
  A._lastSig = payload;
  A._flushPendingRemote();                 // ← 修复点

  console.log('  固定版 flush 后 doc1.checked = ' + A.state.checklists.documents[0].checked + '（应为 true）');
  assert(A.state.checklists.documents[0].checked === true,
    '固定版：flush 后用户刚勾选的项保持 ON（不被旧远端态冲掉）');

  // —— 对照：旧版 _flushPendingRemote（原样套回暂存态）——
  const buggyFlush = function () {
    if (!this._pendingRemote) return;
    const d = this._pendingRemote; this._pendingRemote = null;
    if (JSON.stringify(d) !== JSON.stringify(this.state)) this.applyRemote(d);
  };
  const A3 = makeClient('A3', server, clock);
  A3.state = JSON.parse(JSON.stringify(BASE_STATE));
  A3.state.checklists.documents[0].checked = true;
  A3._lastSig = JSON.stringify(S0);
  A3._saveTimer = {};
  A3.handleRemoteState(JSON.parse(JSON.stringify(S0)));
  A3._saveTimer = null;
  A3._lastSig = JSON.stringify(A3.state);
  A3._flushPendingRemote = buggyFlush;
  A3._flushPendingRemote();
  console.log('  旧版 flush 后 doc1.checked = ' + A3.state.checklists.documents[0].checked + '（旧版会被冲成 false）');
  assert(A3.state.checklists.documents[0].checked === false,
    '旧版：会把刚勾选的项冲回 OFF（正是用户看到的「自动取消」）');
}

console.log('\n========== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==========');
process.exit(failed === 0 ? 0 : 1);
