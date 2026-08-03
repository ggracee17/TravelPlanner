/* ============================================================
   板块1：目的地总览档案库
   字段：城市/国家、起止日期、天数、人数、签证、最佳季节、预算、状态、备注
   ============================================================ */

app.modules.home = {
  render() {
    const sec = document.querySelector('[data-section=home]');
    if (!sec) return;
    const dests = app.state.destinations;
    const totalBudget = dests.reduce((s, d) => s + app.getBudgetTotal(d.id), 0);
    const totalSpent = dests.reduce((s, d) => s + app.getExpensesTotal(d.id), 0);
    const totalDays = dests.reduce((s, d) => s + app.dateDiff(d.startDate, d.endDate), 0);

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">${app.t('dest.homeTitle')}</div>
        <p class="text-sm text-slate-600 mb-4">欢迎使用本旅行规划工作台！
        <strong class="text-sky-700">上方目录可随时切换板块</strong>，下方为您的旅行数据总览。</p>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div class="p-4 bg-sky-50 rounded-lg border border-sky-200">
            <div class="text-2xl font-bold text-sky-700">${dests.length}</div>
            <div class="text-xs text-slate-600 mt-1">目的地总数</div>
          </div>
          <div class="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
            <div class="text-2xl font-bold text-emerald-700">¥${totalSpent.toFixed(0)}</div>
            <div class="text-xs text-slate-600 mt-1">总已花</div>
          </div>
          <div class="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
            <div class="text-2xl font-bold text-indigo-700">¥${totalBudget.toFixed(0)}</div>
            <div class="text-xs text-slate-600 mt-1">总预算</div>
          </div>
          <div class="p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div class="text-2xl font-bold text-amber-700">${totalDays}</div>
            <div class="text-xs text-slate-600 mt-1">行程总天数</div>
          </div>
        </div>

        ${dests.length > 0 ? `
          <h4 class="font-semibold text-slate-700 mb-2 text-sm">📋 行程一览</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            ${dests.map(d => {
              const spent = app.getExpensesTotal(d.id);
              const budget = app.getBudgetTotal(d.id);
              const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
              const pCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : '';
              return `
                <div class="dest-card ${d.id === app.state.activeDestinationId ? 'active' : ''}">
                  <div class="mb-2">
                    <div class="text-lg font-bold text-slate-800">${app.destName(d)}</div>
                    <div class="text-xs text-slate-500">${d.startDate || '?'} → ${d.endDate || '?'} · ${app.dateDiff(d.startDate, d.endDate)} 天</div>
                  </div>
                  <div class="text-xs text-slate-600 space-y-0.5">
                    <div>👥 ${d.travelers || 0} 人</div>
                    <div>💰 预算 ¥${budget.toFixed(0)} · 已花 ¥${spent.toFixed(0)}（${pct.toFixed(0)}%）</div>
                  </div>
                  <div class="budget-bar mt-1"><div class="budget-bar-fill ${pCls}" style="width:${pct}%"></div></div>
                  <div class="flex gap-1 mt-3">
                    <button class="btn btn-ghost btn-sm" onclick="app.switchDestination('${d.id}');app.modules.destinations.edit('${d.id}')">✏️ 编辑</button>
                    <button class="btn btn-primary btn-sm" onclick="app.switchDestination('${d.id}');document.querySelector('[data-tab=itinerary]').click()">🗓️ 行程</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>暂无目的地档案</h3>
            <p class="text-sm">请前往「板块1 · 目的地档案库」创建您的第一个目的地</p>
          </div>
        `}

        <div class="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h4 class="font-semibold text-sm text-slate-700 mb-2">📌 工作台使用说明</h4>
          <ul class="text-xs text-slate-600 space-y-1 leading-relaxed">
            <li>• <strong>板块1</strong> 目的地总览档案库：每新增一座城市独立建档</li>
            <li>• <strong>板块2</strong> 每日精细化行程表：含天气、景点、交通、住宿等全字段</li>
            <li>• <strong>板块3</strong> 行前核对清单：证件清单 + 行李清单</li>
            <li>• <strong>板块4</strong> 旅行花销记账台账：实时联动总账，超支自动提醒</li>
            <li>• <strong>板块5</strong> 行程库：录入备选行程（餐厅 / 景点 / 住宿），勾选加入每日行程；未加入的排最前、已加入的按日期排序</li>
            <li>• <strong>板块6</strong> 行程地图总览：在地图上标出每日行程地点，可按日期筛选查看</li>
            <li>• 顶部「💾 备份/恢复」可导出 JSON 备份</li>
          </ul>
        </div>
      </div>
    `;
  }
};

app.modules.destinations = {
  render() {
    const sec = document.querySelector('[data-section=destinations]');
    if (!sec) return;
    const dests = app.state.destinations;

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>${app.t('dest.title')}</span>
          <button class="btn btn-primary ml-auto" onclick="app.modules.destinations.newDest()">${app.t('dest.newBtn')}</button>
          <!-- 「📥 粘贴 AI 建档」按钮已按需求移除；showImportJSON() 仍保留，需要时可重新挂回 -->
        </div>
        <p class="text-sm text-slate-600 mb-4">每一个目的地 = 一份独立档案。字段精简为：目的地名称、起止日期（出行天数自动按日期计算）、同行人数、总预算、备注。</p>

        ${dests.length === 0 ? `
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>还没有目的地档案</h3>
            <p class="text-sm">点击右上角「➕ 新建目的地档案」开始建立第一份专属档案</p>
          </div>
        ` : `
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>目的地名称</th>
                  <th>起止日期</th>
                  <th>天数</th>
                  <th>人数</th>
                  <th>预算(¥)</th>
                  <th>已花(¥)</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${dests.map(d => {
                  const spent = app.getExpensesTotal(d.id);
                  return `
                    <tr style="${d.id === app.state.activeDestinationId ? 'background:#f0f9ff' : ''}">
                      <td><strong>${app.destName(d)}</strong></td>
                      <td class="text-tiny">${d.startDate || '?'}<br>~ ${d.endDate || '?'}</td>
                      <td>${app.dateDiff(d.startDate, d.endDate)}</td>
                      <td>${d.travelers || 0}</td>
                      <td>¥${app.getBudgetTotal(d.id).toFixed(0)}</td>
                      <td>¥${spent.toFixed(0)}</td>
                      <td class="text-tiny max-w-[200px]">${d.notes || '-'}</td>
                      <td class="text-tiny">
                        <button class="btn btn-ghost btn-sm" onclick="app.modules.destinations.edit('${d.id}')">✏️</button>
                        <button class="btn btn-primary btn-sm" onclick="app.switchDestination('${d.id}')">🎯</button>
                        <button class="btn btn-danger btn-sm" onclick="app.modules.destinations.remove('${d.id}')">🗑️</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  },

  newDest() { this.openForm(); },

  /* ===== AI 对话建档：粘贴 JSON 一键建档（自动生成日程骨架） ===== */
  showImportJSON() {
    app.openModal('📥 粘贴 AI 建档数据', `
      <p class="text-sm text-slate-600 mb-2">把 AI 在对话里给您的「建档数据」粘贴到下方，点「建档」即可，无需写代码。</p>
      <pre class="text-tiny bg-slate-100 p-2 rounded mb-2 overflow-x-auto" style="white-space:pre-wrap">{
  "name":"台湾","startDate":"2026-09-19","endDate":"2026-09-24",
  "travelers":2,"budget":0,"notes":""
}</pre>
      <div class="form-field col-span-full">
        <label>粘贴 JSON</label>
        <textarea id="importDestJSON" rows="9" class="font-mono" placeholder='{"name":"...","startDate":"...","endDate":"..."}'></textarea>
      </div>
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '建档', class: 'btn btn-primary', action: 'app.modules.destinations.doImportJSON()' }
    ]);
  },

  doImportJSON() {
    const raw = document.getElementById('importDestJSON').value.trim();
    if (!raw) return app.toast('请粘贴 JSON', 'warning');
    let data;
    try { data = JSON.parse(raw); } catch (e) { return app.toast('JSON 解析失败：' + e.message, 'error'); }
    if (!data.name) return app.toast('缺少 name 字段', 'warning');
    const dest = {
      id: app.uid(),
      name: data.name,
      startDate: data.startDate || '', endDate: data.endDate || '',
      travelers: data.travelers || 0,
      budget: parseFloat(data.budget) || 0,
      notes: data.notes || ''
    };
    app.state.destinations.push(dest);
    app.state.activeDestinationId = dest.id;

    // 自动生成空白日程骨架（按起止日期）
    if (dest.startDate && dest.endDate) {
      const s = new Date(dest.startDate + 'T00:00:00');
      const n = app.dateDiff(dest.startDate, dest.endDate);
      const it = [];
      for (let i = 0; i < n; i++) {
        const dt = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
        const ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        it.push({ id: 'it_' + Date.now() + '_' + i, date: ds, weather: '', morning: '', noon: '', evening: '', spots: [], hotel: { name: '', address: '', checkIn: '', checkOut: '', cost: 0 }, dining: '', mapLink: '', notes: '' });
      }
      app.state[dest.id] = { itinerary: it, expenses: [], media: [] };
    } else {
      app.state[dest.id] = { itinerary: [], expenses: [], media: [] };
    }

    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('✅ 已建档：' + dest.name + (dest.startDate ? '（已自动生成 ' + app.dateDiff(dest.startDate, dest.endDate) + ' 天日程）' : ''), 'success');
  },


  edit(id) {
    const d = app.state.destinations.find(x => x.id === id);
    if (!d) return;
    this.openForm(d);
  },

  openForm(existing = null) {
    const d = existing || {};
    const nameVal = d.name || [d.city, d.country].filter(Boolean).join(', ') || '';
    const html = `
      <div class="form-grid">
        <div class="form-field col-span-full">
          <label>目的地名称 <span class="req">*</span></label>
          <input id="f_name" value="${nameVal}" placeholder="例如：日本·东京 / 台湾" />
        </div>
        <div class="form-field">
          <label>计划出发日期</label>
          <input type="date" id="f_start" value="${d.startDate || ''}" />
        </div>
        <div class="form-field">
          <label>计划返回日期</label>
          <input type="date" id="f_end" value="${d.endDate || ''}" />
        </div>
        <div class="form-field">
          <label>同行人数</label>
          <input type="number" id="f_travelers" value="${d.travelers || ''}" min="1" />
        </div>
        <div class="form-field">
          <label>整体预估总预算 (¥)</label>
          <input type="number" id="f_budget" value="${d.budget || ''}" min="0" />
        </div>
        <div class="form-field col-span-full">
          <label>备注</label>
          <textarea id="f_notes" placeholder="如：庆祝蜜月、亲子游、避开雨季…">${d.notes || ''}</textarea>
        </div>
      </div>
    `;
    app.openModal(existing ? '✏️ 编辑目的地档案' : '➕ 新建目的地档案', html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.destinations.save('${d.id || ''}')` }
    ]);
  },

  save(id) {
    const name = document.getElementById('f_name').value.trim();
    if (!name) return app.toast('目的地名称为必填项', 'warning');

    const data = {
      name,
      startDate: document.getElementById('f_start').value,
      endDate: document.getElementById('f_end').value,
      travelers: parseInt(document.getElementById('f_travelers').value) || 0,
      budget: parseFloat(document.getElementById('f_budget').value) || 0,
      notes: document.getElementById('f_notes').value.trim()
    };

    if (id) {
      const idx = app.state.destinations.findIndex(x => x.id === id);
      if (idx >= 0) app.state.destinations[idx] = { ...app.state.destinations[idx], ...data };
    } else {
      const newId = app.uid();
      app.state.destinations.push({ id: newId, ...data, createdAt: new Date().toISOString() });
      app.state[newId] = { itinerary: [], expenses: [], media: [] }; // 初始化该目的地的子数据桶
      app.state.activeDestinationId = newId;
    }
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('保存成功', 'success');
  },

  remove(id) {
    if (!confirm('确定删除该目的地档案？此操作将一并删除其下所有行程、花销、素材数据！')) return;
    app.state.destinations = app.state.destinations.filter(x => x.id !== id);
    delete app.state[id];
    if (app.state.activeDestinationId === id) {
      app.state.activeDestinationId = app.state.destinations[0]?.id || null;
    }
    app.saveState();
    app.renderAll();
    app.toast('已删除', 'warning');
  }
};
