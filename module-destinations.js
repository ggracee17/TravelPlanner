/* ============================================================
   板块1：目的地总览档案库
   字段：城市/国家、起止日期、天数、人数、签证、最佳季节、预算、状态、备注
   ============================================================ */

app.modules.home = {
  render() {
    const sec = document.querySelector('[data-section=home]');
    if (!sec) return;
    const dests = app.state.destinations;
    const totalBudget = dests.reduce((s, d) => s + (parseFloat(d.budget) || 0), 0);
    const totalSpent = dests.reduce((s, d) => s + app.getExpensesTotal(d.id), 0);
    const completedCount = dests.filter(d => d.status === 'completed').length;
    const planningCount = dests.filter(d => d.status === 'planning').length;

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">🏠 私人旅行工作台 · 总览</div>
        <p class="text-sm text-slate-600 mb-4">欢迎使用！本工作台永久保存所有行程资料，6 大核心板块结构固定不可删减。
        <strong class="text-sky-700">左侧目录可随时切换板块</strong>，下方为您的旅行数据总览。</p>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div class="p-4 bg-sky-50 rounded-lg border border-sky-200">
            <div class="text-2xl font-bold text-sky-700">${dests.length}</div>
            <div class="text-xs text-slate-600 mt-1">目的地总数</div>
          </div>
          <div class="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
            <div class="text-2xl font-bold text-emerald-700">${planningCount}</div>
            <div class="text-xs text-slate-600 mt-1">规划中</div>
          </div>
          <div class="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
            <div class="text-2xl font-bold text-indigo-700">${completedCount}</div>
            <div class="text-xs text-slate-600 mt-1">已完成</div>
          </div>
          <div class="p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div class="text-2xl font-bold text-amber-700">¥${totalBudget.toFixed(0)}</div>
            <div class="text-xs text-slate-600 mt-1">总预算</div>
          </div>
        </div>

        ${dests.length > 0 ? `
          <h4 class="font-semibold text-slate-700 mb-2 text-sm">📋 行程一览</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            ${dests.map(d => {
              const spent = app.getExpensesTotal(d.id);
              const budget = parseFloat(d.budget) || 0;
              const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
              const pCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : '';
              return `
                <div class="dest-card ${d.id === app.state.activeDestinationId ? 'active' : ''}">
                  <div class="flex items-start justify-between mb-2">
                    <div>
                      <div class="text-lg font-bold text-slate-800">${d.city}, ${d.country}</div>
                      <div class="text-xs text-slate-500">${d.startDate || '?'} → ${d.endDate || '?'} · ${d.days || app.dateDiff(d.startDate, d.endDate)} 天</div>
                    </div>
                    <span class="${app.statusClass(d.status)}">${app.statusLabel(d.status)}</span>
                  </div>
                  <div class="text-xs text-slate-600 space-y-0.5">
                    <div>👥 ${d.travelers || 0} 人　🛂 ${d.visa || '未填写'}　🌸 ${d.bestSeason || '全年'}</div>
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
            <li>• <strong>板块3</strong> 行前核对清单：证件清单 + 行李清单（按气候动态调整）</li>
            <li>• <strong>板块4</strong> 旅行花销记账台账：实时联动总账，超支自动提醒</li>
            <li>• <strong>板块5</strong> 备选行程库：录入备选餐厅 / 景点 / 住宿，勾选加入每日行程，再到板块2拖拽排期</li>
            <li>• <strong>板块6</strong> 行程地图总览：在地图上标出每日行程地点，可下拉按日期筛选查看</li>
            <li>• 顶部「💾 备份/恢复」可导出 JSON 备份；「📥 一键导出全部 Excel」可生成多 sheet 工作簿</li>
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
          <span>📍 板块1 · 目的地总览档案库</span>
          <button class="btn btn-primary ml-auto" onclick="app.modules.destinations.newDest()">➕ 新建目的地档案</button>
          <button class="btn btn-success" onclick="app.modules.destinations.showImportJSON()">📥 粘贴 AI 建档</button>
        </div>
        <p class="text-sm text-slate-600 mb-4">每一座城市 = 一份独立档案。字段：城市/国家、起止日期、天数、人数、签证、最佳季节、总预算、状态、备注。</p>

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
                  <th>城市/国家</th>
                  <th>起止日期</th>
                  <th>天数</th>
                  <th>人数</th>
                  <th>签证</th>
                  <th>最佳季节</th>
                  <th>预算(¥)</th>
                  <th>已花(¥)</th>
                  <th>状态</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${dests.map(d => {
                  const spent = app.getExpensesTotal(d.id);
                  return `
                    <tr style="${d.id === app.state.activeDestinationId ? 'background:#f0f9ff' : ''}">
                      <td><strong>${d.city}</strong><br><span class="text-xs text-slate-500">${d.country}</span></td>
                      <td class="text-tiny">${d.startDate || '?'}<br>~ ${d.endDate || '?'}</td>
                      <td>${d.days || app.dateDiff(d.startDate, d.endDate)}</td>
                      <td>${d.travelers || 0}</td>
                      <td>${d.visa || '-'}</td>
                      <td>${d.bestSeason || '-'}</td>
                      <td>¥${(parseFloat(d.budget) || 0).toFixed(0)}</td>
                      <td>¥${spent.toFixed(0)}</td>
                      <td><span class="${app.statusClass(d.status)}">${app.statusLabel(d.status)}</span></td>
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
  "city":"台湾","country":"中国",
  "startDate":"2026-09-19","endDate":"2026-09-24",
  "days":6,"travelers":2,
  "visa":"大陆居民需持大通证+入台证","bestSeason":"9-11月最佳",
  "budget":0,"status":"planning","notes":""
}</pre>
      <div class="form-field col-span-full">
        <label>粘贴 JSON</label>
        <textarea id="importDestJSON" rows="9" class="font-mono" placeholder='{"city":"...","country":"..."}'></textarea>
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
    if (!data.city || !data.country) return app.toast('缺少 city / country 字段', 'warning');
    const dest = {
      id: app.uid(),
      city: data.city, country: data.country,
      startDate: data.startDate || '', endDate: data.endDate || '',
      days: data.days || app.dateDiff(data.startDate, data.endDate) || null,
      travelers: data.travelers || 0,
      visa: data.visa || '', bestSeason: data.bestSeason || '',
      budget: parseFloat(data.budget) || 0,
      status: data.status || 'pending',
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
    app.toast('✅ 已建档：' + dest.city + ', ' + dest.country + (dest.startDate ? '（已自动生成 ' + app.dateDiff(dest.startDate, dest.endDate) + ' 天日程）' : ''), 'success');
  },


  edit(id) {
    const d = app.state.destinations.find(x => x.id === id);
    if (!d) return;
    this.openForm(d);
  },

  openForm(existing = null) {
    const d = existing || {};
    const html = `
      <div class="form-grid">
        <div class="form-field">
          <label>城市 <span class="req">*</span></label>
          <input id="f_city" value="${d.city || ''}" placeholder="例如：东京" />
        </div>
        <div class="form-field">
          <label>国家 <span class="req">*</span></label>
          <input id="f_country" value="${d.country || ''}" placeholder="例如：日本" />
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
          <label>出行天数</label>
          <input type="number" id="f_days" value="${d.days || ''}" placeholder="留空将自动按起止日期计算" min="1" />
        </div>
        <div class="form-field">
          <label>同行人数</label>
          <input type="number" id="f_travelers" value="${d.travelers || ''}" min="1" />
        </div>
        <div class="form-field">
          <label>签证要求</label>
          <input id="f_visa" value="${d.visa || ''}" placeholder="如：免签 / 需签证 / 电子签" />
        </div>
        <div class="form-field">
          <label>最佳旅行季节</label>
          <input id="f_season" value="${d.bestSeason || ''}" placeholder="如：3-4月樱花季" />
        </div>
        <div class="form-field">
          <label>整体预估总预算 (¥)</label>
          <input type="number" id="f_budget" value="${d.budget || ''}" min="0" />
        </div>
        <div class="form-field">
          <label>行程状态</label>
          <select id="f_status">
            <option value="pending" ${d.status === 'pending' || !d.status ? 'selected' : ''}>待规划</option>
            <option value="planning" ${d.status === 'planning' ? 'selected' : ''}>规划中</option>
            <option value="completed" ${d.status === 'completed' ? 'selected' : ''}>已完成</option>
          </select>
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
    const city = document.getElementById('f_city').value.trim();
    const country = document.getElementById('f_country').value.trim();
    if (!city || !country) return app.toast('城市和国家为必填项', 'warning');

    const data = {
      city,
      country,
      startDate: document.getElementById('f_start').value,
      endDate: document.getElementById('f_end').value,
      days: parseInt(document.getElementById('f_days').value) || null,
      travelers: parseInt(document.getElementById('f_travelers').value) || 0,
      visa: document.getElementById('f_visa').value.trim(),
      bestSeason: document.getElementById('f_season').value.trim(),
      budget: parseFloat(document.getElementById('f_budget').value) || 0,
      status: document.getElementById('f_status').value,
      notes: document.getElementById('f_notes').value.trim()
    };
    if (!data.days) data.days = app.dateDiff(data.startDate, data.endDate);

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
