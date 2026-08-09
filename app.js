/* =====================================================================
   旅行规划工作台 - 主应用
   - 本地存储（localStorage）
   - 6大核心板块固定
   - 状态管理 + UI 控制
   ===================================================================== */

const STORAGE_KEY = 'travel_workspace_v1';
const CACHE_KEY = 'travel_board_cache'; // 后端模式安全网：镜像服务端最新态到本地，防传输/SSE 竞态丢数据（与本地模式的 STORAGE_KEY 隔离，互不干扰迁移逻辑）

const app = {
  // 全局状态
  state: {
    destinations: [],        // 目的地档案库
    activeDestinationId: null, // 当前选中的目的地
    checklists: {
      documents: [],          // 证件清单
      luggage: [],            // 行李清单
      todos: []               // 待办事项（名称 + 详情 + 完成勾选）
    },
    searchHistory: []         // 全网检索历史
  },

  // 板块模块（由各 module-*.js 注册）
  modules: {},

  // 后端（多人协作 / 服务端永久存储）运行时状态
  backend: { enabled: false, base: '' },
  sessionToken: null,
  sessionUser: null,
  _lastSig: '',
  _pendingRemote: null,
  _saveTimer: null,
  _online: 0,
  _lastSaved: '',
  _sse: null,

  /* ====== 初始化 ====== */
  init() {
    this.readConfig();
    this._initI18n();
    if (this.backend.enabled) {
      // 后端模式：登录闸门 → 拉取服务端看板 → 实时同步
      this.sessionToken = this.localGet('travel_board_token');
      this.sessionUser = this.localGet('travel_board_user');
      this.updateStatus();
      this.startBackend();
      return;
    }
    // 本地模式（默认）：localStorage 持久化存储
    this.loadState();
    if (typeof this.ensureChecklists === 'function') this.ensureChecklists();
    this.bindNavTabs();
    this.renderSwitcher();
    this.renderAll();
    this.updateStorageStats();
    if (this.state.destinations.length === 0) {
      this.toast(this.t('toast.welcome'), 'success');
    } else {
      this.toast(this.t('toast.loaded', { n: this.state.destinations.length }), 'success');
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
        this.migrateLocalStorageToBackend();
        this.bindNavTabs();
        this.renderSwitcher();
        this.renderAll();
        this.updateStatus();
        this.toast(this.t('toast.boardConnected', { u: this.sessionUser || '?' }), 'success');
      })
      .catch(() => {
        // 服务端连不上：若有本地缓存（上次成功镜像），先渲染出来，避免白屏/丢数据
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) { this.state = this.normalizeState(JSON.parse(raw)); }
        } catch (e) {}
        if (typeof this.ensureChecklists === 'function') this.ensureChecklists();
        this.renderSwitcher();
        this.renderAll();
        this.toast(this.t('status.connectError'), 'error');
        this.updateStatus(this.t('status.connectError'));
      });
  },

  showLogin() {
    this.openModal(this.t('auth.loginTitle'), `
      <p class="text-sm text-slate-600 mb-3">${this.t('auth.loginIntro')}</p>
      <div class="form-field">
        <label>${this.t('auth.username')}</label>
        <input id="loginUser" value="${this.sessionUser || ''}" placeholder="如 owner" onkeydown="if(event.key==='Enter')document.getElementById('loginPw').focus()" />
      </div>
      <div class="form-field">
        <label>${this.t('auth.password')}</label>
        <input id="loginPw" type="password" placeholder="${this.t('auth.password')}" onkeydown="if(event.key==='Enter')app.doUnlock(document.getElementById('loginUser').value, document.getElementById('loginPw').value)" />
      </div>
      <p class="text-tiny text-slate-500 mt-2">${this.t('auth.forgotHint')} <a href="javascript:void(0)" onclick="app.showRegister()" class="text-sky-700 hover:underline">${this.t('auth.registerLink')}</a></p>
    `, [
      { text: this.t('auth.login'), class: 'btn btn-primary', action: "app.doUnlock(document.getElementById('loginUser').value, document.getElementById('loginPw').value)" }
    ]);
    setTimeout(() => { const i = document.getElementById('loginUser'); if (i) i.focus(); }, 50);
  },

  doUnlock(username, pw) {
    username = (username || '').trim(); pw = (pw || '').trim();
    if (!username) return this.toast('请输入用户名', 'warning');
    if (!pw) return this.toast('请输入密码', 'warning');
    fetch(this.base() + '/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pw })
    })
      .then(r => r.json().then(j => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (status === 200 && j && j.token) this._applyAuth(username, j.token);
        else this.toast((j && j.error) || '用户名或密码错误', 'error');
      })
      .catch(() => this.toast('无法连接服务端', 'error'));
  },

  showRegister() {
    this.openModal(this.t('auth.registerTitle'), `
      <p class="text-sm text-slate-600 mb-3">${this.t('auth.registerIntro')}</p>
      <div class="form-field">
        <label>${this.t('auth.usernameHint')}</label>
        <input id="regUser" placeholder="如 michael" onkeydown="if(event.key==='Enter')document.getElementById('regPw').focus()" />
      </div>
      <div class="form-field">
        <label>${this.t('auth.password')}</label>
        <input id="regPw" type="password" placeholder="${this.t('auth.password')}" onkeydown="if(event.key==='Enter')document.getElementById('regPw2').focus()" />
      </div>
      <div class="form-field">
        <label>${this.t('auth.confirmPw')}</label>
        <input id="regPw2" type="password" placeholder="${this.t('auth.confirmPw')}" onkeydown="if(event.key==='Enter')app.doRegister(document.getElementById('regUser').value, document.getElementById('regPw').value, document.getElementById('regPw2').value)" />
      </div>
      <p class="text-tiny text-slate-500 mt-2">${this.t('auth.hasAccount')}<a href="javascript:void(0)" onclick="app.showLogin()" class="text-sky-700 hover:underline">${this.t('auth.backToLogin')}</a></p>
    `, [
      { text: this.t('auth.registerSubmit'), class: 'btn btn-primary', action: "app.doRegister(document.getElementById('regUser').value, document.getElementById('regPw').value, document.getElementById('regPw2').value)" }
    ]);
    setTimeout(() => { const i = document.getElementById('regUser'); if (i) i.focus(); }, 50);
  },

  doRegister(username, pw, pw2) {
    username = (username || '').trim(); pw = (pw || '').trim(); pw2 = (pw2 || '').trim();
    if (!username) return this.toast('请输入用户名', 'warning');
    if (pw.length < 1) return this.toast('密码不能为空', 'warning');
    if (pw !== pw2) return this.toast('两次密码不一致', 'warning');
    fetch(this.base() + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pw })
    })
      .then(r => r.json().then(j => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (status === 200 && j && j.token) { this.closeModal(); this._applyAuth(username, j.token); }
        else this.toast((j && j.error) || '注册失败', 'error');
      })
      .catch(() => this.toast('无法连接服务端', 'error'));
  },

  _applyAuth(username, token) {
    this.sessionUser = username;
    this.sessionToken = token;
    this.localSet('travel_board_user', username);
    this.localSet('travel_board_token', token);
    this.closeModal();
    this.startBackend();
  },

  logout() {
    this.sessionUser = null;
    this.sessionToken = null;
    this.localSet('travel_board_user', '');
    this.localSet('travel_board_token', '');
    if (this._sse) { try { this._sse.close(); } catch (e) {} this._sse = null; }
    this.updateStatus();
    this.showLogin();
    this.toast(this.t('auth.loggedOut'), 'info');
  },

  /* ====== 改密码 / 重置他人密码 ====== */
  showChangePassword() {
    this.openModal(this.t('auth.changePwTitle'), `
      <div class="form-field">
        <label>${this.t('auth.oldPw')}</label>
        <input id="cpOld" type="password" placeholder="${this.t('auth.oldPw')}" onkeydown="if(event.key==='Enter')document.getElementById('cpNew').focus()" />
      </div>
      <div class="form-field">
        <label>${this.t('auth.newPw')}</label>
        <input id="cpNew" type="password" placeholder="${this.t('auth.newPw')}" onkeydown="if(event.key==='Enter')document.getElementById('cpNew2').focus()" />
      </div>
      <div class="form-field">
        <label>${this.t('auth.confirmPw')}</label>
        <input id="cpNew2" type="password" placeholder="${this.t('auth.confirmPw')}" onkeydown="if(event.key==='Enter')app.doChangePassword(document.getElementById('cpOld').value, document.getElementById('cpNew').value, document.getElementById('cpNew2').value)" />
      </div>
    `, [
      { text: this.t('auth.changePw'), class: 'btn btn-primary', action: "app.doChangePassword(document.getElementById('cpOld').value, document.getElementById('cpNew').value, document.getElementById('cpNew2').value)" },
      { text: this.t('backup.close'), class: 'btn btn-ghost', action: 'app.closeModal()' }
    ]);
    setTimeout(() => { const i = document.getElementById('cpOld'); if (i) i.focus(); }, 50);
  },

  doChangePassword(oldPw, newPw, newPw2) {
    oldPw = (oldPw || '').trim(); newPw = (newPw || '').trim(); newPw2 = (newPw2 || '').trim();
    if (!oldPw) return this.toast(this.t('auth.oldPw') + '?', 'warning');
    if (!newPw) return this.toast(this.t('auth.newPw') + '?', 'warning');
    if (newPw !== newPw2) return this.toast(this.t('auth.pwMismatch'), 'warning');
    fetch(this.base() + '/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.sessionToken },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
    })
      .then(r => r.json().then(j => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (status === 200 && j && j.token) { this.closeModal(); this._setSessionToken(j.token); this.toast(this.t('auth.pwChanged'), 'success'); }
        else this.toast((j && j.error) || this.t('auth.oldPwWrong'), 'error');
      })
      .catch(() => this.toast(this.t('auth.connectError'), 'error'));
  },

  showResetUser() {
    fetch(this.base() + '/api/admin/users', { headers: { Authorization: 'Bearer ' + this.sessionToken } })
      .then(r => r.json().then(j => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (status !== 200 || !j.ok) { this.toast(this.t('auth.noPerm'), 'error'); return; }
        const opts = (j.users || []).map(u => `<option value="${this._esc(u)}">${this._esc(u)}</option>`).join('');
        this.openModal(this.t('auth.resetTitle'), `
          <div class="form-field">
            <label>${this.t('auth.targetUser')}</label>
            <select id="ruTarget" class="w-full border border-slate-300 rounded px-2 py-1">${opts}</select>
          </div>
          <div class="form-field">
            <label>${this.t('auth.newPw')}</label>
            <input id="ruNew" type="password" placeholder="${this.t('auth.newPw')}" onkeydown="if(event.key==='Enter')app.doResetUser(document.getElementById('ruTarget').value, document.getElementById('ruNew').value)" />
          </div>
        `, [
          { text: this.t('auth.resetSubmit'), class: 'btn btn-primary', action: "app.doResetUser(document.getElementById('ruTarget').value, document.getElementById('ruNew').value)" },
          { text: this.t('backup.close'), class: 'btn btn-ghost', action: 'app.closeModal()' }
        ]);
      })
      .catch(() => this.toast(this.t('auth.connectError'), 'error'));
  },

  doResetUser(target, newPw) {
    target = (target || '').trim(); newPw = (newPw || '').trim();
    if (!target) return this.toast(this.t('auth.targetUser') + '?', 'warning');
    if (!newPw) return this.toast(this.t('auth.newPw') + '?', 'warning');
    fetch(this.base() + '/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.sessionToken },
      body: JSON.stringify({ target, newPassword: newPw })
    })
      .then(r => r.json().then(j => ({ status: r.status, j })))
      .then(({ status, j }) => {
        if (status === 200 && j && j.ok) { this.closeModal(); this.toast(this.t('auth.pwResetDone'), 'success'); }
        else this.toast((j && j.error) || this.t('auth.noPerm'), 'error');
      })
      .catch(() => this.toast(this.t('auth.connectError'), 'error'));
  },

  // 更新会话 token（改密码后服务端返回新 token）并重启 SSE
  _setSessionToken(token) {
    this.sessionToken = token;
    this.localSet('travel_board_token', token);
    if (this._sse) { try { this._sse.close(); } catch (e) {} this._sse = null; }
    this.connectSSE();
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
        this._writeLocalCache();
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
      es.onerror = () => { this._online = 0; this.updateStatus(this.t('status.disconnected')); };
    } catch (e) {}
  },

  handleRemoteState(data) {
    if (!data || typeof data !== 'object') return;
    const localSig = JSON.stringify(this.state);
    // 与本地一致（多半是自己刚保存的回声）→ 跳过，避免回环重渲染
    if (JSON.stringify(data) === localSig) return;
    // 本地还有未推送的改动（弹窗编辑中 / 防抖保存尚未触发）→ 先暂存远端，不急着覆盖，
    // 否则会把用户刚新增/修改的内容冲掉（典型症状：点了「➕ 添加」却看不到、刷新后也没了）。
    const hasPendingLocal = this._saveTimer !== null || this._lastSig !== localSig;
    if (this.isModalOpen() || hasPendingLocal) { this._pendingRemote = data; return; }
    this.applyRemote(data);
  },

  // 本地改动推送成功后，把暂存的远端状态应用进来（此时本地改动已落盘，覆盖是安全的）。
  // 若暂存态与当前态相同则跳过，避免无谓重渲染。
  _flushPendingRemote() {
    // 本地改动已成功落盘（此刻服务端以本地刚推送的版本为准）。
    // 此前在「本地有待推送改动」期间暂存的远端状态，此刻已落后于本地推送；
    // 若再原样套用，会把用户刚保存的改动（如刚勾选的框）冲掉，
    // 造成勾选框反复勾选/取消的抖动（两台电脑同时开页面时最明显）。
    // 因此直接丢弃：更新的远端状态会通过后续 SSE 广播自然到达并正常应用。
    this._pendingRemote = null;
  },

  // 后端模式安全网：把当前态镜像到本地缓存，防止「推送/接收竞态」导致数据在刷新后丢失。
  _writeLocalCache() {
    if (!this.backend.enabled) return;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.state)); } catch (e) {}
  },

  applyRemote(data) {
    this.state = this.normalizeState(data);
    this._lastSig = JSON.stringify(this.state);
    // 注意：这里【不要】调用 ensureChecklists（它会 saveState → 触发 pushBoard → 服务端再广播 → 另一端又 applyRemote），
    // 否则一端收到远端状态后会立刻回推，形成「广播风暴」：两台电脑互相不停推送同一份状态，
    // 表现为勾选框自动反复勾选/取消。远端状态已是服务端权威态，只应用+渲染即可，无需再保存。
    this.renderSwitcher();
    this.renderAll();
    this.updateStatus();
  },

  // 一次性迁移：从「浏览器本地模式」切换到「后端付费磁盘模式」时，
  // 把此前在本地模式录入的数据推送到服务端，避免数据被丢弃。
  // 触发条件：已登录后端、服务端看板为空、但浏览器 localStorage 有数据。
  // 迁移完成后把本地副本归档（改名保留，便于救回），不再作为自动加载源。
  migrateLocalStorageToBackend() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = this.normalizeState(JSON.parse(raw));
      const localHas = Array.isArray(data.destinations) && data.destinations.length > 0;
      const serverHas = Array.isArray(this.state.destinations) && this.state.destinations.length > 0;
      if (localHas && !serverHas) {
        // 服务端为空、本地是唯一真实数据 → 以本地覆盖服务端
        this.state = data;
        this._lastSig = '';
        const done = this.pushBoard();
        this.toast(this.t('toast.migrated', { n: data.destinations.length }), 'success');
        Promise.resolve(done).then(() => {
          try { localStorage.setItem(STORAGE_KEY + '_migrated', raw); localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        });
      } else if (localHas && serverHas) {
        // 两端都有数据：以服务端为准（多人协作的权威态），本地仅做归档保留、不覆盖
        try { localStorage.setItem(STORAGE_KEY + '_migrated', raw); localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        this.toast(this.t('toast.migratedConflict'), 'info');
      }
    } catch (e) {
      console.warn('[迁移] 本地数据迁移失败（忽略）：', e.message);
    }
  },

  isModalOpen() {
    const r = document.getElementById('modalRoot');
    return !!(r && r.innerHTML && r.innerHTML.trim());
  },

  // 主动从服务端拉取最新看板（多人协作时，一键同步协作者刚保存的内容）。
  // 注意：原全站「刷新最新数据」按钮已移除（改为每个地图地点上的「📍 用链接定位」），此方法保留为公共 API。
  // 仅在后端模式 + 已登录 + 本地有缓存快照时才可用（无缓存即本地即权威，无需刷新）。
  refreshFromServer() {
    if (!this.backend.enabled || !this.sessionToken) return;
    try { if (!localStorage.getItem(CACHE_KEY)) return; } catch (e) {}
    this.updateStatus('正在拉取最新数据…');
    this.fetchBoard().then(() => {
      this.renderSwitcher();
      this.renderAll();
      this._writeLocalCache();
      this.updateStatus();
      this.toast('已拉取最新数据', 'success');
    }).catch(() => this.updateStatus(this.t('status.saveFail')));
  },

  updateStatus(extra) {
    const el = document.getElementById('boardStatus');
    if (!el) return;
    if (!this.backend.enabled) { el.classList.add('hidden'); el.textContent = ''; this._renderAccountBar(); return; }
    el.classList.remove('hidden');
    let s = this.t('status.unlocked');
    const online = this._online > 0 ? this._online : (this._sse && this._sse.readyState === 1 ? 1 : 0);
    if (online > 0) s += ' · ' + this.t('status.online', { n: online });
    if (extra) s += ' · ' + extra;
    else if (this._lastSaved) s += ' · ' + this._lastSaved;
    el.textContent = s;
    this._renderAccountBar();
  },

  _renderAccountBar() {
    const bar = document.getElementById('accountBar');
    if (!bar) return;
    if (!this.backend.enabled || !this.sessionUser) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    let html = `👤 <strong>${this._esc(this.sessionUser)}</strong>` +
      `<button class="text-sky-700 hover:underline" onclick="app.showChangePassword()">${this.t('auth.changePw')}</button>`;
    if (this.sessionUser === 'owner') {
      html += `<button class="text-sky-700 hover:underline" onclick="app.showResetUser()">${this.t('auth.resetOther')}</button>`;
    }
    html += `<button class="text-sky-700 hover:underline" onclick="app.logout()">${this.t('auth.logout')}</button>`;
    bar.innerHTML = html;
  },

  // 初始化界面语言：设置 <html lang> + 翻译静态元素 + 导航
  _initI18n() {
    // 关闭双语时隐藏切换按钮（index.html 已默认带 hidden，这里兜底防止手工改回时漏掉）
    const btn = document.getElementById('langToggle');
    if (btn) btn.classList.toggle('hidden', !this.i18nEnabled);
    const html = document.querySelector('html');
    if (html) html.setAttribute('lang', this.i18nLang() === 'en' ? 'en' : 'zh-CN');
    this._applyI18n(document);
    this._renderNav();
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /* ====== 国际化（中/EN） ====== */
  // 语言切换入口总开关：false = 隐藏顶部 🌐 按钮并强制中文。
  // i18n 基建（字典 / t() / data-i18n）全部保留，日后想开双语把这里改回 true 即可。
  i18nEnabled: false,

  i18nLang() {
    if (!this.i18nEnabled) return 'zh';
    try { return localStorage.getItem('travel_lang') || 'zh'; } catch (e) { return 'zh'; }
  },

  // 取翻译文案：dict[lang][key] → 回退 zh → key；支持 {var} 插值
  t(key, vars) {
    const I = (typeof window !== 'undefined' && window.I18N) || {};
    const dict = I.dict || {};
    let s = (dict[this.i18nLang()] && dict[this.i18nLang()][key]) != null
      ? dict[this.i18nLang()][key]
      : ((dict.zh && dict.zh[key]) != null ? dict.zh[key] : key);
    if (vars && typeof s === 'string') {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    }
    return s;
  },

  setLang(l) {
    if (!this.i18nEnabled) return;
    try { localStorage.setItem('travel_lang', l); } catch (e) {}
    this._lang = l;
    const html = document.querySelector('html');
    if (html) html.setAttribute('lang', l === 'en' ? 'en' : 'zh-CN');
    this._applyI18n(document);
    this._renderNav();
    if (typeof this.renderAll === 'function') this.renderAll();
    this.updateStatus();
    this._renderAccountBar();
  },

  toggleLang() {
    this.setLang(this.i18nLang() === 'zh' ? 'en' : 'zh');
  },

  // 把带 data-i18n="key" 的静态元素文案替换为翻译（index.html 里的标题/按钮/nav 等）
  _applyI18n(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = this.t(key);
    });
  },

  // 翻译导航 Tab（用 data-i18n 属性）
  _renderNav() {
    document.querySelectorAll('#navTabs .tab-btn').forEach(btn => {
      const key = btn.getAttribute('data-i18n');
      if (key) btn.textContent = this.t(key);
    });
  },

  nowTime() {
    try { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  },

  pushBoard() {
    this._saveTimer = null; // 标记：本地改动已进入推送流程（防抖计时结束，避免 _saveTimer 常驻导致后续远端被误判为「有待推送改动」）
    if (!this.sessionToken) return Promise.resolve();
    // 并发编辑保护：若「本地有待推送改动期间」暂存了协作者的远端更新，推送前先把它并入本地，
    // 避免把对方刚新增的行程块覆盖掉（典型症状：2 人同时编辑，一方保存后，另一方因推送旧态导致对方新增的块消失）。
    // 合并若因远端数据结构异常而抛错，绝不能因此丢掉本地已编辑好的内容：丢弃暂存态、保住本地、照常推送。
    if (this._pendingRemote) {
      try {
        this.state = this.mergeStatesPreferLocal(this._pendingRemote, this.state);
        this._lastSig = JSON.stringify(this.state);
      } catch (e) {
        console.error('[合并远端态失败] 已丢弃暂存态、保留本地改动：', e);
        this.toast('合并协作者的更新失败，已保留你本地的修改', 'warning');
      }
      this._pendingRemote = null;
    }
    const payload = JSON.stringify(this.state);
    this._writeLocalCache(); // 安全网：推送前先镜像一份到本地
    this.updateStatus(this.t('status.saving'));
    return fetch(this.base() + '/api/board', {
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
          this._lastSaved = this.t('status.saved') + ' ' + this.nowTime();
          this.updateStatus();
          this._flushPendingRemote(); // 本地改动已落盘，现在可以把此前暂存的远端状态安全合并进来
        } else if (j === null) {
          // 已跳转登录
        } else {
          this.updateStatus(this.t('status.saveFail'));
        }
      })
      .catch(() => this.updateStatus(this.t('status.saveFail')));
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
    if (!s.checklists || typeof s.checklists !== 'object') s.checklists = { documents: [], luggage: [], todos: [] };
    else {
      if (!Array.isArray(s.checklists.documents)) s.checklists.documents = (s.checklists.documents && typeof s.checklists.documents === 'object') ? Object.values(s.checklists.documents) : [];
      if (!Array.isArray(s.checklists.luggage)) s.checklists.luggage = (s.checklists.luggage && typeof s.checklists.luggage === 'object') ? Object.values(s.checklists.luggage) : [];
      if (!Array.isArray(s.checklists.todos)) s.checklists.todos = (s.checklists.todos && typeof s.checklists.todos === 'object') ? Object.values(s.checklists.todos) : [];
    }
    return s;
  },

  /* 合并两份看板状态：以 local 为准，补回 remote 中「local 没有、但 remote 有」的项目（按 id 并集）。
     用途：当本地有待推送改动、又收到了协作者（另一台电脑）的远端更新时，在推送前把远端新增项并入本地，
     避免「后保存的一方把先保存的一方刚添加的行程块覆盖掉」的并发丢失（典型：2 人同时编辑，一方保存后另一方因推送旧态而丢失对方新增）。
     冲突（同一 id 双方都有）以 local 版本为准；只有 remote 独有的项会被补回。 */
  mergeStatesPreferLocal(remote, local) {
    if (!local) return remote;
    if (!remote) return local;
    const out = JSON.parse(JSON.stringify(local)); // local 优先
    const addMissing = (arrRemote, arrLocal, key) => {
      if (!Array.isArray(arrRemote)) return;
      const ids = new Set((arrLocal || []).map(x => x[key]));
      arrRemote.forEach(x => { if (x && x[key] != null && !ids.has(x[key])) arrLocal.push(JSON.parse(JSON.stringify(x))); });
    };
    // 目的地：补回 remote 独有的目的地，并按目的地并集其每日行程与行程块
    const rDests = new Map((remote.destinations || []).map(d => [d.id, d]));
    (out.destinations || []).forEach(d => {
      const rd = rDests.get(d.id); if (!rd || typeof rd !== 'object') return;
      if (!Array.isArray(d.itinerary)) d.itinerary = [];
      const rDays = new Map((rd.itinerary || []).map(day => [day.id, day]));
      (rd.itinerary || []).forEach(rDay => {
        let lDay = d.itinerary.find(x => x.id === rDay.id);
        if (!lDay) { lDay = JSON.parse(JSON.stringify(rDay)); d.itinerary.push(lDay); return; }
        addMissing(rDay.spots || [], lDay.spots || (lDay.spots = []), 'id');
      });
    });
    addMissing(remote.destinations || [], out.destinations || (out.destinations = []), 'id');
    // 候选库：补回 remote 独有项
    addMissing(remote.candidates || [], out.candidates || (out.candidates = []), 'id');
    // 核对清单：每个列表按 id 并集
    if (remote.checklists) {
      out.checklists = out.checklists || {};
      ['documents', 'luggage', 'todos'].forEach(k => {
        const rl = remote.checklists[k] || [];
        const ll = out.checklists[k] || (out.checklists[k] = []);
        addMissing(rl, ll, 'id');
      });
    }
    return out;
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
      this._writeLocalCache(); // 安全网：本地镜像一份，防止传输/SSE 竞态导致的数据丢失
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => { this._saveTimer = null; this.pushBoard(); }, 500);
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
    const budget = this.getBudgetTotal(d.id);
    el.textContent = `· ${d.travelers || 0} 人 · 预算 ¥${budget.toFixed(0)} · 已花 ¥${expenseSum.toFixed(0)}`;
  },

  /* ====== 工具：当前目的地 ====== */
  getActiveDestination() {
    return this.state.destinations.find(d => d.id === this.state.activeDestinationId) || null;
  },

  /* ====== 工具：花销总额 ======
     计价模型（与预算一致）：每条记录有 priceType
       - 'total' = 总价（已含全部人），不再乘人数；
       - 'per'   = 单人价格 × 本次旅行人数 d.travelers；
       - 旧数据无 priceType 时回落原 people 乘数（向后兼容）。
     单项金额先按货币折算台币，再乘对应人数。 */
  getExpensesTotal(destId) {
    const d = this.state.destinations.find(x => x.id === destId);
    if (!d) return 0;
    const list = this.state[destId]?.expenses || [];
    const rate = parseFloat(d.audToTwd) || 21;
    const travelers = Math.max(1, parseFloat(d.travelers) || 1);
    return list.reduce((s, e) => {
      const unit = (e.currency === 'AUD' ? (parseFloat(e.amount) || 0) * rate : (parseFloat(e.amount) || 0));
      let mult;
      if (e.single) mult = 1;
      else if (e.priceType === 'total') mult = 1;
      else if (e.priceType === undefined) mult = (parseFloat(e.people) || 1);
      else mult = travelers;
      return s + unit * mult;
    }, 0);
  },

  /* ====== 工具：预算总额（逐项预算；无逐项时回落整体预算 d.budget） ======
     计价模型同上：priceType('total'|'per') × 旅行人数 d.travelers；旧数据回落 people。 */
  getBudgetTotal(destId) {
    const d = this.state.destinations.find(x => x.id === destId);
    if (!d) return 0;
    const items = this.state[destId]?.budgets || [];
    if (items.length > 0) {
      const rate = parseFloat(d.audToTwd) || 21;
      const travelers = Math.max(1, parseFloat(d.travelers) || 1);
      return items.reduce((s, b) => {
        const unit = (b.currency === 'AUD' ? (parseFloat(b.amount) || 0) * rate : (parseFloat(b.amount) || 0));
        let mult;
        if (b.priceType === 'total') mult = 1;
        else if (b.priceType === undefined) mult = (parseFloat(b.people) || 1);
        else mult = travelers;
        return s + unit * mult;
      }, 0);
    }
    return parseFloat(d.budget) || 0;
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
        '总预算(¥)': app.getBudgetTotal(d.id), '备注': d.notes
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
        this.toast(this.t('export.excelDone'), 'success');
      } else {
        const ts = new Date().toISOString().slice(0, 10);
        sheets.forEach(s => this.downloadCSV(`travel_${s.name}_${ts}.csv`, s.rows));
        this.toast(this.t('export.csvDone', { n: sheets.length }), 'warning');
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
              this.state.checklists.todos = [...(this.state.checklists.todos || []), ...(data.checklists?.todos || [])];
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
    this.openModal(this.t('backup.title'), `
      <div class="space-y-3 text-sm">
        <div class="p-3 bg-sky-50 rounded border border-sky-200">
          <strong>📥 ${this.t('backup.exportLabel')}：</strong>${this.t('backup.exportHint')}
        </div>
        <div class="p-3 bg-amber-50 rounded border border-amber-200">
          <strong>📤 ${this.t('backup.importLabel')}：</strong>${this.t('backup.importHint')}
        </div>
        <div class="p-3 bg-red-50 rounded border border-red-200">
          <strong>🗑️ ${this.t('backup.clearLabel')}：</strong>${this.t('backup.clearHint')}
        </div>
      </div>
    `, [
      { text: this.t('backup.exportJson'), class: 'btn btn-success', action: 'app.exportJson()' },
      { text: this.t('backup.importJson'), class: 'btn btn-warning', action: 'app.importJson()' },
      { text: this.t('backup.clearAll'), class: 'btn btn-danger', action: 'app.confirmClear()' },
      { text: this.t('backup.close'), class: 'btn btn-ghost', action: 'app.closeModal()' }
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
    this.toast(this.t('backup.exportDone'), 'success');
  },

  importJson() {
    this.closeModal();
    this.openImportDialog();
  },

  confirmClear() {
    if (!confirm(this.t('clear.confirm1'))) return;
    if (!confirm(this.t('clear.confirm2'))) return;
    this.state = {
      destinations: [],
      activeDestinationId: null,
      checklists: { documents: [], luggage: [], todos: [] },
      searchHistory: []
    };
    this.saveState();
    this.renderAll();
    this.closeModal();
    this.toast(this.t('clear.done'), 'warning');
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
