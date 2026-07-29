/* ============================================================
   板块5（精简后）· 备选行程库
   录入备选行程（餐厅 / 景点 / 住宿…），含 地址、营业时间、
   Google Map 链接、图片；勾选后即时加入当前目的地的「每日行程表」
   第一天，再到板块2 拖拽排序 / 跨日移动，完成精细规划。
   ============================================================ */

app.modules.candidates = {

  /* ===== 渲染 ===== */
  render() {
    const sec = document.querySelector('[data-section=candidates]');
    if (!sec) return;

    const cands = app.state.candidates || (app.state.candidates = []);
    const d = app.getActiveDestination();

    // 统计每个备选当前落入的日期（用于勾选态提示）
    const placedMap = {};
    if (d) {
      const days = (app.state[d.id]?.itinerary || [])
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      days.forEach((day, i) => {
        (day.spots || []).forEach(s => { if (s.sourceId) placedMap[s.sourceId] = `Day ${i + 1}（${day.date || '?'})`; });
      });
    }

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🧩 板块5 · 备选行程库</span>
          <button class="btn btn-primary ml-auto" onclick="app.modules.candidates.openForm('')">➕ 新增备选行程</button>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          把还在犹豫的餐厅、景点、住宿等先记在这里，并填好<strong class="text-sky-700">建议时长</strong>。
          <strong class="text-sky-700">勾选「加入行程」</strong>即进入板块2「每日行程表」时间轴（接在当天最后一段之后），
          之后可在时间轴上<strong class="text-sky-700">拖动块</strong>改时间、或拖到别的日期。
        </p>

        ${cands.length === 0 ? `
          <div class="empty-state">
            <div class="icon">🧩</div>
            <h3>备选行程库还是空的</h3>
            <p class="text-sm">点击右上角「➕ 新增备选行程」，例如录入 3 家备选餐厅（含地址 / 营业时间 / Google Map 链接 / 图片），勾选心仪的那家即可进入每日行程。</p>
          </div>
        ` : `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${cands.map(c => this.renderCard(c, placedMap[c.id])).join('')}
          </div>
        `}
      </div>
    `;
  },

  renderCard(c, placed) {
    const typeBadge = {
      '餐厅': 'badge badge-restaurant', '景点': 'badge badge-spot', '住宿': 'badge badge-hotel',
      '交通': 'badge badge-transport', '购物': 'badge badge-shop', '其他': 'badge badge-other'
    }[c.type] || 'badge badge-other';

    return `
      <div class="candidate-card ${c.checked ? 'is-checked' : ''}">
        <div class="flex items-start gap-3">
          <label class="cand-check" title="勾选后加入每日行程">
            <input type="checkbox" ${c.checked ? 'checked' : ''} onchange="app.modules.candidates.toggleCandidate('${c.id}')" />
          </label>
          ${c.image ? `<img src="${c.image}" class="cand-thumb" alt="${c.name}" onerror="this.style.display='none'" />` : `<div class="cand-thumb cand-thumb-empty">🧩</div>`}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <strong class="text-slate-800 truncate">${c.name}</strong>
              <span class="${typeBadge}">${c.type || '其他'}</span>
              ${c.durationH ? `<span class="badge badge-other">${c.durationH}h</span>` : ''}
            </div>
            <div class="text-tiny text-slate-500 mt-0.5 space-y-0.5">
              ${c.address ? `<div>📍 ${c.address}</div>` : ''}
              ${c.hours ? `<div>🕒 ${c.hours}</div>` : ''}
              ${c.mapUrl ? `<div><a href="${c.mapUrl}" target="_blank" class="text-sky-600 hover:underline break-all">🔗 Google Map</a></div>` : ''}
              ${c.note ? `<div class="text-slate-400">📝 ${c.note}</div>` : ''}
            </div>
            <div class="flex items-center gap-3 mt-2">
              ${c.checked
                ? `<span class="text-tiny text-emerald-600 font-semibold">✅ 已加入 · ${placed || '板块2'}</span>`
                : `<span class="text-tiny text-slate-400">未加入行程</span>`}
              <span class="flex-1"></span>
              <button class="btn btn-ghost btn-sm" onclick="app.modules.candidates.openForm('${c.id}')">✏️ 编辑</button>
              <button class="btn btn-danger btn-sm" onclick="app.modules.candidates.deleteCandidate('${c.id}')">🗑️ 删除</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /* ===== 新增 / 编辑 表单 ===== */
  openForm(id) {
    const cands = app.state.candidates || (app.state.candidates = []);
    const c = id ? cands.find(x => x.id === id) : null;
    const isEdit = !!c;
    const v = c || { name: '', type: '餐厅', address: '', hours: '', mapUrl: '', image: '', note: '' };
    const types = ['餐厅', '景点', '住宿', '交通', '购物', '其他'];

    app.openModal(isEdit ? '✏️ 编辑备选行程' : '➕ 新增备选行程', `
      <div class="form-grid cols-2">
        <div class="form-field">
          <label>名称 <span class="req">*</span></label>
          <input id="c_name" value="${v.name || ''}" placeholder="如：台北101" />
        </div>
        <div class="form-field">
          <label>类型</label>
          <select id="c_type">
            ${types.map(t => `<option ${t === (v.type || '餐厅') ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>建议时长(小时)</label><input type="number" id="c_dur" min="0.5" step="0.5" value="${v.durationH || 2}" placeholder="如 2" /></div>
        <div class="form-field"><label>营业时间</label><input id="c_hours" value="${v.hours || ''}" placeholder="09:00-22:00" /></div>
        <div class="form-field col-span-full"><label>地址</label><input id="c_addr" value="${v.address || ''}" placeholder="如：信义区…" /></div>
        <div class="form-field col-span-full"><label>Google Map 链接</label><input id="c_map" value="${v.mapUrl || ''}" placeholder="https://maps.app.goo.gl/..." /></div>
        <div class="form-field col-span-full"><label>图片链接 (URL)</label><input id="c_img" value="${v.image || ''}" placeholder="https://.../photo.jpg" /></div>
        <div class="form-field col-span-full"><label>备注</label><textarea id="c_note" rows="2" placeholder="推荐菜 / 人均 / 预约方式…">${v.note || ''}</textarea></div>
      </div>
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: isEdit ? '保存修改' : '添加到备选库', class: 'btn btn-primary', action: `app.modules.candidates.saveForm('${id || ''}')` }
    ]);
  },

  saveForm(id) {
    const name = (document.getElementById('c_name').value || '').trim();
    if (!name) return app.toast('请填写名称', 'warning');
    const cands = app.state.candidates || (app.state.candidates = []);
    const data = {
      name,
      type: document.getElementById('c_type').value,
      durationH: Math.max(0.5, parseFloat(document.getElementById('c_dur').value) || 2),
      address: (document.getElementById('c_addr').value || '').trim(),
      hours: (document.getElementById('c_hours').value || '').trim(),
      mapUrl: (document.getElementById('c_map').value || '').trim(),
      image: (document.getElementById('c_img').value || '').trim(),
      note: (document.getElementById('c_note').value || '').trim()
    };
    if (id) {
      const c = cands.find(x => x.id === id);
      if (c) Object.assign(c, data);
    } else {
      cands.push(Object.assign({ id: 'cand_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), checked: false }, data));
    }
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('已保存', 'success');
  },

  /* ===== 勾选 → 加入 / 移除 每日行程 ===== */
  toggleCandidate(id) {
    const cands = app.state.candidates || (app.state.candidates = []);
    const c = cands.find(x => x.id === id);
    if (!c) return;
    const want = !c.checked;
    let ok = true;
    if (want) ok = this.addToItinerary(c);
    else this.removeFromItinerary(c.id);
    c.checked = want && ok; // 加入失败则保持未勾选
    app.saveState();
    app.renderAll();
    if (c.checked) app.toast('已加入每日行程（板块2·第一天），去拖拽调整吧', 'success');
    else if (want) app.toast('加入失败：请先在板块2生成每日日程', 'warning');
    else app.toast('已从每日行程移除', 'success');
  },

  addToItinerary(c) {
    const d = app.getActiveDestination();
    if (!d) { app.toast('请先在板块1选择目的地', 'warning'); return false; }
    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].itinerary) app.state[d.id].itinerary = [];
    const firstDay = app.state[d.id].itinerary
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
    if (!firstDay) {
      app.toast('请先在「板块2·每日行程表」生成每日日程，再来勾选备选', 'warning');
      return false;
    }
    if (!firstDay.spots) firstDay.spots = [];
    const TYPE_KEY = { '餐厅': 'restaurant', '景点': 'spot', '住宿': 'hotel', '交通': 'transport', '购物': 'shopping', '其他': 'other' };
    const durH = c.durationH || 2;
    const start = app.modules.itinerary.defaultStart(firstDay, durH);
    firstDay.spots.push({
      id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: TYPE_KEY[c.type] || 'other',
      name: c.name,
      startTime: start,
      durationH: durH,
      address: c.address || '',
      hours: c.hours || '',
      ticket: 0, reservation: '', transport: '', transportCost: 0,
      mapUrl: c.mapUrl || '',
      image: c.image || '',
      note: c.note || '',
      sourceId: c.id
    });
    return true;
  },

  removeFromItinerary(sourceId) {
    const d = app.getActiveDestination();
    if (!d) return;
    const list = app.state[d.id]?.itinerary || [];
    list.forEach(day => { if (day.spots) day.spots = day.spots.filter(s => s.sourceId !== sourceId); });
  },

  deleteCandidate(id) {
    if (!confirm('确定删除这条备选行程？')) return;
    const cands = app.state.candidates || (app.state.candidates = []);
    const c = cands.find(x => x.id === id);
    if (c && c.checked) this.removeFromItinerary(id);
    app.state.candidates = cands.filter(x => x.id !== id);
    app.saveState();
    app.renderAll();
    app.toast('已删除', 'success');
  }
};
