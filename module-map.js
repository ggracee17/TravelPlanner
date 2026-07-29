/* ============================================================
   板块6：行程地图总览
   用 Leaflet + OpenStreetMap（免 API Key）在地图上标出每日行程地点；
   支持按日期下拉筛选（全部 / 某一天）。
   坐标优先用行程块里手填的经纬度；未填则用地名+地址通过
   OpenStreetMap Nominatim 地理编码定位，并回写保存。
   无网络 / Leaflet 加载失败时降级为地点列表。
   ============================================================ */

const MAP_COLORS = {
  restaurant: '#ef4444', hotel: '#a855f7', spot: '#3b82f6',
  transport: '#06b6d4', shopping: '#f97316', other: '#64748b'
};

app.modules.map = {
  _map: null,
  _loading: false,
  _failed: false,
  _cbs: [],

  render() {
    const sec = document.querySelector('[data-section=map]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">🗺️ 板块6 · 行程地图总览</div>
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>请先选择目的地</h3>
            <p class="text-sm">在「板块1」建立目的地并排好每日行程后，这里会在地图上标出所有地点</p>
          </div>
        </div>`;
      return;
    }
    const days = (app.state[d.id]?.itinerary || [])
      .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const sel = days.map((day, idx) => `<option value="${day.id}">Day ${idx + 1} · ${day.date || '?'}</option>`).join('');

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🗺️ 板块6 · 行程地图总览</span>
          <div class="ml-auto">
            <select id="mapDaySel" class="text-sm border border-slate-300 rounded px-2 py-1" onchange="app.modules.map.rerender()">
              <option value="__all">全部日期</option>${sel}
            </select>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-3">
          在地图上标出每日行程的地点，可下拉切换查看<strong class="text-sky-700">某一天</strong>的行程分布。
          坐标优先用行程块里填的「纬度 / 经度」；未填则按「名称 + 地址」通过 OpenStreetMap 自动定位（需联网）。
        </p>
        <div id="mapView" class="map-view"></div>
        <div id="mapList" class="mt-3"></div>
      </div>`;
    this.ensureLeaflet(() => this.showMap());
  },

  onShow() {
    if (this._map) setTimeout(() => { try { this._map.invalidateSize(); } catch (e) {} }, 60);
  },

  rerender() {
    this.ensureLeaflet(() => this.showMap());
  },

  _sel() {
    const el = document.getElementById('mapDaySel');
    return el ? el.value : '__all';
  },

  /* 收集选中日期范围内的所有行程块（纯数据，可单测） */
  collectSpots(dayId) {
    const d = app.getActiveDestination();
    if (!d) return [];
    const days = (app.state[d.id]?.itinerary || [])
      .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const out = [];
    days.forEach((day, idx) => {
      if (dayId !== '__all' && day.id !== dayId) return;
      (day.spots || []).forEach(s => out.push({ spot: s, dayIndex: idx, date: day.date }));
    });
    return out;
  },

  ensureLeaflet(cb) {
    if (typeof window !== 'undefined' && window.L) { cb(); return; }
    if (this._failed) { cb(); return; }
    if (this._loading) { this._cbs.push(cb); return; }
    this._loading = true; this._cbs = [cb];
    if (typeof document !== 'undefined' && !document.getElementById('leaflet-css')) {
      const lk = document.createElement('link');
      lk.id = 'leaflet-css'; lk.rel = 'stylesheet';
      lk.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(lk);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => { this._loading = false; this._cbs.forEach(f => f()); this._cbs = []; };
    s.onerror = () => { this._loading = false; this._failed = true; this._cbs.forEach(f => f()); this._cbs = []; };
    document.head.appendChild(s);
  },

  async showMap() {
    const L = (typeof window !== 'undefined') ? window.L : undefined;
    const items = this.collectSpots(this._sel());
    if (typeof L === 'undefined' || this._failed) {
      this.renderList(items, []);
      if (this._failed) this._noteMapFallback();
      return;
    }
    // 地理编码缺失坐标
    let needSave = false;
    for (const it of items) {
      const s = it.spot;
      if (s.lat == null || s.lng == null) {
        const q = [s.name, s.address].filter(Boolean).join(' ').trim();
        if (q) {
          const g = await this.geocode(q);
          if (g) { s.lat = g.lat; s.lng = g.lng; needSave = true; }
        }
      }
    }
    if (needSave) app.saveState();
    const withCoord = items.filter(it => it.spot.lat != null && it.spot.lng != null);
    this.renderList(items, withCoord);
    this.drawMap(withCoord);
  },

  geocode(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(arr => (arr && arr[0]) ? { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) } : null)
      .catch(() => null);
  },

  drawMap(withCoord) {
    const view = document.getElementById('mapView');
    if (!view) return;
    if (this._map) { try { this._map.remove(); } catch (e) {} this._map = null; }
    const L = window.L;
    const map = L.map(view, { scrollWheelZoom: true }).setView([25.033, 121.565], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    const bounds = [];
    withCoord.forEach(it => {
      const s = it.spot;
      const m = L.marker([s.lat, s.lng]).addTo(map);
      m.bindPopup(
        `<div style="min-width:170px"><strong>${this._esc(s.name)}</strong>` +
        `<br><span style="font-size:.7rem;color:#64748b">${it.dayIndex >= 0 ? ('Day ' + (it.dayIndex + 1) + ' ') : ''}${s.startTime || ''}</span>` +
        (s.address ? `<br><span style="font-size:.7rem;color:#475569">${this._esc(s.address)}</span>` : '') +
        (s.mapUrl ? `<br><a href="${s.mapUrl}" target="_blank">🔗 Google Map</a>` : '') +
        `</div>`
      );
      bounds.push([s.lat, s.lng]);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
    this._map = map;
  },

  renderList(items, withCoord) {
    const el = document.getElementById('mapList');
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<p class="text-xs text-slate-400">该日期下还没有行程地点</p>';
      return;
    }
    const okSet = new Set(withCoord.map(it => it.spot.id));
    el.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 gap-2">` + items.map(it => {
      const s = it.spot;
      const located = okSet.has(s.id);
      const color = MAP_COLORS[s.type] || MAP_COLORS.other;
      return `<div class="p-2 rounded border border-slate-200 flex items-start gap-2 ${located ? '' : 'opacity-60'}">
        <span style="width:10px;height:10px;border-radius:999px;background:${color};margin-top:5px;flex:none"></span>
        <div class="min-w-0">
          <div class="text-sm font-semibold truncate">${this._esc(s.name || '未命名')} <span class="text-tiny text-slate-400">${s.startTime || ''}</span></div>
          <div class="text-tiny text-slate-500 truncate">${s.address ? this._esc(s.address) : '地址未填'} ${located ? '' : '· <span class="text-amber-600">未定位（检查地址或填写经纬度）</span>'}</div>
        </div>
      </div>`;
    }).join('') + `</div>`;
  },

  _noteMapFallback() {
    const view = document.getElementById('mapView');
    if (view) view.innerHTML = '<div class="map-fallback">⚠️ 地图组件加载失败（可能离线或被网络拦截），已下方列表展示地点。连网后刷新即可加载在线地图。</div>';
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
};
