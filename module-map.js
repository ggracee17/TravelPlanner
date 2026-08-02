/* ============================================================
   板块6：行程地图总览
   使用 Google Maps JavaScript API 在地图上标出每日行程地点；
   支持按日期下拉筛选（全部 / 某一天）。
   坐标优先用行程块里填的经纬度（来自 Google Map 链接解析）；
   未填则按「名称」通过 Google Geocoding 自动定位，并回写保存。
   无 API Key / 加载失败时降级为地点列表。

   API Key 由后端从环境变量 GMAPS_API_KEY 注入（见 server.js 的 /config.js 与 render.yaml），
   本文件不再硬编码，避免密钥进入 git 仓库。本地无后端时为空，地图自动降级为地点列表。
   （需在 Google Cloud 控制台启用 Maps JavaScript API 与 Geocoding API，并建议对 Key 加
    HTTP 引用限制 + API 限制，避免被盗刷。）
   ============================================================ */

// 从后端注入的配置读取 Key（window.BOARD_CONFIG.gmapsApiKey），不再硬编码。
function gmapsKey() {
  return (typeof window !== 'undefined' && window.BOARD_CONFIG && window.BOARD_CONFIG.gmapsApiKey) || '';
}

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
  _geoCache: {},        // 会话内地理编码结果缓存（query → {lat,lng}），避免重复消耗配额
  _geoFail: new Set(),  // 会话内地理编码失败的 query，避免重复调用

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
          坐标优先用行程块里填的「纬度 / 经度」（粘贴 Google Map 链接会自动获取）；未填则按「名称」通过 Google 地理编码自动定位（需联网）。
          下方列表里的<strong class="text-sky-700">地点名称已是可点击链接</strong>，点开即跳转到 Google Maps。
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
    if (!gmapsKey()) { this._failed = false; cb(); return; }
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
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(gmapsKey()) + '&callback=' + cbName;
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
      if (!gmapsKey() || typeof window === 'undefined' || !window.google || !window.google.maps || !window.google.maps.Geocoder) { resolve(null); return; }
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

  geocodeCached(q) {
    if (this._geoCache[q]) return Promise.resolve(this._geoCache[q]);
    if (this._geoFail.has(q)) return Promise.resolve(null);
    return this.geocode(q).then(r => { if (r) this._geoCache[q] = r; else this._geoFail.add(q); return r; });
  },

  async showMap() {
    const items = this.collectSpots(this._sel());
    if (!gmapsKey() || this._failed || typeof window === 'undefined' || !window.google || !window.google.maps) {
      const located = items.filter(it => it.spot.lat != null && it.spot.lng != null);
      this.renderList(items, located);
      if (!gmapsKey()) this._noteNeedKey();
      else if (this._failed) this._noteMapFallback();
      return;
    }
    // 地理编码缺失坐标（带缓存与失败去重，避免重复消耗配额）
    let needSave = false;
    for (const it of items) {
      const s = it.spot;
      if (s.lat != null && s.lng != null) continue;            // 已有坐标，跳过
      const q = [s.name, s.address].filter(Boolean).join(' ').trim();
      if (!q) { if (!s._geoFailed) { s._geoFailed = true; needSave = true; } continue; } // 无名称/地址，无法定位
      if (s._geoFailed && s._geoFailQ === q) continue;          // 同一查询曾失败，本次跳过（省配额）
      const g = await this.geocodeCached(q);
      if (g) { s.lat = g.lat; s.lng = g.lng; s._geoFailed = false; s._geoFailQ = ''; needSave = true; }
      else { s._geoFailed = true; s._geoFailQ = q; needSave = true; } // 失败标记，下次同查询不再调用
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
        (this._mapsUrl(s) ? `<br><a href="${this._mapsUrl(s)}" target="_blank" rel="noopener">🔗 在 Google Maps 打开</a>` : '') +
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
      const url = this._mapsUrl(s);
      const nameHtml = url
        ? `<a href="${url}" target="_blank" rel="noopener" class="text-sm font-semibold truncate text-sky-700 hover:underline">${this._esc(s.name || '未命名')}</a>`
        : `<span class="text-sm font-semibold truncate">${this._esc(s.name || '未命名')}</span>`;
      return `<div class="p-2 rounded border border-slate-200 flex items-start gap-2 ${located ? '' : 'opacity-60'}">
        <span style="width:10px;height:10px;border-radius:999px;background:${color};margin-top:5px;flex:none"></span>
        <div class="min-w-0">
          <div class="truncate">${nameHtml} <span class="text-tiny text-slate-400">${s.startTime || ''}</span></div>
          <div class="text-tiny text-slate-500 truncate">${located ? '' : '· <span class="text-amber-600">未定位（填写经纬度或粘贴地图链接）</span>'}</div>
        </div>
      </div>`;
    }).join('') + `</div>`;
  },

  _noteNeedKey() {
    const view = document.getElementById('mapView');
    if (view) view.innerHTML = '<div class="map-fallback">⚠️ 尚未配置 Google Maps API Key。请到 Render 控制台给本服务添加环境变量 <code>GMAPS_API_KEY</code>（后端会自动注入前端），并在 Google Cloud 启用 <b>Maps JavaScript API</b> 与 <b>Geocoding API</b>，重新部署后刷新即可显示地图。下方列表仍可正常查看地点。</div>';
  },

  _noteMapFallback() {
    const view = document.getElementById('mapView');
    if (view) view.innerHTML = '<div class="map-fallback">⚠️ Google Maps 未能加载。常见原因：① Key 未启用 <b>Maps JavaScript API</b> 与 <b>Geocoding API</b>；② Key 的「应用限制」(HTTP 引荐来源 / 网站限制) 未包含本站点域名；③ 网络被拦截。请到 Google Cloud 控制台核对后刷新。下方列表仍可正常查看地点。</div>';
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /* 计算地点的 Google Maps 打开链接：优先用用户粘贴的地图链接，其次经纬度精确坐标，最后按名称搜索 */
  _mapsUrl(s) {
    if (s.mapUrl) return s.mapUrl;
    if (s.lat != null && s.lng != null) {
      return 'https://www.google.com/maps?q=' + encodeURIComponent(s.lat + ',' + s.lng);
    }
    const q = (s.name || '').trim();
    if (q) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    return '';
  }
};
