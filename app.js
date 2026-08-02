/* =====================================================================
   私人专属旅行规划工作台 - 主应用
   - 永久存档（localStorage）
   - 6大核心板块固定
   - 状态管理 + UI 控制
   ===================================================================== */

const STORAGE_KEY = 'travel_workspace_v1';

const app = {
  // 全局状态
  state: {
    destinations: [],        // 目的地档案库
    activeDestinationId: null, // 当前选中的目的地
    checklists: {
      documents: [],          // 证件清单
      luggage: []             // 行李清单
    },
    searchHistory: []         // 全网检索历史
  },

  // 板块模块（由各 module-*.js 注册）
  modules: {},

  // 后端（多人协作 / 服务端永久存储）运行时状态
  backend: { enabled: false, base: '' },
  sessionToken: null,
  _lastSig: '',
  _pendingRemote: null,
  _saveTimer: null,
  _online: 0,
  _lastSaved: '',
  _sse: null,

  /* ====== 初始化 ====== */
  init() {
    this.readConfig();
    if (this.backend.enabled) {
      // 后端模式：登录闸门 → 拉取服务端看板 → 实时同步
      this.sessionToken = this.localGet('travel_board_token');
      this.updateStatus();
      this.startBackend();
      return;
    }
    // 本地模式（默认）：localStorage 永久存档
    this.loadState();
    if (typeof this.ensureChecklists === 'function') this.ensureChecklists();
    this.bindNavTabs();
    this.renderSwitcher();
    this.renderAll();
    this.updateStorageStats();
    if (this.state.destinations.length === 0) {
      this.toast('👋 欢迎使用私人旅行规划工作台！请在「板块1」新建您的第一个目的地档案。', 'success');
    } else {
      this.toast(`已载入 ${this.state.destinations.length} 个目的地档案`, 'success');
    }
  },

  /* ====== 后端：配置 / 鉴权 / 实时同步 ====== */
  readConfig() {
    const c = (typeof window !== 'undefined' && window.BOARD_CONFIG) || {};
    this.backend = { enabled: !!c.enabled, base: c.base || '' };
  },
  localGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  localSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  base() { return this.backend.base || ''; },

  startBackend() {
    if (!this.sessionToken) { this.showLogin(); return; }
    this.connectSSE();
    this.fetchBoard()
      .then(() => {
        if (typeof this.ensureChecklists === 'function') this.ensureChecklists();
        this.bindNavTabs();
        this.renderSwitcher();
        this.renderAll();
        this.updateStatus();
        this.toast('已连接到家庭共享看板', 'success');
      })
      .catch(() => {
        this.toast('无法连接服务端，请检查网络后刷新', 'error');
        this.updateStatus('连接失败');
      });
  },

  showLogin() {
    this.openModal('🔒 输入访问密码', `
      <p class="text-sm text-slate-600 mb-3">这是一份<strong>家庭共享</strong>旅行看板，需要密码才能打开。密码由家人共用，知道即可访问。</p>
      <div class="form-field">
        <label>访问密码</label>
        <input id="loginPw" type="password" placeholder="请输入密码" onkeydown="if(event.key==='Enter')app.doUnlock(document.getElementById('loginPw').value)" />
      </div>
    `, [
      { text: '解锁', class: 'btn btn-primary', action: "app.doUnlock(document.getElementById('loginPw') ? document.getElementById('loginPw').value : '')" }
    ]);
    setTimeout(() => { const i = document.getElementById('loginPw'); if (i) i.focus(); }, 50);
  },

  doUnlock(pw) {
    pw = (pw || '').trim();
    if (!pw) return this.toast('请输入密码', 'warning');
    fetch(this.base() + '/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    })
      .then(r => r.json().then(j => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (status === 200 && j && j.token) {
          this.sessionToken = j.token;
          this.localSet('travel_board_token', j.token);
          this.closeModal();
          this.startBackend();
        } else {
          this.toast('密码错误', 'error');
        }
      })
      .catch(() => this.toast('无法连接服务端', 'error'));
  },

  fetchBoard() {
    return fetch(this.base() + '/api/board', {
      headers: { Authorization: 'Bearer ' + this.sessionToken }
    }).then(r => {
      if (r.status === 401) { this.sessionToken = null; this.localSet('travel_board_token', ''); throw new Error('unauthorized'); }
      return r.json();
    }).then(j => {
      if (j && j.data) {
        this.state = this.normalizeState(j.data);
        this._lastSig = JSON.stringify(this.state);
      }
      return this.state;
    });
  },

  connectSSE() {
    if (typeof EventSource === 'undefined' || !this.sessionToken) return;
    try {
      const es = new EventSource(this.base() + '/api/stream?token=' + encodeURIComponent(this.sessionToken));
      this._sse = es;
      es.addEventListener('state', (ev) => {
        try { this.handleRemoteState(JSON.parse(ev.data).data); } catch (e) {}
      });
      es.addEventListener('presence', (ev) => {
        try { this._online = JSON.parse(ev.data).count || 0; this.updateStatus(); } catch (e) {}
      });
      es.onerror = () => { this._online = 0; this.updateStatus('连接中断'); };
    } catch (e) {}
  },

  handleRemoteState(data) {
    if (!data || typeof data !== 'object') return;
    // 与本地一致（多半是自己刚保存的回声）→ 跳过，避免回环重渲染
    if (JSON.stringify(data) === JSON.stringify(this.state)) return;
    if (this.isModalOpen()) { this._pendingRemote = data; return; } // 编辑中暂存，关弹窗再应用
    this.applyRemote(data);
  },

  applyRemote(data) {
    this.state = this.normalizeState(data);
    this._lastSig = JSON.stringify(this.state);
    if (typeof this.ensureChecklists === 'function') this.ensureChecklists();
    this.renderSwitcher();
    this.renderAll();
    this.updateStatus();
  },

  isModalOpen() {
    const r = document.getElementById('modalRoot');
    return !!(r && r.innerHTML && r.innerHTML.trim());
  },

  updateStatus(extra) {
    const el = document.getElementById('boardStatus');
    if (!el) return;
    if (!this.backend.enabled) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.classList.remove('hidden');
    let s = '🔒 已解锁';
    const online = this._online > 0 ? this._online : (this._sse && this._sse.readyState === 1 ? 1 : 0);
    if (online > 0) s += ' · 在线 ' + online + ' 人';
    if (extra) s += ' · ' + extra;
    else if (this._lastSaved) s += ' · ' + this._lastSaved;
    el.textContent = s;
  },

  nowTime() {
    try { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  },

  pushBoard() {
    if (!this.sessionToken) return;
    const payload = JSON.stringify(this.state);
    fetch(this.base() + '/api/board', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.sessionToken },
      body: payload
    })
      .then(r => {
        if (r.status === 401) { this.sessionToken = null; this.localSet('travel_board_token', ''); this.showLogin(); return null; }
        return r.json();
      })
      .then(j => {
        if (j && j.ok) {
          this._lastSig = payload;
          this._lastSaved = '已保存 ' + this.nowTime();
          this.updateStatus();
        } else if (j === null) {
          // 已跳转登录
        } else {
          this.updateStatus('保存失败');
        }
      })
      .catch(() => this.updateStatus('保存失败'));
  },

  /* ====== 持久化 ====== */
  // 修正状态结构异常（如合并导入 bug 曾把 candidates 错误转成 {0:..,1:..} 对象）。
  // 用 Object.values 还原为数组，避免数据丢失；同时保证 checklists 结构完整。
  normalizeState(s) {
    if (!s || typeof s !== 'object') return s || {};
    ['destinations', 'candidates', 'searchHistory'].forEach(k => {
      if (s[k] == null) s[k] = [];
      else if (!Array.isArray(s[k])) {
        s[k] = (typeof s[k] === 'object') ? Object.values(s[k]) : [];
      }
    });
    if (!s.checklists || typeof s.checklists !== 'object') s.checklists = { documents: [], luggage: [] };
    else {
      if (!Array.isArray(s.checklists.documents)) s.checklists.documents = (s.checklists.documents && typeof s.checklists.documents === 'object') ? Object.values(s.checklists.documents) : [];
      if (!Array.isArray(s.checklists.luggage)) s.checklists.luggage = (s.checklists.luggage && typeof s.checklists.luggage === 'object') ? Object.values(s.checklists.luggage) : [];
    }
    return s;
  },

  loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        this.state = this.normalizeState({ ...this.state, ...data });
      }
    } catch (e) {
      console.error('数据加载失败：', e);
      this.toast('数据加载失败：' + e.message, 'error');
    }
  },

  saveState() {
    if (this.backend.enabled) {
      this.updateStatus('保存中…');
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.pushBoard(), 500);
      return true;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.updateStorageStats();
      return true;
    } catch (e) {
      console.error('数据保存失败：', e);
      this.toast('数据保存失败：' + e.message + '（可能存储已满，建议备份清理）', 'error');
      return false;
    }
  },

  updateStorageStats() {
    const el = document.getElementById('storageStats');
    if (!el) return;
    if (this.backend.enabled) {
      el.textContent = `📦 ${this.state.destinations.length} 个目的地 · 服务端存储`;
      return;
    }
    const total = this.state.destinations.length;
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    const sizeKB = (new Blob([raw]).size / 1024).toFixed(1);
    el.textContent = `📦 ${total} 个目的地 · ${sizeKB} KB`;
  },

  /* ====== 导航 Tab 切换 ====== */
  bindNavTabs() {
    document.querySelectorAll('#navTabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('#navTabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.querySelector(`[data-section="${tab}"]`)?.classList.add('active');
        if (this.modules[tab]?.onShow) this.modules[tab].onShow();
      });
    });
  },

  /* ====== 当前目的地切换条 ====== */
  renderSwitcher() {
    const wrap = document.getElementById('destinationSwitcher');
    const sel = document.getElementById('activeDestSelect');
    if (!wrap || !sel) return;
    if (this.state.destinations.length === 0) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    sel.innerHTML = this.state.destinations
      .map(d => `<option value="${d.id}">${app.destName(d)} (${d.startDate || '?'} ~ ${d.endDate || '?'})</option>`)
      .join('');
    if (!this.state.activeDestinationId || !this.state.destinations.find(d => d.id === this.state.activeDestinationId)) {
      this.state.activeDestinationId = this.state.destinations[0].id;
    }
    sel.value = this.state.activeDestinationId;
    this.updateActiveDestSummary();
  },

  switchDestination(id) {
    this.state.activeDestinationId = id;
    this.saveState();
    this.updateActiveDestSummary();
    this.renderAll();
  },

  updateActiveDestSummary() {
    const el = document.getElementById('activeDestSummary');
    const d = this.getActiveDestination();
    if (!d || !el) return;
    const expenseSum = this.getExpensesTotal(d.id);
    const budget = parseFloat(d.budget) || 0;
    el.textContent = `· ${d.travelers || 0} 人 · 预算 ¥${budget.toFixed(0)} · 已花 ¥${expenseSum.toFixed(0)}`;
  },

  /* ====== 工具：当前目的地 ====== */
  getActiveDestination() {
    return this.state.destinations.find(d => d.id === this.state.activeDestinationId) || null;
  },

  /* ====== 工具：花销总额 ====== */
  getExpensesTotal(destId) {
    const list = this.state[destId]?.expenses || [];
    return list.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  },

  /* ====== 工具：UUID ====== */
  uid() { return 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); },

  /* ====== 渲染调度 ====== */
  renderAll() {
    this.renderSwitcher();
    if (this.modules.home) this.modules.home.render();
    if (this.modules.destinations) this.modules.destinations.render();
    if (this.modules.itinerary) this.modules.itinerary.render();
    if (this.modules.checklists) this.modules.checklists.render();
    if (this.modules.expenses) this.modules.expenses.render();
    if (this.modules.candidates) this.modules.candidates.render();
    if (this.modules.map) this.modules.map.render();
  },

  /* ====== 全局备份/恢复 ====== */
  /* ====== CSV 兜底导出（SheetJS 不可用 / 离线时降级） ====== */
  downloadCSV(filename, rows) {
    if (!rows || rows.length === 0) { this.toast('暂无数据可导出', 'warning'); return; }
    const headers = Object.keys(rows[0]);
    const esc = v => {
      const s = (v === null || v === undefined) ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => esc(r[h])).join(','))).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

  exportAll() {
    try {
      // 1. 备份 JSON（始终执行）
      const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `travel_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      // 2. 收集所有 sheet 数据
      const sheets = [];
      const destRows = this.state.destinations.map(d => ({
        '目的地': app.destName(d), '起止日期': `${d.startDate || ''} ~ ${d.endDate || ''}`,
        '出行天数': app.dateDiff(d.startDate, d.endDate), '同行人数': d.travelers,
        '总预算(¥)': d.budget, '备注': d.notes
      }));
      if (destRows.length) sheets.push({ name: '目的地档案', rows: destRows });

      this.state.destinations.forEach(d => {
        const bucket = this.state[d.id] || {};
        if (bucket.itinerary && bucket.itinerary.length) {
          const rows = bucket.itinerary.map(day => ({
            '日期': day.date, '天气': day.weather, '早': day.morning, '中': day.noon, '晚': day.evening,
            '游玩景点': (day.spots || []).map(s => s.name).join(' / '),
            '门票合计(¥)': (day.spots || []).reduce((s, x) => s + (parseFloat(x.ticket) || 0), 0),
            '交通费合计(¥)': (day.spots || []).reduce((s, x) => s + (parseFloat(x.transportCost) || 0), 0),
            '酒店': day.hotel?.name, '住宿费(¥)': day.hotel?.cost, '餐饮': day.dining,
            '导航链接': day.mapLink, '备注': day.notes
          }));
          sheets.push({ name: `${app.destName(d)}-每日行程`, rows });
        }
        if (bucket.expenses && bucket.expenses.length) {
          const rows = bucket.expenses.map(e => ({
            '日期': e.date, '分类': e.category, '详情': e.detail, '金额(¥)': e.amount, '支付方式': e.payment
          }));
          sheets.push({ name: `${app.destName(d)}-花销`, rows });
        }
        if (bucket.media && bucket.media.length) {
          const rows = bucket.media.map(m => ({
            '类型': m.type, '日期': m.date, '说明': m.caption, '链接': m.url
          }));
          sheets.push({ name: `${app.destName(d)}-素材`, rows });
        }
      });

      if (this.state.checklists?.documents?.length) sheets.push({ name: '证件清单', rows: this.state.checklists.documents });
      if (this.state.checklists?.luggage?.length) sheets.push({ name: '行李清单', rows: this.state.checklists.luggage });
      if (this.state.searchHistory?.length) sheets.push({ name: '检索历史', rows: this.state.searchHistory });

      // 3. 导出：优先 Excel，降级 CSV
      if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();
        sheets.forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31)));
        XLSX.writeFile(wb, `travel_workbook_${new Date().toISOString().slice(0,10)}.xlsx`);
        this.toast('已导出 JSON 备份 + Excel 全量工作簿', 'success');
      } else {
        const ts = new Date().toISOString().slice(0, 10);
        sheets.forEach(s => this.downloadCSV(`travel_${s.name}_${ts}.csv`, s.rows));
        this.toast(`已导出 JSON + ${sheets.length} 个 CSV（Excel 库未加载，已自动降级）`, 'warning');
      }
    } catch (e) {
      this.toast('导出失败：' + e.message, 'error');
    }
  },

  openImportDialog() {
    this.openModal('导入数据（合并到当前数据）', `
      <p class="text-sm text-slate-600 mb-3">支持导入之前导出的 JSON 备份文件。导入模式：</p>
      <div class="flex gap-2 mb-3">
        <label class="flex items-center gap-2"><input type="radio" name="importMode" value="merge" checked> 合并（保留现有，追加新数据）</label>
        <label class="flex items-center gap-2"><input type="radio" name="importMode" value="replace"> 替换（清空后导入）</label>
      </div>
      <input type="file" id="importFile" accept=".json" class="block w-full text-sm border border-slate-300 rounded p-2" />
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'this.closeModal()' },
      { text: '确认导入', class: 'btn btn-primary', action: 'app.doImport()' }
    ]);
  },

  doImport() {
    const file = document.getElementById('importFile').files[0];
    if (!file) return this.toast('请先选择文件', 'warning');
    const mode = document.querySelector('input[name=importMode]:checked').value;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (mode === 'replace') {
          this.state = { ...this.state, ...data };
        } else {
          // 合并：去重 destination
          const existIds = new Set(this.state.destinations.map(d => d.id));
          (data.destinations || []).forEach(d => { if (!existIds.has(d.id)) this.state.destinations.push(d); });
          // 合并子数据：顶层数组按 id 去重追加；对象（各目的地数据桶）按字段合并
          Object.keys(data).forEach(k => {
            if (k === 'destinations' || k === 'activeDestinationId') return;
            if (k === 'checklists') {
              this.state.checklists.documents = [...(this.state.checklists.documents || []), ...(data.checklists?.documents || [])];
              this.state.checklists.luggage = [...(this.state.checklists.luggage || []), ...(data.checklists?.luggage || [])];
            } else {
              const cur = this.state[k], inc = data[k];
              // candidates / searchHistory 等顶层数组：按 id 去重追加，绝不能当对象 spread（否则 .map 会崩）
              if (Array.isArray(cur) || Array.isArray(inc)) {
                const arr = Array.isArray(cur) ? cur.slice() : [];
                const ids = new Set(arr.filter(x => x && x.id).map(x => x.id));
                (Array.isArray(inc) ? inc : []).forEach(x => {
                  if (x && x.id) { if (ids.has(x.id)) return; ids.add(x.id); }
                  arr.push(x);
                });
                this.state[k] = arr;
              } else {
                this.state[k] = { ...(cur || {}), ...(inc || {}) };
              }
            }
          });
        }
        // 兜底：修正可能的结构异常（如曾被错误转成对象的 candidates）→ 还原为数组，避免数据丢失与渲染崩溃
        this.normalizeState(this.state);
        this.saveState();
        this.renderAll();
        this.closeModal();
        this.toast('数据导入成功', 'success');
      } catch (err) {
        this.toast('文件解析失败：' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  },

  openBackupDialog() {
    this.openModal('💾 备份与恢复', `
      <div class="space-y-3 text-sm">
        <div class="p-3 bg-sky-50 rounded border border-sky-200">
          <strong>📥 导出 JSON 备份：</strong>将所有数据保存为 JSON 文件，建议定期备份到本地磁盘或网盘。
        </div>
        <div class="p-3 bg-amber-50 rounded border border-amber-200">
          <strong>📤 恢复 JSON 备份：</strong>从之前备份的 JSON 文件恢复数据。
        </div>
        <div class="p-3 bg-red-50 rounded border border-red-200">
          <strong>🗑️ 清空数据：</strong>慎用！将删除所有目的地、行程、花销、素材、清单。此操作不可撤销，请先备份。
        </div>
      </div>
    `, [
      { text: '导出 JSON', class: 'btn btn-success', action: 'app.exportJson()' },
      { text: '恢复 JSON', class: 'btn btn-warning', action: 'app.importJson()' },
      { text: '清空全部', class: 'btn btn-danger', action: 'app.confirmClear()' },
      { text: '关闭', class: 'btn btn-ghost', action: 'app.closeModal()' }
    ]);
  },

  exportJson() {
    const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `travel_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('JSON 备份已下载', 'success');
  },

  importJson() {
    this.closeModal();
    this.openImportDialog();
  },

  confirmClear() {
    if (!confirm('⚠️ 真的要清空所有数据吗？此操作不可撤销！建议先点击「导出 JSON」备份。')) return;
    if (!confirm('请再次确认：所有目的地、行程、花销、素材、清单将永久删除。')) return;
    this.state = {
      destinations: [],
      activeDestinationId: null,
      checklists: { documents: [], luggage: [] },
      searchHistory: []
    };
    this.saveState();
    this.renderAll();
    this.closeModal();
    this.toast('已清空全部数据', 'warning');
  },

  /* ====== 模态框 ====== */
  openModal(title, bodyHtml, actions = []) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="modal-header">
            <h3 class="font-semibold text-lg">${title}</h3>
            <button onclick="app.closeModal()" class="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
          </div>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-footer">
            ${actions.map(a => `<button class="${a.class}" onclick="${a.action}">${a.text}</button>`).join('')}
          </div>
        </div>
      </div>
    `;
  },

  closeModal() {
    const root = document.getElementById('modalRoot');
    if (!root) return;
    root.innerHTML = '';
    if (this._pendingRemote) {
      const d = this._pendingRemote;
      this._pendingRemote = null;
      this.applyRemote(d);
    }
  },

  /* ====== Toast 通知 ====== */
  toast(message, type = 'info', duration = 3000) {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  /* ====== 工具：日期差 ====== */
  dateDiff(start, end) {
    if (!start || !end) return 0;
    const s = new Date(start), e = new Date(end);
    return Math.max(0, Math.round((e - s) / 86400000) + 1);
  },

  /* 目的地显示名称：优先用合并后的 name，旧数据回退到「城市, 国家」 */
  destName(d) {
    if (!d) return '未命名目的地';
    return d.name || [d.city, d.country].filter(Boolean).join(', ') || '未命名目的地';
  },

  /* ====== 工具：格式化今日 ====== */
  today() { return new Date().toISOString().slice(0, 10); }
};
