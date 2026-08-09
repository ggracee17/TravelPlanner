/*
 * 仿真测试：并发编辑时「一方保存后，另一方新增的行程块消失」的根因修复。
 *
 * 根因：后端 /api/board 是 last-write-wins 全量覆盖。当 B 端在「本地有待推送改动」期间
 *       暂存了协作者的远端状态(_pendingRemote)，随后 B 自己触发保存时，旧版 pushBoard 直接把
 *       B 的旧态（不含 A 新增的块）上传覆盖 → SSE 广播又把「缺块状态」同步回 A → 块「消失」。
 *
 * 修复：pushBoard 推送前先用 mergeStatesPreferLocal 把暂存的远端新增项并入本地再上传，
 *       从而保住对方新增的行程块；单人删除语义不依赖此合并（单人流程里 _pendingRemote 恒为 null）。
 *
 * 被测代码 = 真实 app.js，在 vm 中以桩对象加载；两个客户端共享一个「服务端广播总线」。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const BASE_STATE = {
  destinations: [{
    id: 'd1', name: 'TPE',
    itinerary: [
      { id: 'day1', date: '2026-08-01', spots: [{ id: 'sp1', name: '既有行程块' }] },
      { id: 'day3', date: '2026-08-03', spots: [] }
    ]
  }],
  candidates: [],
  checklists: { documents: [{ id: 'doc1', name: '护照' }], luggage: [], todos: [] }
};

const clone = o => JSON.parse(JSON.stringify(o));

function makeClient(name, server) {
  const src = APP_SRC + '\n;globalThis.app = app; globalThis.__app = app;';
  let appRef = null;
  const ctx = {
    window: { BOARD_CONFIG: { enabled: true, base: '' } },
    document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} },
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    fetch: (url, opts) => { const st = JSON.parse(opts.body); server.broadcast(st, appRef); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }); },
    EventSource: function () {},
    Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    navigator: {}, confirm: () => true, console, JSON, Date, Promise, Object, Array, Math, parseInt, parseFloat, isNaN,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const app = ctx.__app;
  appRef = app;
  app.backend = { enabled: true, base: '' };
  app.sessionToken = 'tok';
  app.base = () => '';
  app.modules = {};
  app.state = clone(BASE_STATE);
  app._lastSig = JSON.stringify(app.state);
  app._pendingRemote = null;
  app._saveTimer = null;
  app.renderSwitcher = () => {};
  app.renderAll = () => {};
  app.updateStatus = () => {};
  app.showLogin = () => {};
  app.toast = () => {};
  app.connectSSE = () => { server.subscribers.push({ client: app, onState: (st) => app.handleRemoteState(st) }); };
  app.connectSSE();
  return app;
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}
const daySpots = (state, dayId) => { const d = (state.destinations[0].itinerary || []).find(x => x.id === dayId); return d ? (d.spots || []) : []; };
const hasSpot = (state, dayId, sid) => daySpots(state, dayId).some(s => s.id === sid);

console.log('\n[单元测试] mergeStatesPreferLocal 的合并语义');
{
  const A = makeClient('A', { subscribers: [], broadcast() {} });
  // 并发新增：本地 day3 有 c，远端 day3 有 b → 合并后两者都在
  const local = clone(BASE_STATE);
  local.destinations[0].itinerary.find(d => d.id === 'day3').spots.push({ id: 'c', name: '本地新增' });
  const remote = clone(BASE_STATE);
  remote.destinations[0].itinerary.find(d => d.id === 'day3').spots.push({ id: 'b', name: '对方新增' });

  const out = A.mergeStatesPreferLocal(remote, local);
  assert(hasSpot(out, 'day3', 'b'), '远端新增的块(b)被并入本地');
  assert(hasSpot(out, 'day3', 'c'), '本地新增的块(c)保留');
  assert(!hasSpot(local, 'day3', 'b'), 'local 入参不被污染（深拷贝）');

  // 远端独有的目的地被补回
  const local2 = clone(BASE_STATE);
  const remote2 = clone(BASE_STATE);
  remote2.destinations.push({ id: 'd2', name: 'Kaohsiung', itinerary: [] });
  const out2 = A.mergeStatesPreferLocal(remote2, local2);
  assert(out2.destinations.some(d => d.id === 'd2'), '远端独有的目的地被补回');

  // 候选库、核对清单按 id 并集
  const local3 = clone(BASE_STATE);
  const remote3 = clone(BASE_STATE);
  remote3.candidates.push({ id: 'c2', name: '候选2' });
  remote3.checklists.documents.push({ id: 'doc2', name: '签证' });
  remote3.checklists.luggage.push({ id: 'l1', name: '充电宝' });
  remote3.checklists.todos.push({ id: 't1', name: '买票' });
  const out3 = A.mergeStatesPreferLocal(remote3, local3);
  assert(out3.candidates.some(c => c.id === 'c2'), '候选库并入远端独有项');
  assert(out3.checklists.documents.some(x => x.id === 'doc2'), '核对清单 documents 并入远端独有项');
  assert(out3.checklists.luggage.some(x => x.id === 'l1'), '核对清单 luggage 并入远端独有项');
  assert(out3.checklists.todos.some(x => x.id === 't1'), '核对清单 todos 并入远端独有项');

  // 同 id 冲突：本地版本优先（不被远端覆盖）
  const local4 = clone(BASE_STATE);
  local4.destinations[0].itinerary.find(d => d.id === 'day1').spots[0].name = '本地改名';
  const remote4 = clone(BASE_STATE);
  remote4.destinations[0].itinerary.find(d => d.id === 'day1').spots[0].name = '远端改名';
  const out4 = A.mergeStatesPreferLocal(remote4, local4);
  assert(out4.destinations[0].itinerary.find(d => d.id === 'day1').spots[0].name === '本地改名', '同 id 冲突以本地版本为准');

  // 冲突策略：本地删除、远端仍有的块 → 合并会重新并入（优先「不丢掉协作者新增」，单人删除不受影响，
  // 因为单人流程里 _pendingRemote 恒为 null，不会走这条合并路径）
  const local5 = clone(BASE_STATE); // day3 为空（用户删掉了对方的块）
  const remote5 = clone(BASE_STATE);
  remote5.destinations[0].itinerary.find(d => d.id === 'day3').spots.push({ id: 'b', name: '对方新增' });
  const out5 = A.mergeStatesPreferLocal(remote5, local5);
  assert(hasSpot(out5, 'day3', 'b'), '并发窗口内：对方新增块被重新并入（本地删除被覆盖是预期冲突策略）');

  // 回归：远端目的地若缺 itinerary 数组（脏数据），合并不得抛错（曾崩溃于 app.js:569 的 rd.itinerary.forEach）
  const local6 = clone(BASE_STATE);
  const remote6 = clone(BASE_STATE);
  remote6.destinations[0].itinerary = undefined; // 模拟缺字段的脏数据
  let threw = false;
  let out6 = null;
  try { out6 = A.mergeStatesPreferLocal(remote6, local6); } catch (e) { threw = true; }
  assert(!threw, '远端目的地缺 itinerary 数组时不抛错');
  assert(out6 && hasSpot(out6, 'day1', 'sp1'), '缺字段的远端态合并后本地数据完整（sp1 仍在）');
}

console.log('\n[集成测试] 2 人同时编辑：B 保存后 A 在 Day3 新增的块不应消失（修复后）');
(async () => {
  const server = {
    subscribers: [], count: 0,
    broadcast(state, sender) {
      this.count++;
      if (this.count > 5000) throw new Error('RUNAWAY 广播风暴');
      const snap = clone(state);
      this.subscribers.forEach(s => { if (s.client !== sender) s.onState(snap); });
    }
  };
  const A = makeClient('A', server);
  const B = makeClient('B', server);

  // A 在 Day3 新增一个块
  A.state.destinations[0].itinerary.find(d => d.id === 'day3').spots.push({ id: 'spDay3', name: 'A 在 Day3 新增的块' });
  // B 正在本地编辑（day1 加了本地块），模拟「有待推送改动」
  B.state.destinations[0].itinerary.find(d => d.id === 'day1').spots.push({ id: 'spBedit', name: 'B 本地编辑' });
  B._lastSig = JSON.stringify(BASE_STATE);
  B._saveTimer = {};

  // A 保存（推送）→ 广播给 B；B 因有待推送改动，把 A 的远端态暂存为 _pendingRemote
  await A.pushBoard();
  assert(B._pendingRemote && hasSpot(B._pendingRemote, 'day3', 'spDay3'), 'B 收到 A 的更新并暂存为 _pendingRemote（不直接覆盖本地编辑）');

  // B 点击保存 → 推送前并入 _pendingRemote，保住 A 的块
  await B.pushBoard();
  assert(hasSpot(A.state, 'day3', 'spDay3'), 'A 端在收到 B 广播后，Day3 新增块仍在（未被覆盖消失）');
  assert(hasSpot(B.state, 'day3', 'spDay3'), 'B 端合并态也保留了 A 的 Day3 块');
  assert(hasSpot(B.state, 'day1', 'spBedit'), 'B 端本地编辑(spBedit)也保留');

  // —— 对照：旧版 pushBoard（推送前不并入 _pendingRemote）会让块消失 ——
  const server2 = { subscribers: [], count: 0, broadcast(state, sender) { const snap = clone(state); this.subscribers.forEach(s => { if (s.client !== sender) s.onState(snap); }); } };
  const A2 = makeClient('A2', server2);
  const B2 = makeClient('B2', server2);
  A2.state.destinations[0].itinerary.find(d => d.id === 'day3').spots.push({ id: 'spDay3', name: 'A 在 Day3 新增的块' });
  B2.state.destinations[0].itinerary.find(d => d.id === 'day1').spots.push({ id: 'spBedit', name: 'B 本地编辑' });
  B2._lastSig = JSON.stringify(BASE_STATE);
  B2._saveTimer = {};
  await A2.pushBoard();
  // 复刻旧版行为：推送前不并入 _pendingRemote（即清空暂存态，让真实 pushBoard 跳过合并），
  // 上传的是 B 的旧态（不含 A 新增的块）→ A 收到后块消失，印证根因。
  B2._pendingRemote = null;
  await B2.pushBoard();
  assert(!hasSpot(A2.state, 'day3', 'spDay3'), '对照(旧版)：A 的 Day3 块被 B 的旧态覆盖而消失（印证根因）');

  console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========\n`);
  process.exit(failed ? 1 : 0);
})();
