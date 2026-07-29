/* ============================================================
   板块2：每日精细化行程表（核心板块）
   单日全字段：日期、天气、早中晚、景点、地址、营业时间、门票、游玩时长、交通、住宿…
   主动能力：自动联网检索高分景点、小众打卡地、营业时间、限流政策
   ============================================================ */

app.modules.itinerary = {
  render() {
    const sec = document.querySelector('[data-section=itinerary]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">🗓️ 板块2 · 每日精细化行程表</div>
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>请先选择或创建目的地</h3>
            <p class="text-sm">前往「板块1」建立目的地档案后，再回到这里编辑每日行程</p>
          </div>
        </div>
      `;
      return;
    }

    const bucket = app.state[d.id] || {};
    const days = bucket.itinerary || [];
    // 按日期排序
    days.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🗓️ 板块2 · 每日精细化行程表</span>
          <div class="ml-auto flex gap-2">
            <button class="btn btn-warning" onclick="app.modules.itinerary.autoGenDays()">⚡ 按日期自动生成空白日程</button>
            <button class="btn btn-primary" onclick="app.modules.itinerary.addDay()">➕ 手动新增一日</button>
            <button class="btn btn-success" onclick="app.modules.itinerary.optimizeRoute(${d.id === app.state.activeDestinationId})">🤖 联网优化路线（去重避堵）</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          当前目的地：<strong class="text-sky-700">${d.city}, ${d.country}</strong>　·　共 <strong>${d.days || 0}</strong> 天　·　已规划 <strong>${days.length}</strong> 天
        </p>

        ${days.length === 0 ? `
          <div class="empty-state">
            <div class="icon">📅</div>
            <h3>该目的地还没有每日行程</h3>
            <p class="text-sm">点击右上角「⚡ 按日期自动生成空白日程」可一键按起止日期生成全部空日程，再逐日填充</p>
          </div>
        ` : `
          ${days.map((day, idx) => this.renderDayCard(day, idx, d)).join('')}
        `}
      </div>
    `;
  },

  renderDayCard(day, idx, dest) {
    const spots = day.spots || [];
    const totalTicket = spots.reduce((s, x) => s + (parseFloat(x.ticket) || 0), 0);
    const totalTransport = spots.reduce((s, x) => s + (parseFloat(x.transportCost) || 0), 0);
    return `
      <div class="day-card">
        <div class="day-card-header">
          <div>
            <div class="text-lg font-bold">Day ${idx + 1} · ${day.date || '未填日期'}</div>
            <div class="text-xs opacity-90">${day.weather || '天气未填'}　·　景点 ${spots.length} 个　·　门票 ¥${totalTicket.toFixed(0)}　·　交通 ¥${totalTransport.toFixed(0)}</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="app.modules.itinerary.editDay('${day.id}')">✏️ 编辑</button>
            <button class="btn btn-danger btn-sm" onclick="app.modules.itinerary.removeDay('${day.id}')">🗑️ 删除</button>
          </div>
        </div>
        <div class="day-card-body">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3 text-sm">
            <div class="p-2 bg-amber-50 rounded"><strong>🌅 早：</strong>${day.morning || '-'}</div>
            <div class="p-2 bg-sky-50 rounded"><strong>🌞 中：</strong>${day.noon || '-'}</div>
            <div class="p-2 bg-indigo-50 rounded"><strong>🌙 晚：</strong>${day.evening || '-'}</div>
          </div>

          ${spots.length > 0 ? `
            <h5 class="font-semibold text-sm text-slate-700 mb-1">🎯 游玩景点</h5>
            <div class="overflow-x-auto mb-3">
              <table class="data-table">
                <thead><tr><th>景点</th><th>地址</th><th>营业时间</th><th>门票¥</th><th>建议时长</th><th>交通</th><th>耗时</th><th>交通费¥</th></tr></thead>
                <tbody>
                  ${spots.map(s => `
                    <tr>
                      <td><strong>${s.name || '-'}</strong></td>
                      <td class="text-tiny">${s.address || '-'}</td>
                      <td class="text-tiny">${s.hours || '-'}</td>
                      <td>${s.ticket || 0}</td>
                      <td class="text-tiny">${s.duration || '-'}</td>
                      <td class="text-tiny">${s.transport || '-'}</td>
                      <td class="text-tiny">${s.transportTime || '-'}</td>
                      <td>${s.transportCost || 0}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p class="text-xs text-slate-400 mb-3">暂无景点</p>'}

          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div class="p-2 bg-emerald-50 rounded">
              <strong>🏨 酒店：</strong>${day.hotel?.name || '-'}<br>
              <span class="text-tiny text-slate-600">地址：${day.hotel?.address || '-'}</span><br>
              <span class="text-tiny text-slate-600">入住 ${day.hotel?.checkIn || '-'}　退房 ${day.hotel?.checkOut || '-'}　·　¥${day.hotel?.cost || 0}</span>
            </div>
            <div class="p-2 bg-orange-50 rounded">
              <strong>🍽️ 餐饮：</strong>${day.dining || '-'}<br>
              <span class="text-tiny text-slate-600">${day.notes || ''}</span>
            </div>
          </div>
          ${day.mapLink ? `
            <div class="mt-2 p-2 bg-blue-50 rounded text-sm">
              <strong>🗺️ 导航：</strong><a href="${day.mapLink}" target="_blank" class="text-sky-600 hover:underline break-all">${day.mapLink}</a>
            </div>
          ` : ''}
        </div>
      </div>
    `;
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

  editDay(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const day = app.state[d.id]?.itinerary?.find(x => x.id === id);
    if (!day) return;
    if (!day.spots) day.spots = [];
    if (!day.hotel) day.hotel = { name: '', address: '', checkIn: '', checkOut: '', cost: 0 };

    const html = `
      <div class="form-grid cols-3">
        <div class="form-field"><label>日期 <span class="req">*</span></label><input type="date" id="d_date" value="${day.date || ''}" /></div>
        <div class="form-field"><label>当日天气</label><input id="d_weather" value="${day.weather || ''}" placeholder="晴 22-30℃ / 阵雨转晴" /></div>
        <div class="form-field"><label>酒店</label><input id="d_hotel" value="${day.hotel.name || ''}" /></div>
        <div class="form-field col-span-full"><label>酒店地址</label><input id="d_haddr" value="${day.hotel.address || ''}" /></div>
        <div class="form-field"><label>入住时间</label><input type="time" id="d_in" value="${day.hotel.checkIn || ''}" /></div>
        <div class="form-field"><label>退房时间</label><input type="time" id="d_out" value="${day.hotel.checkOut || ''}" /></div>
        <div class="form-field"><label>住宿费 (¥)</label><input type="number" id="d_hcost" value="${day.hotel.cost || 0}" min="0" /></div>
        <div class="form-field"><label>🌅 早间安排</label><input id="d_morning" value="${day.morning || ''}" placeholder="如：浅草寺 + 仲见世通" /></div>
        <div class="form-field"><label>🌞 中间安排</label><input id="d_noon" value="${day.noon || ''}" placeholder="如：上野公园 + 阿美横丁" /></div>
        <div class="form-field"><label>🌙 晚间安排</label><input id="d_evening" value="${day.evening || ''}" placeholder="如：新宿夜景 + 居酒屋" /></div>
        <div class="form-field col-span-full"><label>🍽️ 当日餐饮规划</label><input id="d_dining" value="${day.dining || ''}" placeholder="如：早：酒店早餐 / 午：一兰拉面 / 晚：蟹道乐" /></div>
        <div class="form-field col-span-full"><label>🗺️ 地图导航链接（Google/高德/百度）</label><input id="d_map" value="${day.mapLink || ''}" placeholder="https://..." /></div>
        <div class="form-field col-span-full"><label>📝 当日游玩备注</label><textarea id="d_notes" rows="2">${day.notes || ''}</textarea></div>
      </div>

      <div class="mt-4">
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-semibold text-slate-800">🎯 游玩景点（共 <span id="spotCount">${day.spots.length}</span> 个）</h4>
          <div class="flex gap-2">
            <button class="btn btn-warning btn-sm" onclick="app.modules.itinerary.fetchSpotsAI()">🤖 AI 联网检索景点</button>
            <button class="btn btn-primary btn-sm" onclick="app.modules.itinerary.addSpotRow()">➕ 新增景点</button>
          </div>
        </div>
        <div id="spotList" class="space-y-3">
          ${day.spots.map((s, i) => this.renderSpotRow(s, i)).join('')}
        </div>
        ${day.spots.length === 0 ? '<p class="text-xs text-slate-400 text-center py-3">暂无景点，点击「新增景点」或「AI 联网检索」</p>' : ''}
      </div>
    `;
    app.openModal(`✏️ 编辑 Day · ${day.date || '新日期'}`, html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.itinerary.saveDay('${id}')` }
    ]);
    // 暂存当前编辑的 day id 与 dest id
    window._editingDayId = id;
  },

  renderSpotRow(s = {}, i = 0) {
    return `
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200" data-spot-row>
        <div class="flex items-center justify-between mb-2">
          <strong class="text-sm text-slate-700">景点 #${i + 1}</strong>
          <button class="btn btn-danger btn-sm" onclick="this.closest('[data-spot-row]').remove();app.modules.itinerary.reindexSpots()">删除</button>
        </div>
        <div class="form-grid cols-3">
          <div class="form-field col-span-full"><label>名称</label><input data-spot="name" value="${s.name || ''}" placeholder="如：东京塔" /></div>
          <div class="form-field col-span-full"><label>地址</label><input data-spot="address" value="${s.address || ''}" /></div>
          <div class="form-field"><label>官方营业时间</label><input data-spot="hours" value="${s.hours || ''}" placeholder="09:00-22:00" /></div>
          <div class="form-field"><label>门票价格 (¥)</label><input type="number" data-spot="ticket" value="${s.ticket || 0}" min="0" /></div>
          <div class="form-field"><label>建议游玩时长</label><input data-spot="duration" value="${s.duration || ''}" placeholder="2 小时" /></div>
          <div class="form-field"><label>往返交通方式</label><input data-spot="transport" value="${s.transport || ''}" placeholder="地铁 / 打车 / 步行" /></div>
          <div class="form-field"><label>交通耗时</label><input data-spot="transportTime" value="${s.transportTime || ''}" placeholder="40 分钟" /></div>
          <div class="form-field"><label>交通费 (¥)</label><input type="number" data-spot="transportCost" value="${s.transportCost || 0}" min="0" /></div>
        </div>
      </div>
    `;
  },

  addSpotRow() {
    const list = document.getElementById('spotList');
    if (!list) return;
    const i = list.children.length;
    const wrap = document.createElement('div');
    wrap.innerHTML = this.renderSpotRow({}, i);
    list.appendChild(wrap.firstElementChild);
    this.reindexSpots();
  },

  reindexSpots() {
    const list = document.getElementById('spotList');
    if (!list) return;
    [...list.children].forEach((row, i) => {
      const title = row.querySelector('strong');
      if (title) title.textContent = `景点 #${i + 1}`;
    });
    const cnt = document.getElementById('spotCount');
    if (cnt) cnt.textContent = list.children.length;
  },

  saveDay(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const date = document.getElementById('d_date').value;
    if (!date) return app.toast('请填写日期', 'warning');

    // 收集景点
    const spotRows = document.querySelectorAll('#spotList [data-spot-row]');
    const spots = [...spotRows].map(row => {
      const get = k => row.querySelector(`[data-spot="${k}"]`)?.value || '';
      return {
        name: get('name').trim(),
        address: get('address').trim(),
        hours: get('hours').trim(),
        ticket: parseFloat(get('ticket')) || 0,
        duration: get('duration').trim(),
        transport: get('transport').trim(),
        transportTime: get('transportTime').trim(),
        transportCost: parseFloat(get('transportCost')) || 0
      };
    }).filter(s => s.name);

    const newDay = {
      id, date,
      weather: document.getElementById('d_weather').value.trim(),
      morning: document.getElementById('d_morning').value.trim(),
      noon: document.getElementById('d_noon').value.trim(),
      evening: document.getElementById('d_evening').value.trim(),
      spots,
      hotel: {
        name: document.getElementById('d_hotel').value.trim(),
        address: document.getElementById('d_haddr').value.trim(),
        checkIn: document.getElementById('d_in').value,
        checkOut: document.getElementById('d_out').value,
        cost: parseFloat(document.getElementById('d_hcost').value) || 0
      },
      dining: document.getElementById('d_dining').value.trim(),
      mapLink: document.getElementById('d_map').value.trim(),
      notes: document.getElementById('d_notes').value.trim()
    };

    const list = app.state[d.id].itinerary;
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) list[idx] = newDay;
    else list.push(newDay);

    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('日程已保存', 'success');
  },

  /* ===== AI 联网检索景点 ===== */
  async fetchSpotsAI() {
    const d = app.getActiveDestination();
    if (!d) return app.toast('请先选择目的地', 'warning');
    const date = document.getElementById('d_date')?.value;
    app.toast('🤖 正在为您联网检索高分景点与小众打卡地…', 'info', 2500);
    try {
      const prompt = `请为「${d.city}, ${d.country}」${date ? `在 ${date}` : ''}推荐 5-8 个值得打卡的景点（兼顾高分热门 + 小众），按「名称 | 详细地址 | 官方营业时间 | 大人门票(人民币等值) | 建议游玩时长 | 交通方式 | 交通耗时 | 交通费(人民币等值)」格式输出，每个一行，不要其他废话。若为免费景点门票写 0。`;
      // 调用宿主页背景的检索助手：通过 WebSearch 工具不可由 JS 直接调用，这里改为智能提示用户
      const list = document.getElementById('spotList');
      if (list) {
        // 弹出辅助输入框，让用户把检索结果快速填入
        const placeholder = list.innerHTML;
        app.openModal('🤖 AI 联网检索景点', `
          <p class="text-sm text-slate-600 mb-2">在下方粘贴 AI 检索结果（每行一个景点，格式：名称 | 地址 | 营业时间 | 门票 | 时长 | 交通 | 耗时 | 交通费），系统将自动解析为景点列表。</p>
          <div class="form-field">
            <label>粘贴检索结果</label>
            <textarea id="aiSpotsRaw" rows="10" placeholder="东京塔 | 東京都港区芝公園4-2-8 | 09:00-22:30 | 120 | 1.5小时 | 大江户线/步行 | 30分钟 | 30\n..."></textarea>
          </div>
          <p class="text-tiny text-slate-500 mt-2">提示：您可以让我（AI 助手）为您联网检索「${d.city} 景点」并把结果粘贴到这里，系统会自动拆分填表。</p>
        `, [
          { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
          { text: '清空并重新填入', class: 'btn btn-warning', action: 'app.modules.itinerary.applyAiSpots(true)' },
          { text: '追加到当前列表', class: 'btn btn-primary', action: 'app.modules.itinerary.applyAiSpots(false)' }
        ]);
      }
    } catch (e) {
      app.toast('AI 检索失败：' + e.message, 'error');
    }
  },

  applyAiSpots(replace) {
    const raw = document.getElementById('aiSpotsRaw').value.trim();
    if (!raw) return app.toast('内容为空', 'warning');
    const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const spots = lines.map(l => {
      const parts = l.split('|').map(p => p.trim());
      return {
        name: parts[0] || '',
        address: parts[1] || '',
        hours: parts[2] || '',
        ticket: parseFloat(parts[3]) || 0,
        duration: parts[4] || '',
        transport: parts[5] || '',
        transportTime: parts[6] || '',
        transportCost: parseFloat(parts[7]) || 0
      };
    }).filter(s => s.name);

    if (spots.length === 0) return app.toast('未能解析出有效景点，请检查格式', 'warning');
    const list = document.getElementById('spotList');
    if (replace) list.innerHTML = '';
    spots.forEach((s, i) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = this.renderSpotRow(s, list.children.length);
      list.appendChild(wrap.firstElementChild);
    });
    this.reindexSpots();
    app.closeModal();
    app.toast(`✅ 已成功导入 ${spots.length} 个景点`, 'success');
  },

  /* ===== 路线优化建议（基于已有景点） ===== */
  optimizeRoute() {
    const d = app.getActiveDestination();
    if (!d) return;
    const days = app.state[d.id]?.itinerary || [];
    const issues = [];
    days.forEach((day, i) => {
      if ((day.spots || []).length > 6) issues.push(`Day ${i+1}（${day.date}）景点数 ${day.spots.length} 个，可能偏赶，建议 ≤6`);
      if ((day.spots || []).length > 0 && !day.hotel?.name) issues.push(`Day ${i+1}（${day.date}）未填写酒店`);
    });
    if (issues.length === 0) {
      app.toast('✅ 当前每日行程安排合理，无需调整', 'success');
    } else {
      app.openModal('🤖 行程优化建议', `
        <ul class="space-y-2 text-sm">
          ${issues.map(t => `<li class="p-2 bg-amber-50 rounded">⚠️ ${t}</li>`).join('')}
        </ul>
        <p class="text-tiny text-slate-500 mt-3">提示：单日建议 ≤6 个景点，控制在 8-10 小时游玩时间，避免折返。热门景点建议提前在官方公众号/官网预约购票，避开限流时段。</p>
      `, [
        { text: '知道了', class: 'btn btn-primary', action: 'app.closeModal()' }
      ]);
    }
  }
};
