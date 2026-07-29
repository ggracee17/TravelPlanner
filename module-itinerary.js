/* ============================================================
   板块2：每日行程表（时间轴 · 可拖拽版本）
   每天 = 一条时间轴（06:00–24:00），行程以"块"形式落在时间上。
   每个块按分类着色：餐厅(红) / 酒店(紫) / 景点(蓝) / 交通(青) / 购物(橙) / 其他(灰)。
   块上显示 名称 + 时间段；拖动块可改时间或跨日移动；点块编辑详情
   （门票 / 是否需预约 / 建议时长 / 地址 / 营业时间 / 地图 / 图片 / 备注）。
   ============================================================ */

/* ===== 时间轴常量 & 工具（全局，供内联 ondrop 等调用） ===== */
const ITIN_TL_START = 6;     // 时间轴起点 06:00
const ITIN_TL_END = 24;      // 时间轴终点 24:00
const ITIN_HOUR_PX = 44;     // 每小时像素高度

const ITIN_TYPES = {
  restaurant: { label: '餐厅', cls: 'blk-restaurant' },
  hotel:      { label: '酒店', cls: 'blk-hotel' },
  spot:       { label: '景点', cls: 'blk-spot' },
  transport:  { label: '交通', cls: 'blk-transport' },
  shopping:   { label: '购物', cls: 'blk-shopping' },
  other:      { label: '其他', cls: 'blk-other' }
};

function itinTimeToNum(t) {
  if (!t || !/^\d{1,2}(:\d{2})?$/.test(t)) return ITIN_TL_START;
  const [h, m] = t.split(':');
  return parseInt(h, 10) + (parseInt(m || '0', 10) / 60);
}
function itinNumToTime(n) {
  n = Math.max(0, Math.min(24, n));
  let h = Math.floor(n);
  let m = Math.round((n - h) * 60);
  if (m === 60) { h++; m = 0; }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function itinEndTime(start, dur) {
  return itinNumToTime(itinTimeToNum(start) + (parseFloat(dur) || 1));
}
function itinSnap(n) { return Math.round(n * 2) / 2; } // 半小时吸附

app.modules.itinerary = {

  render() {
    const sec = document.querySelector('[data-section=itinerary]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">🗓️ 板块2 · 每日行程表（时间轴）</div>
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>请先选择或创建目的地</h3>
            <p class="text-sm">前往「板块1」建立目的地档案后，再回到这里编辑每日行程</p>
          </div>
        </div>`;
      return;
    }

    const bucket = app.state[d.id] || {};
    const days = (bucket.itinerary || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🗓️ 板块2 · 每日行程表（时间轴）</span>
          <div class="ml-auto flex gap-2">
            <button class="btn btn-warning" onclick="app.modules.itinerary.autoGenDays()">⚡ 按日期自动生成空白日程</button>
            <button class="btn btn-primary" onclick="app.modules.itinerary.addDay()">➕ 手动新增一日</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          当前目的地：<strong class="text-sky-700">${d.city}, ${d.country}</strong>　·　共 <strong>${d.days || 0}</strong> 天　·　已规划 <strong>${days.length}</strong> 天。
          下方为<strong>时间轴</strong>：每个行程块按分类着色（餐厅红 / 酒店紫 / 景点蓝 / 交通青 / 购物橙 / 其他灰），<strong>拖动块</strong>即可改时间或换到别的日期。
        </p>

        ${days.length === 0 ? `
          <div class="empty-state">
            <div class="icon">📅</div>
            <h3>该目的地还没有每日行程</h3>
            <p class="text-sm">点击右上角「⚡ 按日期自动生成空白日程」一键按起止日期生成全部空日程，再拖入行程块</p>
          </div>
        ` : `
          ${days.map((day, idx) => this.renderDayCard(day, idx, d)).join('')}
        `}
      </div>`;
  },

  renderDayCard(day, idx, dest) {
    this.normalizeDay(day);
    const spots = day.spots || [];
    const totalTicket = spots.reduce((s, x) => s + (parseFloat(x.ticket) || 0), 0);
    const hours = [];
    for (let h = ITIN_TL_START; h < ITIN_TL_END; h++) hours.push(h);
    const tlHeight = (ITIN_TL_END - ITIN_TL_START) * ITIN_HOUR_PX;

    return `
      <div class="day-card">
        <div class="day-card-header">
          <div>
            <div class="text-lg font-bold">Day ${idx + 1} · ${day.date || '未填日期'}</div>
            <div class="text-xs opacity-90">${day.weather || '天气未填'}　·　行程块 ${spots.length} 个　·　门票 ¥${totalTicket.toFixed(0)}</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary btn-sm" onclick="app.modules.itinerary.openBlockForm('${day.id}','')">➕ 添加行程块</button>
            <button class="btn btn-ghost btn-sm" onclick="app.modules.itinerary.editDay('${day.id}')">✏️ 日期/天气</button>
            <button class="btn btn-danger btn-sm" onclick="app.modules.itinerary.removeDay('${day.id}')">🗑️ 删除</button>
          </div>
        </div>
        <div class="day-card-body">
          ${day.hotel?.name || day.dining ? `
            <div class="day-legacy mb-2">
              ${day.hotel?.name ? `🏨 <strong>${day.hotel.name}</strong>` : ''}
              ${day.dining ? `<span class="ml-2">🍽️ ${day.dining}</span>` : ''}
            </div>` : ''}
          <div class="timeline" data-day-id="${day.id}" style="height:${tlHeight}px"
               ondragover="app.modules.itinerary.onDragOver(event)"
               ondrop="app.modules.itinerary.onDrop(event)"
               ondragleave="app.modules.itinerary.onDragLeave(event)">
            ${hours.map(h => `<div class="tl-hour"><span class="tl-label">${h}:00</span></div>`).join('')}
            ${spots.map(s => this.renderBlock(s, day)).join('')}
          </div>
          ${spots.length === 0 ? '<p class="text-xs text-slate-400 mt-2 text-center">勾选「板块5·备选行程库」加入，或点「➕ 添加行程块」，再拖到合适的时间</p>' : ''}
        </div>
      </div>`;
  },

  /* ===== 单个行程块 ===== */
  renderBlock(s, day) {
    const meta = ITIN_TYPES[s.type] || ITIN_TYPES.other;
    const maxTop = (ITIN_TL_END - ITIN_TL_START) * ITIN_HOUR_PX - ITIN_HOUR_PX;
    let top = (itinTimeToNum(s.startTime) - ITIN_TL_START) * ITIN_HOUR_PX;
    top = Math.max(0, Math.min(top, maxTop));
    let h = Math.max(parseFloat(s.durationH) || 1, 0.5) * ITIN_HOUR_PX;
    h = Math.min(h, (ITIN_TL_END - ITIN_TL_START) * ITIN_HOUR_PX - top);
    const dur = parseFloat(s.durationH) || 1;
    return `
      <div class="tl-block ${meta.cls}" draggable="true"
           style="top:${top}px;height:${Math.max(h, 26)}px"
           data-day-id="${day.id}" data-spot-id="${s.id}"
           ondragstart="app.modules.itinerary.onDragStart(event)"
           ondragend="app.modules.itinerary.onDragEnd(event)"
           onclick="app.modules.itinerary.openBlockForm('${day.id}','${s.id}')"
           title="点击编辑 · 拖动改时间">
        <div class="tl-block-bar"></div>
        <div class="tl-block-main">
          <div class="tl-block-title">${s.name || '未命名'}</div>
          <div class="tl-block-time">${s.startTime || '--:--'}–${itinEndTime(s.startTime, dur)} · ${dur}h</div>
          ${s.reservation === 'needed' ? '<span class="tl-flag">需预约</span>' : ''}
          ${s.ticket > 0 ? `<span class="tl-flag tl-flag-ticket">¥${s.ticket}</span>` : ''}
        </div>
      </div>`;
  },

  /* ===== 拖拽：改时间 / 跨日 ===== */
  _drag: null,

  onDragStart(e) {
    const el = e.target.closest && e.target.closest('[data-spot-id]');
    if (!el) return;
    this._drag = { spotId: el.dataset.spotId, fromDayId: el.dataset.dayId };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', this._drag.spotId); } catch (_) {}
  },

  onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tl = e.currentTarget;
    const rect = tl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const hour = itinSnap(ITIN_TL_START + y / ITIN_HOUR_PX);
    let line = tl.querySelector('.tl-drop-line');
    if (!line) { line = document.createElement('div'); line.className = 'tl-drop-line'; tl.appendChild(line); }
    line.style.top = ((hour - ITIN_TL_START) * ITIN_HOUR_PX) + 'px';
    line.style.display = 'block';
  },

  onDragLeave(e) {
    const tl = e.currentTarget;
    const line = tl.querySelector('.tl-drop-line');
    if (line) line.style.display = 'none';
  },

  onDrop(e) {
    e.preventDefault();
    const tl = e.currentTarget;
    const line = tl.querySelector('.tl-drop-line');
    if (line) line.style.display = 'none';
    const from = this._drag;
    if (!from) return;
    const rect = tl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let hour = itinSnap(ITIN_TL_START + y / ITIN_HOUR_PX);
    hour = Math.max(ITIN_TL_START, Math.min(ITIN_TL_END - 0.5, hour));
    this.moveSpotToTime(from.spotId, tl.dataset.dayId, itinNumToTime(hour));
    this._drag = null;
  },

  onDragEnd(e) {
    const el = e.target.closest && e.target.closest('[data-spot-id]');
    if (el) el.classList.remove('dragging');
    this._drag = null;
    document.querySelectorAll('.tl-drop-line').forEach(l => l.style.display = 'none');
  },

  moveSpotToTime(spotId, toDayId, newStart) {
    const d = app.getActiveDestination();
    if (!d) return;
    const all = app.state[d.id]?.itinerary || [];
    let found = null, fromDay = null;
    for (const day of all) {
      const i = (day.spots || []).findIndex(s => s.id === spotId);
      if (i >= 0) { found = day.spots[i]; fromDay = day; break; }
    }
    if (!found) return;
    if (!fromDay.spots) fromDay.spots = [];
    fromDay.spots = fromDay.spots.filter(s => s.id !== spotId);
    const toDay = all.find(x => x.id === toDayId);
    if (!toDay) return;
    if (!toDay.spots) toDay.spots = [];
    found.startTime = newStart;
    toDay.spots.push(found);
    toDay.spots.sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
    app.saveState();
    app.renderAll();
    app.toast('已调整行程时间', 'success');
  },

  // 计算新行程块放入某天后的默认开始时间（接在最后一块之后）
  defaultStart(day, durH) {
    const ends = (day.spots || []).map(s => itinTimeToNum(s.startTime) + (parseFloat(s.durationH) || 1));
    let start = ends.length ? Math.max.apply(null, ends) : 9;
    start = itinSnap(start);
    const minS = ITIN_TL_START;
    const maxS = ITIN_TL_END - (parseFloat(durH) || 1);
    if (start < minS) start = minS;
    if (start > maxS) start = minS; // 溢出则回到早晨
    return itinNumToTime(start);
  },

  /* ===== 数据规整（兼容旧数据 + 旧酒店对象转块） ===== */
  normalizeDay(day) {
    if (!day.spots) day.spots = [];
    day.spots.forEach(s => {
      if (!s.id) s.id = 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      if (!s.type) s.type = 'spot';
      if (s.startTime == null || s.startTime === '') s.startTime = '09:00';
      if (s.durationH == null) {
        const m = (s.duration || '').match(/(\d+(\.\d+)?)/);
        s.durationH = m ? parseFloat(m[1]) : 1;
      }
      if (s.ticket == null) s.ticket = 0;
      if (s.reservation == null) s.reservation = '';
    });
    day.spots.sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
  },

  /* ===== 添加 / 编辑 行程块 ===== */
  openBlockForm(dayId, spotId) {
    const d = app.getActiveDestination();
    if (!d) return;
    const day = (app.state[d.id].itinerary || []).find(x => x.id === dayId);
    if (!day) return;
    const isNew = !spotId;
    const s = isNew
      ? { name: '', type: 'spot', startTime: this.defaultStart(day, 2), durationH: 2, ticket: 0, reservation: '', address: '', hours: '', mapUrl: '', image: '', note: '' }
      : (day.spots || []).find(x => x.id === spotId);
    if (!s) return;
    const typeOpts = Object.entries(ITIN_TYPES)
      .map(([k, v]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${v.label}</option>`).join('');

    app.openModal(isNew ? '➕ 添加行程块' : '✏️ 编辑行程块', `
      <div class="form-grid cols-3">
        <div class="form-field col-span-full"><label>名称 <span class="req">*</span></label><input id="b_name" value="${s.name || ''}" placeholder="如：台北101" /></div>
        <div class="form-field"><label>分类</label><select id="b_type">${typeOpts}</select></div>
        <div class="form-field"><label>开始时间</label><input type="time" id="b_start" value="${s.startTime || '09:00'}" /></div>
        <div class="form-field"><label>建议时长(小时)</label><input type="number" id="b_dur" min="0.5" step="0.5" value="${s.durationH || 1}" /></div>
        <div class="form-field"><label>门票(¥)</label><input type="number" id="b_ticket" min="0" value="${s.ticket || 0}" /></div>
        <div class="form-field"><label>是否需预约</label>
          <select id="b_resv">
            <option value="" ${!s.reservation ? 'selected' : ''}>未知</option>
            <option value="needed" ${s.reservation === 'needed' ? 'selected' : ''}>需预约</option>
            <option value="none" ${s.reservation === 'none' ? 'selected' : ''}>无需预约</option>
          </select>
        </div>
        <div class="form-field col-span-full"><label>地址</label><input id="b_addr" value="${s.address || ''}" /></div>
        <div class="form-field"><label>营业时间</label><input id="b_hours" value="${s.hours || ''}" placeholder="09:00-22:00" /></div>
        <div class="form-field"><label>🔗 Google Map 链接</label><input id="b_map" value="${s.mapUrl || ''}" placeholder="https://maps.app.goo.gl/..." /></div>
        <div class="form-field col-span-full"><label>🖼️ 图片链接 (URL)</label><input id="b_img" value="${s.image || ''}" placeholder="https://.../photo.jpg" /></div>
        <div class="form-field col-span-full"><label>📝 备注</label><textarea id="b_note" rows="2">${s.note || ''}</textarea></div>
      </div>
    `, [
      ...(isNew ? [] : [{ text: '删除', class: 'btn btn-danger', action: `app.modules.itinerary.deleteBlock('${dayId}','${spotId}')` }]),
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: isNew ? '添加' : '保存', class: 'btn btn-primary', action: `app.modules.itinerary.saveBlock('${dayId}','${spotId}')` }
    ]);
  },

  saveBlock(dayId, spotId) {
    const d = app.getActiveDestination();
    if (!d) return;
    const day = (app.state[d.id].itinerary || []).find(x => x.id === dayId);
    if (!day) return;
    if (!day.spots) day.spots = [];
    const name = (document.getElementById('b_name').value || '').trim();
    if (!name) return app.toast('请填写名称', 'warning');
    const data = {
      name,
      type: document.getElementById('b_type').value,
      startTime: document.getElementById('b_start').value || '09:00',
      durationH: Math.max(0.5, parseFloat(document.getElementById('b_dur').value) || 1),
      ticket: parseFloat(document.getElementById('b_ticket').value) || 0,
      reservation: document.getElementById('b_resv').value,
      address: (document.getElementById('b_addr').value || '').trim(),
      hours: (document.getElementById('b_hours').value || '').trim(),
      mapUrl: (document.getElementById('b_map').value || '').trim(),
      image: (document.getElementById('b_img').value || '').trim(),
      note: (document.getElementById('b_note').value || '').trim()
    };
    if (spotId) {
      const s = day.spots.find(x => x.id === spotId);
      if (s) Object.assign(s, data);
    } else {
      day.spots.push(Object.assign({ id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), sourceId: '' }, data));
    }
    day.spots.sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('已保存', 'success');
  },

  deleteBlock(dayId, spotId) {
    if (!confirm('确定删除这个行程块？')) return;
    const d = app.getActiveDestination();
    if (!d) return;
    const day = (app.state[d.id].itinerary || []).find(x => x.id === dayId);
    if (!day) return;
    day.spots = (day.spots || []).filter(s => s.id !== spotId);
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('已删除', 'success');
  },

  /* ===== 修改 日期 / 天气 ===== */
  editDay(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const day = (app.state[d.id].itinerary || []).find(x => x.id === id);
    if (!day) return;
    app.openModal(`✏️ 编辑 Day · ${day.date || '新日期'}`, `
      <div class="form-grid cols-2">
        <div class="form-field"><label>日期 <span class="req">*</span></label><input type="date" id="d_date" value="${day.date || ''}" /></div>
        <div class="form-field"><label>当日天气</label><input id="d_weather" value="${day.weather || ''}" placeholder="晴 22-30℃" /></div>
        <div class="form-field col-span-full"><label>🗺️ 当日地图导航链接</label><input id="d_map" value="${day.mapLink || ''}" placeholder="https://..." /></div>
        <div class="form-field col-span-full"><label>📝 当日备注</label><textarea id="d_notes" rows="2">${day.notes || ''}</textarea></div>
      </div>
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.itinerary.saveDay('${id}')` }
    ]);
  },

  saveDay(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const date = document.getElementById('d_date').value;
    if (!date) return app.toast('请填写日期', 'warning');
    const list = app.state[d.id].itinerary;
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return;
    list[idx] = Object.assign({}, list[idx], {
      date,
      weather: document.getElementById('d_weather').value.trim(),
      mapLink: document.getElementById('d_map').value.trim(),
      notes: document.getElementById('d_notes').value.trim()
    });
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('日程已保存', 'success');
  },

  /* ===== 按起止日期自动生成空白日程 ===== */
  autoGenDays() {
    const d = app.getActiveDestination();
    if (!d) return;
    if (!d.startDate || !d.endDate) return app.toast('请先在「板块1」完善起止日期', 'warning');
    const days = app.dateDiff(d.startDate, d.endDate);
    if (days <= 0) return app.toast('起止日期无效', 'warning');
    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].itinerary) app.state[d.id].itinerary = [];
    const existingDates = new Set(app.state[d.id].itinerary.map(x => x.date));
    const start = new Date(d.startDate);
    let added = 0;
    for (let i = 0; i < days; i++) {
      const dt = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      if (!existingDates.has(dt)) {
        app.state[d.id].itinerary.push({
          id: 'it_' + Date.now() + '_' + i,
          date: dt, weather: '', morning: '', noon: '', evening: '',
          spots: [], hotel: { name: '', address: '', checkIn: '', checkOut: '', cost: 0 },
          dining: '', mapLink: '', notes: ''
        });
        added++;
      }
    }
    app.saveState();
    app.renderAll();
    app.toast(`已自动生成 ${added} 天空白日程（已存在 ${existingDates.size} 天被跳过）`, 'success');
  },

  addDay() {
    const d = app.getActiveDestination();
    if (!d) return app.toast('请先选择目的地', 'warning');
    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].itinerary) app.state[d.id].itinerary = [];
    app.state[d.id].itinerary.push({
      id: 'it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date: '', weather: '', morning: '', noon: '', evening: '',
      spots: [], hotel: { name: '', address: '', checkIn: '', checkOut: '', cost: 0 },
      dining: '', mapLink: '', notes: ''
    });
    app.saveState();
    app.renderAll();
  },

  removeDay(id) {
    const d = app.getActiveDestination();
    if (!d || !confirm('确定删除这一天的行程？')) return;
    if (app.state[d.id]?.itinerary) {
      app.state[d.id].itinerary = app.state[d.id].itinerary.filter(x => x.id !== id);
      app.saveState();
      app.renderAll();
    }
  },

  /* ===== 批量 AI 导入景点（粘贴后加入第一天） ===== */
  async fetchSpotsAI() {
    const d = app.getActiveDestination();
    if (!d) return app.toast('请先选择目的地', 'warning');
    app.openModal('🤖 批量导入景点到行程', `
      <p class="text-sm text-slate-600 mb-2">把 AI 检索结果粘贴进来（每行一个，格式：名称 | 地址 | 营业时间 | 门票 | 时长 | 交通 | 耗时 | 交通费），系统自动加入<strong>第一天</strong>行程，之后拖拽排期。</p>
      <textarea id="aiSpotsRaw" rows="10" placeholder="台北101 | 信义区… | 09:00-22:00 | 600 | 2 | 捷运 | 15分钟 | 30"></textarea>
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '导入到第一天', class: 'btn btn-primary', action: 'app.modules.itinerary.applyAiSpots()' }
    ]);
  },

  applyAiSpots() {
    const raw = (document.getElementById('aiSpotsRaw')?.value || '').trim();
    if (!raw) return app.toast('内容为空', 'warning');
    const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const spots = lines.map(l => {
      const p = l.split('|').map(x => x.trim());
      const dm = (p[4] || '').match(/(\d+(\.\d+)?)/);
      return {
        id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: p[0] || '', type: 'spot', startTime: '09:00',
        durationH: dm ? parseFloat(dm[1]) : 2,
        address: p[1] || '', hours: p[2] || '', ticket: parseFloat(p[3]) || 0,
        transport: p[5] || '', transportTime: p[6] || '', transportCost: parseFloat(p[7]) || 0,
        mapUrl: '', image: '', reservation: '', note: '', sourceId: ''
      };
    }).filter(s => s.name);
    if (!spots.length) return app.toast('未能解析出有效景点，请检查格式', 'warning');

    const d = app.getActiveDestination();
    if (!d) return;
    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].itinerary) app.state[d.id].itinerary = [];
    const firstDay = app.state[d.id].itinerary.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
    if (!firstDay) return app.toast('请先生成每日日程', 'warning');
    if (!firstDay.spots) firstDay.spots = [];
    spots.forEach(s => firstDay.spots.push(s));
    firstDay.spots.sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast(`✅ 已导入 ${spots.length} 个景点到第一天`, 'success');
  },

  /* ===== 路线优化建议 ===== */
  optimizeRoute() {
    const d = app.getActiveDestination();
    if (!d) return;
    const days = app.state[d.id]?.itinerary || [];
    const issues = [];
    days.forEach((day, i) => {
      if ((day.spots || []).length > 8) issues.push(`Day ${i + 1}（${day.date}）行程块 ${day.spots.length} 个，可能偏赶，建议 ≤8`);
      const noTime = (day.spots || []).filter(s => !s.startTime).length;
      if (noTime > 0) issues.push(`Day ${i + 1}（${day.date}）有 ${noTime} 个块未排时间`);
    });
    if (issues.length === 0) {
      app.toast('✅ 当前每日行程安排合理，无需调整', 'success');
    } else {
      app.openModal('🤖 行程优化建议', `
        <ul class="space-y-2 text-sm">
          ${issues.map(t => `<li class="p-2 bg-amber-50 rounded">⚠️ ${t}</li>`).join('')}
        </ul>
        <p class="text-tiny text-slate-500 mt-3">提示：热门景点建议提前在官方公众号/官网预约购票，避开限流时段；单日建议 ≤6–8 个行程块。</p>
      `, [{ text: '知道了', class: 'btn btn-primary', action: 'app.closeModal()' }]);
    }
  }
};
