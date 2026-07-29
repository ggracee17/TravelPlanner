/* ============================================================
   板块6：全网检索知识库
   用户下达检索指令 → 触发 AI 联网检索 → 结果归档持久化
   检索维度：景点、美食、交通、天气、避坑、消费水平
   ============================================================ */

// 知识库分类与自动归类
const SEARCH_CATEGORIES = ['景点', '美食', '天气', '避坑', '花费', '通用'];

function detectSearchCategory(title) {
  const t = (title || '');
  if (/景点|打卡|玩|风景区|必去/.test(t)) return '景点';
  if (/美食|吃|食|餐厅|小吃|夜市/.test(t)) return '美食';
  if (/天气|气温|台风|穿衣|穿搭|气候/.test(t)) return '天气';
  if (/避坑|陷阱|注意|防骗|攻略|雷/.test(t)) return '避坑';
  if (/花费|预算|费用|物价|钱|消费|人均/.test(t)) return '花费';
  return '通用';
}

app.modules.search = {
  render() {
    const sec = document.querySelector('[data-section=search]');
    if (!sec) return;
    const d = app.getActiveDestination();
    const history = app.state.searchHistory || [];
    const view = (this._filter || '全部') === '全部'
      ? history
      : history.filter(h => (h.category || '通用') === (this._filter || '全部'));

    const templates = [
      { k: '景点', q: '高分景点 + 小众打卡地 + 限流政策' },
      { k: '美食', q: '必吃美食 + 老字号餐厅 + 人均价位' },
      { k: '交通', q: '机场到市区交通 + 市内交通卡 + 避坑' },
      { k: '天气', q: '近期天气预报 + 最佳出行时段' },
      { k: '避坑', q: '常见旅游陷阱 + 防骗指南 + 注意事项' },
      { k: '消费', q: '当地消费水平 + 物价参考 + 小费文化' }
    ];

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🔍 板块6 · 全网检索知识库</span>
          <button class="btn btn-success ml-auto" onclick="app.modules.search.showImport()">📥 导入检索结果</button>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          下达检索指令，AI 立即全网查询（景点 / 美食 / 交通 / 天气 / 避坑 / 消费水平），输出最新官方有效信息并归档。
        </p>

        <!-- 检索指令框 -->
        <div class="p-4 bg-sky-50 border border-sky-200 rounded-lg mb-4">
          <label class="text-sm font-semibold text-slate-700">🎯 检索指令</label>
          <div class="flex gap-2 mt-2">
            <input id="searchQuery" class="flex-1 px-3 py-2 border border-slate-300 rounded" placeholder="${d ? `${d.city} ` : ''}必吃美食 + 避坑指南" />
            <button class="btn btn-primary" onclick="app.modules.search.dispatch()">🚀 发起联网检索</button>
          </div>
          <p class="text-tiny text-slate-500 mt-2">提示：发起后，请把弹窗中的指令复制到对话框发给我，我将立即为您联网检索并生成可归档的结构化结果。</p>
        </div>

        <!-- 快捷模板 -->
        <div class="mb-4">
          <h4 class="text-sm font-semibold text-slate-700 mb-2">⚡ 常用检索模板（点击直接填入）</h4>
          <div class="flex flex-wrap gap-2">
            ${templates.map(t => `<button class="btn btn-ghost btn-sm" onclick="app.modules.search.useTemplate('${t.q.replace(/'/g, "\\'")}')">${t.k}</button>`).join('')}
          </div>
        </div>

        <!-- 分类筛选 -->
        <div class="mb-4">
          <h4 class="text-sm font-semibold text-slate-700 mb-2">🏷️ 分类筛选</h4>
          <div class="flex flex-wrap gap-2">
            ${['全部', ...SEARCH_CATEGORIES].map(cat => {
              const cnt = cat === '全部' ? history.length : history.filter(h => (h.category || '通用') === cat).length;
              const active = (this._filter || '全部') === cat ? 'active' : '';
              return `<button class="tab-btn ${active}" onclick="app.modules.search.setFilter('${cat}')">${cat} (${cnt})</button>`;
            }).join('')}
          </div>
        </div>

        <!-- 已归档检索结果 -->
        <h4 class="text-sm font-semibold text-slate-700 mb-2 mt-4">📚 已归档知识库（共 ${history.length} 条${(this._filter && this._filter !== '全部') ? '，当前筛选：' + this._filter + '（' + view.length + '）' : ''}）</h4>
        ${history.length === 0 ? `
          <div class="empty-state">
            <div class="icon">📖</div>
            <h3>知识库还是空的</h3>
            <p class="text-sm">下达检索指令，AI 检索后把结果归档到这里，永久保存随时调取</p>
          </div>
        ` : `
          <div class="space-y-3">
            ${view.slice().reverse().map(item => `
              <div class="search-result">
                <div class="flex items-start justify-between">
                  <div class="flex-1">
                    <h4>${item.title} <span style="font-size:11px;padding:1px 8px;border-radius:9999px;background:#e0f2fe;color:#0369a1;margin-left:4px">${item.category || '通用'}</span></h4>
                    <div class="text-tiny text-slate-400">🕐 ${item.timestamp || ''} ${item.dest ? '· 📍 ' + item.dest : ''}</div>
                  </div>
                  <div class="flex gap-1">
                    <button class="btn btn-ghost btn-sm" onclick="app.modules.search.editEntry('${item.id}')">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="app.modules.search.remove('${item.id}')">🗑️</button>
                  </div>
                </div>
                <div class="mt-2 text-sm text-slate-600 space-y-1">
                  ${(item.results || []).map(r => `
                    <div class="flex gap-2"><span>${r.icon || '•'}</span><div><strong>${r.head || ''}</strong> ${r.body || ''}${r.link ? ` <a href="${r.link}" target="_blank" class="text-sky-600 hover:underline">[链接]</a>` : ''}</div></div>
                  `).join('')}
                </div>
                ${item.note ? `<p class="text-tiny text-amber-600 mt-2">⚠️ ${item.note}</p>` : ''}
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  },

  useTemplate(q) {
    const d = app.getActiveDestination();
    const input = document.getElementById('searchQuery');
    if (input) input.value = (d ? d.city + ' ' : '') + q;
  },

  dispatch() {
    const q = document.getElementById('searchQuery')?.value.trim();
    if (!q) return app.toast('请输入检索指令', 'warning');
    const d = app.getActiveDestination();
    const fullQuery = d ? `检索「${d.city}, ${d.country}」：${q}` : `检索：${q}`;
    app.openModal('🚀 发起联网检索', `
      <div class="space-y-3">
        <p class="text-sm text-slate-600">已为您生成检索指令。请<strong>复制下方指令</strong>，关闭此窗口后粘贴到对话框发送给我，我将立即联网检索并生成可归档的结构化结果。</p>
        <div class="p-3 bg-slate-100 rounded font-mono text-sm break-all" id="genQuery" style="word-break:break-all">${fullQuery}</div>
        <button class="btn btn-primary w-full" onclick="app.copyText('${fullQuery.replace(/'/g, "\\'")}')">📋 复制指令</button>
        <p class="text-tiny text-slate-500">检索完成后，回到本题（板块6）点击「📥 导入检索结果」，把 AI 给出的 JSON 粘贴进去即可永久归档。</p>
      </div>
    `, [
      { text: '关闭', class: 'btn btn-ghost', action: 'app.closeModal()' }
    ]);
  },

  copyText(text) {
    navigator.clipboard?.writeText(text).then(
      () => app.toast('指令已复制，请到对话框发送', 'success'),
      () => { app.toast('复制失败，请手动选择复制', 'warning'); }
    );
  },

  showImport() {
    app.openModal('📥 导入检索结果', `
      <p class="text-sm text-slate-600 mb-2">把 AI 检索后给出的 <strong>JSON</strong> 结果粘贴到下方，即可归档到知识库。JSON 格式：</p>
      <pre class="text-tiny bg-slate-100 p-2 rounded mb-2 overflow-x-auto">{
  "title": "东京 必吃美食",
  "results": [
    { "icon":"🍜", "head":"一兰拉面", "body":"博多豚骨汤底，人均¥50", "link":"https://..." },
    { "icon":"🍣", "head":"筑地场外市场", "body":"海鲜早市，建议9点前到", "link":"" }
  ],
  "note": "部分餐厅周一休市"
}</pre>
      <div class="form-field col-span-full">
        <label>分类（导入后归类；选"自动识别"将按标题判断）</label>
        <select id="importCat">
          <option value="__auto__">自动识别</option>
          ${SEARCH_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-field col-span-full">
        <label>粘贴 JSON</label>
        <textarea id="importJson" rows="10" placeholder='{"title":"...","results":[...],"note":""}'></textarea>
      </div>
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '导入归档', class: 'btn btn-primary', action: 'app.modules.search.doImport()' }
    ]);
  },

  doImport() {
    const raw = document.getElementById('importJson').value.trim();
    if (!raw) return app.toast('内容为空', 'warning');
    try {
      const data = JSON.parse(raw);
      // 支持批量：数组，或 { entries: [...] }
      const list = Array.isArray(data) ? data
        : (data.entries && Array.isArray(data.entries)) ? data.entries
        : [data];
      const d = app.getActiveDestination();
      if (!app.state.searchHistory) app.state.searchHistory = [];
      const selCat = document.getElementById('importCat')?.value || '__auto__';
      let ok = 0;
      list.forEach(item => {
        if (!item || !item.title || !Array.isArray(item.results)) return;
        const cat = item.category || (selCat !== '__auto__' ? selCat : detectSearchCategory(item.title));
        app.state.searchHistory.push({
          id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          title: item.title,
          category: cat,
          results: item.results,
          note: item.note || '',
          dest: d ? `${d.city}, ${d.country}` : '',
          timestamp: new Date().toLocaleString('zh-CN')
        });
        ok++;
      });
      if (ok === 0) throw new Error('未找到有效条目（每条需含 title 与 results 数组）');
      app.saveState();
      app.closeModal();
      this.render();
      app.toast(`✅ 已归档 ${ok} 条检索结果`, 'success');
    } catch (e) {
      app.toast('JSON 解析失败：' + e.message, 'error');
    }
  },

  remove(id) {
    if (!confirm('确定删除该检索归档？')) return;
    app.state.searchHistory = (app.state.searchHistory || []).filter(x => x.id !== id);
    app.saveState();
    this.render();
  },

  setFilter(cat) {
    this._filter = cat;
    this.render();
  },

  resultRowHtml(r, key) {
    const esc = v => String(v == null ? '' : v).replace(/"/g, '&quot;');
    return `
      <div class="ed-result-row border rounded p-2" data-key="${key}">
        <div class="flex gap-2 items-center mb-1">
          <input class="ed-r-icon w-12" placeholder="图标" value="${esc(r.icon)}" />
          <input class="ed-r-head flex-1" placeholder="标题" value="${esc(r.head)}" />
          <button class="btn btn-danger btn-sm" onclick="app.modules.search.removeResultRow(this)">✕</button>
        </div>
        <input class="ed-r-body w-full" placeholder="内容" value="${esc(r.body)}" />
        <input class="ed-r-link w-full mt-1" placeholder="链接(可空)" value="${esc(r.link)}" />
      </div>`;
  },

  editEntry(id) {
    const item = (app.state.searchHistory || []).find(x => x.id === id);
    if (!item) return;
    const results = item.results || [];
    const rowsHtml = results.map((r, i) => this.resultRowHtml(r, i)).join('');
    const escTitle = String(item.title || '').replace(/"/g, '&quot;');
    app.openModal('✏️ 编辑检索归档', `
      <div class="form-grid">
        <div class="form-field">
          <label>分类</label>
          <select id="ed_cat">
            ${SEARCH_CATEGORIES.map(c => `<option ${ (item.category || '通用') === c ? 'selected' : '' }>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-field col-span-full">
          <label>标题</label>
          <input id="ed_title" value="${escTitle}" />
        </div>
        <div class="form-field col-span-full">
          <label>备注</label>
          <textarea id="ed_note">${item.note || ''}</textarea>
        </div>
      </div>
      <h4 class="text-sm font-semibold mt-3 mb-2">📋 结果行（可增删改，空行不保存）</h4>
      <div id="ed_results" class="space-y-2">${rowsHtml}</div>
      <button class="btn btn-ghost btn-sm mt-2" onclick="app.modules.search.addResultRow()">➕ 新增一行</button>
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.search.saveEntry('${id}')` }
    ]);
  },

  addResultRow() {
    const box = document.getElementById('ed_results');
    if (!box) return;
    const div = document.createElement('div');
    div.innerHTML = this.resultRowHtml({ icon: '', head: '', body: '', link: '' }, 'n' + Date.now());
    box.appendChild(div.firstElementChild);
  },

  removeResultRow(btn) {
    btn.closest('.ed-result-row')?.remove();
  },

  saveEntry(id) {
    const item = (app.state.searchHistory || []).find(x => x.id === id);
    if (!item) return;
    const cat = document.getElementById('ed_cat')?.value || '通用';
    const title = document.getElementById('ed_title')?.value.trim() || item.title;
    const note = document.getElementById('ed_note')?.value.trim() || '';
    const results = [];
    document.querySelectorAll('#ed_results .ed-result-row').forEach(row => {
      const icon = row.querySelector('.ed-r-icon')?.value.trim() || '';
      const head = row.querySelector('.ed-r-head')?.value.trim() || '';
      const body = row.querySelector('.ed-r-body')?.value.trim() || '';
      const link = row.querySelector('.ed-r-link')?.value.trim() || '';
      if (!head && !body) return; // 跳过空行
      results.push({ icon, head, body, link });
    });
    item.category = cat;
    item.title = title;
    item.note = note;
    item.results = results;
    app.saveState();
    app.closeModal();
    this.render();
    app.toast('✅ 已保存修改', 'success');
  }
};
