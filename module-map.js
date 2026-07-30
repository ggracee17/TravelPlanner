/* ============================================================
   板块6：行程地图总览
   使用 Google Maps JavaScript API 在地图上标出每日行程地点；
   支持按日期下拉筛选（全部 / 某一天）。
   坐标优先用行程块里填的经纬度（来自 Google Map 链接解析）；
   未填则按「名称 + 地址」通过 Google Geocoding 自动定位，并回写保存。
   无 API Key / 加载失败时降级为地点列表。

   使用前：在下方 GMAPS_API_KEY 填入你的 Google Maps API Key
   （需在 Google Cloud 控制台启用 Maps JavaScript API 与 Geocoding API）。
   ============================================================ */

const GMAPS_API_KEY = ''; // ← 在此粘贴你的 Google Maps API Key

const MAP_COLORS = {
  restaurant: '#ef4444', hotel: '#a855f7', spot: '#3b82f6',
  transport: '#06b6d4', shopping: '#f97316', other: '#64748b'
};

app.modules.map = {
  _map: null,
  _loading: false,
  _failed: false,
  _cbs: [],
  _lastBounds: null,

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
          在 Google 地图上标出每日行程的地点，可下拉切换查看<strong class="text-sky-700">某一天</strong>的行程分布。
          坐标优先用行程块里填的「纬度 / 经度」（粘贴 Google Map 链接会自动获取）；未填则按「名称 + 地址」通过 Google 地理编码自动定位（需联网）。
        </p>
        <div id="mapView" class="map-view"></div>
        <div id="mapList" class="mt-3"></div>
      </div>`;
    this.ensureMaps(() => this.showMap());
  },

  onShow() {
    if (this._map && window.google && window.google.maps) {
      setTimeout(() => {
        try { window.google.maps.event.trigger(this._map, 'resize'); if (this._lastBounds) this._map.fitBounds(this._lastBounds); } catch (e) {}
      }, 60);
    }
  },

  rerender() {
    this.ensureMaps(() => this.showMap());
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

  /* 动态加载 Google Maps JS API（仅需一次） */
  ensureMaps(cb) {
    if (!GMAPS_API_KEY) { this._failed = false; cb(); return; }
    if (typeof window !== 'undefined' && window.google && window.google.maps) { cb(); return; }
    if (this._loading) { this._cbs.push(cb); return; }
    this._loading = true; this._cbs = [cb];
    const win = window;
    const cbName = '__gmapsReady' + Date.now();
    win[cbName] = () => {
      this._loading = false;
      this._cbs.forEach(f => { try { f(); } catch (e) {} });
      this._cbs = [];
      try { delete win[cbName]; } catch (e) {}
    };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GMAPS_API_KEY) + '&callback=' + cbName;
    s.async = true;
    s.onerror = () => {
      this._loading = false; this._failed = true;
      this._cbs.forEach(f => { try { f(); } catch (e) {} });
      this._cbs = [];
    };
    document.head.appendChild(s);
  },

  /* Google 地理编码：名称/地址 → 坐标 */
  geocode(q) {
    return new Promise((resolve) => {
      if (!GMAPS_API_KEY || typeof window === 'undefined' || !window.google || !window.google.maps || !window.google.maps.Geocoder) { resolve(null); return; }
      try {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ address: q }, (results, status) => {
          if (status === 'OK' && results && results[0]) {
            const loc = results[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
          } else { resolve(null); }
        });
      } catch (e) { resolve(null); }
    });
  },

  async showMap() {
    const items = this.collectSpots(this._sel());
    if (!GMAPS_API_KEY || this._failed || typeof window === 'undefined' || !window.google || !window.google.maps) {
      const located = items.filter(it => it.spot.lat != null && it.spot.lng != null);
      this.renderList(items, located);
      if (!GMAPS_API_KEY) this._noteNeedKey();
      else if (this._failed) this._noteMapFallback();
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

  _pin(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">` +
      `<path fill="${color}" stroke="#ffffff" stroke-width="1.5" d="M12 0C5.4 0 0 5.4 0 12c0 8 12 24 12 24s12-16 12-24c0-6.6-5.4-12-12-12z"/>` +
      `<circle cx="12" cy="12" r="5" fill="#ffffff"/></svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  },

  drawMap(withCoord) {
    const view = document.getElementById('mapView');
    if (!view) return;
    if (this._map) { try { this._map = null; } catch (e) {} }
    const gm = window.google.maps;
    const center = withCoord.length ? { lat: parseFloat(withCoord[0].spot.lat), lng: parseFloat(withCoord[0].spot.lng) } : { lat: 25.033, lng: 121.565 };
    const map = new gm.Map(view, { center, zoom: 12, mapTypeControl: true, streetViewControl: true });
    const bounds = new gm.LatLngBounds();
    withCoord.forEach(it => {
      const s = it.spot;
      const pos = { lat: parseFloat(s.lat), lng: parseFloat(s.lng) };
      const marker = new gm.Marker({ position: pos, map, title: s.name || '地点', icon: this._pin(MAP_COLORS[s.type] || MAP_COLORS.other) });
      const content = `<div style="min-width:170px"><strong>${this._esc(s.name)}</strong>` +
        `<br><span style="font-size:.7rem;color:#64748b">${it.dayIndex >= 0 ? ('Day ' + (it.dayIndex + 1) + ' ') : ''}${s.startTime || ''}</span>` +
        (s.address ? `<br><span style="font-size:.7rem;color:#475569">${this._esc(s.address)}</span>` : '') +
        (s.mapUrl ? `<br><a href="${s.mapUrl}" target="_blank">🔗 Google Map</a>` : '') +
        `</div>`;
      const info = new gm.InfoWindow({ content });
      marker.addListener('click', () => info.open(map, marker));
      bounds.extend(pos);
    });
    if (withCoord.length > 1) { map.fitBounds(bounds); this._lastBounds = bounds; }
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

  _noteNeedKey() {
    const view = document.getElementById('mapView');
    if (view) view.innerHTML = '<div class="map-fallback">⚠️ 尚未配置 Google Maps API Key。请在 <code>module-map.js</code> 顶部的 <code>GMAPS_API_KEY</code> 填入你的 Key（需在 Google Cloud 启用 Maps JavaScript API 与 Geocoding API），刷新后即可显示地图。下方列表仍可正常查看地点。</div>';
  },

  _noteMapFallback() {
    const view = document.getElementById('mapView');
    if (view) view.innerHTML = '<div class="map-fallback">⚠️ Google Maps 加载失败（可能 Key 无效、未启用对应 API 或网络被拦截），已下方列表展示地点。检查 Key 与 API 启用状态后刷新即可。</div>';
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
};
