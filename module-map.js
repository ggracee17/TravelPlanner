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

// 全部日期视图：按「第几天」分色（Day1 红 → Day2 橙 → … 循环）
const DAY_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#a855f7'];

// 单日视图：按「地点类别」分色，复用 MAP_COLORS + 中文标签
const CATEGORY_LABELS = {
  restaurant: '餐饮', hotel: '酒店', spot: '景点',
  transport: '交通', shopping: '购物', other: '其他'
};

app.modules.map = {
  _map: null,
  _loading: false,
  _failed: false,
  _cbs: [],
  _lastBounds: null,
  _geoCacheKey: 'travel_geo_cache_v1', // 离线地理编码缓存（跨刷新/会话复用，省 Geocoding 配额）
  _geoCache: {},        // 地理编码结果缓存（query → {lat,lng}），先从 localStorage 装载，避免重复消耗配额
  _geoFail: new Set(),  // 地理编码失败的 query，避免重复调用（持久化，跨刷新也不重试）
  _geoLoaded: false,
  _urlResolveKey: 'travel_url_resolve_v1', // 地图链接（短链）服务端解析结果缓存
  _urlCache: undefined,
  _urlFail: undefined,

  render() {
    const sec = document.querySelector('[data-section=map]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">${app.t('map.title')}</div>
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>${app.t('map.emptyTitle')}</h3>
            <p class="text-sm">${app.t('map.emptyHint')}</p>
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
          <span>${app.t('map.title')}</span>
          <div class="ml-auto flex items-center gap-3 flex-wrap">
            <select id="mapDaySel" class="text-sm border border-slate-300 rounded px-2 py-1" onchange="app.modules.map.rerender()">
              <option value="__all">${app.t('map.allDates')}</option>${sel}
            </select>
            <label class="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" ${app.state.mapShowUnjoined ? 'checked' : ''} onchange="app.state.mapShowUnjoined=this.checked;app.modules.map.rerender()" /> 显示未加入行程的地点
            </label>
            <label class="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" ${app.state.mapShowHidden ? 'checked' : ''} onchange="app.state.mapShowHidden=this.checked;app.modules.map.rerender()" /> 显示已隐藏
            </label>
            <button class="btn btn-ghost btn-sm" onclick="app.modules.map.clearGeoCache()" title="${app.t('map.clearCacheTip')}">${app.t('map.clearCache')}</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-3">${app.t('map.intro')}</p>
        <div id="mapView" class="map-view"></div>
        <div id="mapLegend" class="mt-2 mb-2 flex flex-wrap gap-3 text-xs"></div>
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

  // 关闭当前打开的地图信息弹窗（如点「隐藏」后让弹窗自动收起）
  closeInfo() {
    try { if (this._lastInfo) this._lastInfo.close(); } catch (e) {}
  },

  _sel() {
    const el = document.getElementById('mapDaySel');
    return el ? el.value : '__all';
  },

  /* 收集选中日期范围内的所有行程块（纯数据，可单测）。
     - 默认排除 hidden 的地点；开启「显示已隐藏」(mapShowHidden) 时一并纳入（用于取消隐藏）。
     - 开启「显示未加入行程的地点」(mapShowUnjoined) 且为「全部日期」视图时，并入
       尚未排入时间轴的候选库地点（这些地点本身不在任何一天，仅在地图上临时展示）。 */
  collectSpots(dayId) {
    const d = app.getActiveDestination();
    if (!d) return [];
    const days = (app.state[d.id]?.itinerary || [])
      .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const showHidden = !!app.state.mapShowHidden;
    const showUnjoined = !!app.state.mapShowUnjoined;
    const out = [];
    const seenSource = new Set();
    days.forEach((day, idx) => {
      if (dayId !== '__all' && day.id !== dayId) return;
      (day.spots || []).forEach(s => {
        const hidden = !!s.hidden;
        if (hidden && !showHidden) return;
        if (s.sourceId) seenSource.add(s.sourceId);
        out.push({ spot: s, dayIndex: idx, date: day.date, dayId: day.id, isCand: false, hidden });
      });
    });
    // 未加入行程表的候选地点（仅「全部日期」视图，避免与具体某天混淆）
    if (showUnjoined && dayId === '__all') {
      const cands = Array.isArray(app.state.candidates) ? app.state.candidates : [];
      cands.forEach(c => {
        const hidden = !!c.hidden;
        if (hidden && !showHidden) return;
        if (seenSource.has(c.id)) return; // 已作为行程块显示，跳过
        out.push({ spot: this._candToSpot(c), dayIndex: -1, date: null, dayId: '', isCand: true, hidden });
      });
    }
    return out;
  },

  /* 候选库项目 → 地图用的 spot-like 对象（类型中文→英文 key，供 MAP_COLORS 取色） */
  _candToSpot(c) {
    const CN2EN = { '餐饮': 'restaurant', '景点': 'spot', '住宿': 'hotel', '交通': 'transport', '购物': 'shopping', '娱乐': 'entertainment', '拍照': 'photo', '甜品': 'dessert', '小吃': 'snack', '活动': 'activity', '其他': 'other' };
    return {
      id: c.id, name: c.name,
      type: CN2EN[c.type] || 'other',
      lat: c.lat, lng: c.lng,
      mapUrl: c.mapUrl || '',
      address: c.address || '',
      startTime: '', sourceId: c.id
    };
  },

  /* 手动隐藏 / 显示某个地点（仅作用于地图：不影响行程库与时间轴）。
     行程块：翻转 day.spots[id].hidden；候选：翻转 candidate.hidden。 */
  toggleHidden(dayId, spotId, isCand) {
    if (isCand) {
      const c = (app.state.candidates || []).find(x => x.id === spotId);
      if (c) c.hidden = !c.hidden;
    } else {
      const d = app.getActiveDestination();
      if (!d) return;
      const day = (app.state[d.id]?.itinerary || []).find(x => x.id === dayId);
      const sp = day && (day.spots || []).find(s => s.id === spotId);
      if (sp) sp.hidden = !sp.hidden;
    }
    app.saveState();
    this.rerender();
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
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(gmapsKey()) + '&loading=async&callback=' + cbName;
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
    if (!this._geoLoaded) this.loadGeoCache();
    if (this._geoCache[q]) return Promise.resolve(this._geoCache[q]);
    if (this._geoFail.has(q)) return Promise.resolve(null);
    return this.geocode(q).then(r => {
      if (r) { this._geoCache[q] = r; this.persistGeoCache(); }
      else { this._geoFail.add(q); this.persistGeoCache(); }
      return r;
    });
  },

  /* 解析单个行程地点坐标：优先地图链接，其次按名称地理编码。
     返回 'existing'（已有坐标）| 'located'（本次新定位）| 'failed-new'（本次新标记定位失败）| 'skip-failed'（曾失败已跳过）。
     'located'/'failed-new' 表示本次有写库，调用方据此决定是否 saveState。 */
  async _resolveItemCoord(it) {
    const s = it.spot;
    // 优先用行程里的地图链接坐标：只要有链接且能解析出坐标，就【强制】以此为基准（覆盖可能存在的旧坐标 /
    // 错误地理编码结果，例如「台北到悉尼」被错定到悉尼）。仅当链接无法解析出坐标时，才退回「已有坐标 → 名称地理编码」的兜底。
    // —— 对应诉求：所有地图上的点都按行程里的链接定位。
    const fromUrl = s.mapUrl ? extractCoordsFromMapUrl(s.mapUrl) : null;
    if (fromUrl) {
      const changed = !(s.lat === fromUrl.lat && s.lng === fromUrl.lng); // 与现坐标一致则无需回写
      s.lat = fromUrl.lat; s.lng = fromUrl.lng;
      if (it.isCand) { const c = (app.state.candidates || []).find(x => x.id === it.spot.id); if (c) { c.lat = fromUrl.lat; c.lng = fromUrl.lng; } }
      s._geoFailed = false; s._geoFailQ = '';
      return changed ? 'located' : 'existing';
    }
    // 链接本身不含坐标（maps.app.goo.gl 等短链接）→ 服务端跟随重定向解析坐标，无需链接自带坐标
    if (s.mapUrl) {
      const r = await this.resolveMapUrl(s.mapUrl);
      if (r) {
        s.lat = r.lat; s.lng = r.lng;
        if (it.isCand) { const c = (app.state.candidates || []).find(x => x.id === it.spot.id); if (c) { c.lat = r.lat; c.lng = r.lng; } }
        s._geoFailed = false; s._geoFailQ = '';
        return 'located';
      }
    }
    // 无链接或链接无坐标：已有坐标则跳过，否则按名称/地址地理编码
    if (s.lat != null && s.lng != null) return 'existing';
    // 无链接 / 链接无坐标：按名称/地址地理编码（省 Credits 模式跳过，只显示已有/链接坐标的点）
    if (app.state.ecoMode) { if (!s._geoFailed) s._geoFailed = true; return 'failed-new'; }
    const q = [s.name, s.address].filter(Boolean).join(' ').trim();
    if (!q) { if (!s._geoFailed) s._geoFailed = true; return 'failed-new'; }
    if (s._geoFailed && s._geoFailQ === q) return 'skip-failed';
    const g = await this.geocodeCached(q);
    if (g) {
      s.lat = g.lat; s.lng = g.lng;
      if (it.isCand) { const c = (app.state.candidates || []).find(x => x.id === it.spot.id); if (c) { c.lat = g.lat; c.lng = g.lng; } }
      s._geoFailed = false; s._geoFailQ = '';
      return 'located';
    }
    s._geoFailed = true; s._geoFailQ = q;
    return 'failed-new';
  },

  /* 强制用「当前地图链接」的坐标覆盖旧坐标 / 地理编码坐标（点击地点上的「📍 用链接定位」按钮触发）。
     与 _resolveItemCoord 的区别：无视是否已存在坐标、无视「省 Credits」模式，只要链接能解析出坐标就【强制】覆盖。
     对应诉求：把原「全站刷新最新数据」按钮下放到每个地图地点，专门用来用新粘贴的地图链接坐标覆盖旧位置。 */
  async forceResolveFromLinkById(dayId, spotId, isCand) {
    let target = null;
    if (isCand) {
      const c = (app.state.candidates || []).find(x => x.id === spotId);
      if (!c) { if (app.toast) app.toast('未找到该地点', 'warning'); return; }
      target = c;
    } else {
      const d = app.getActiveDestination();
      if (!d) { if (app.toast) app.toast('请先选择目的地', 'warning'); return; }
      const day = (app.state[d.id]?.itinerary || []).find(x => x.id === dayId);
      const sp = day && (day.spots || []).find(x => x.id === spotId);
      if (!sp) { if (app.toast) app.toast('未找到该地点', 'warning'); return; }
      target = sp;
    }
    if (!target.mapUrl) { if (app.toast) app.toast('该地点还没有地图链接，无法重新定位', 'warning'); return; }
    let fromUrl = extractCoordsFromMapUrl(target.mapUrl);
    // 链接本身无坐标（短链接等）→ 服务端跟随重定向解析
    if (!fromUrl) fromUrl = await this.resolveMapUrl(target.mapUrl);
    if (!fromUrl) { if (app.toast) app.toast('无法从地图链接解析出坐标（短链接需联网解析，请检查链接是否指向某个地点）', 'warning'); return; }
    // 关闭当前可能打开的弹窗，避免指向即将被重建的旧 marker
    this.closeInfo();
    target.lat = fromUrl.lat; target.lng = fromUrl.lng;
    target._geoFailed = false; target._geoFailQ = '';
    app.saveState();
    this.rerender();
    if (app.toast) app.toast('已用地图链接坐标更新该地点位置', 'success');
  },

  /* 离线地理编码缓存：持久化到 localStorage，跨刷新/会话复用，进一步省 Google Geocoding 配额 */
  loadGeoCache() {
    this._geoLoaded = true;
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(this._geoCacheKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && d.cache && typeof d.cache === 'object') this._geoCache = d.cache;
      if (d && Array.isArray(d.fail)) this._geoFail = new Set(d.fail);
    } catch (e) {}
  },

  persistGeoCache() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this._geoCacheKey, JSON.stringify({ cache: this._geoCache, fail: Array.from(this._geoFail) }));
    } catch (e) {}
  },

  clearGeoCache() {
    this._geoCache = {};
    this._geoFail = new Set();
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(this._geoCacheKey); } catch (e) {}
    if (typeof app !== 'undefined' && app.toast) app.toast(app.t ? app.t('map.cacheCleared') : '已清除地理编码缓存', 'info');
  },

  /* 服务端解析地图链接坐标（短链接 maps.app.goo.gl 等，链接里没有 @lat,lng 时）。
     仅在后端模式下可用（依赖服务端 /api/resolve-map-url 跟随重定向）。结果按 URL 缓存到 localStorage，避免重复请求。 */
  async resolveMapUrl(url) {
    if (!app.backend || !app.backend.enabled || !url) return null;
    if (this._urlResolveCache === undefined) this.loadUrlResolveCache();
    if (this._urlResolveCache[url]) return this._urlResolveCache[url];
    if (this._urlResolveFail && this._urlResolveFail.has(url)) return null;
    try {
      const endpoint = (app.base() || '') + '/api/resolve-map-url?url=' + encodeURIComponent(url);
      const resp = await fetch(endpoint, { headers: app.sessionToken ? { Authorization: 'Bearer ' + app.sessionToken } : {} });
      const data = await resp.json();
      if (data && data.ok && data.lat != null && data.lng != null) {
        const r = { lat: Number(data.lat), lng: Number(data.lng) };
        if (!this._urlResolveCache) this._urlResolveCache = {};
        if (!this._urlResolveFail) this._urlResolveFail = new Set();
        this._urlResolveCache[url] = r; this.persistUrlResolveCache();
        return r;
      }
      if (!this._urlResolveFail) this._urlResolveFail = new Set();
      this._urlResolveFail.add(url); this.persistUrlResolveCache();
      return null;
    } catch (e) { return null; }
  },

  loadUrlResolveCache() {
    this._urlResolveCache = {}; this._urlResolveFail = new Set();
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(this._urlResolveKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && d.cache && typeof d.cache === 'object') this._urlResolveCache = d.cache;
      if (d && Array.isArray(d.fail)) this._urlResolveFail = new Set(d.fail);
    } catch (e) {}
  },

  persistUrlResolveCache() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this._urlResolveKey, JSON.stringify({ cache: this._urlResolveCache || {}, fail: Array.from(this._urlResolveFail || []) }));
    } catch (e) {}
  },

  async showMap() {
    const mode = this._sel();
    const items = this.collectSpots(mode);
    const drawItems = items.filter(it => !it.hidden); // 隐藏的地点不绘制（仅在开启「显示已隐藏」时列在列表中供取消隐藏）
    if (!gmapsKey() || this._failed || typeof window === 'undefined' || !window.google || !window.google.maps) {
      const located = drawItems.filter(it => it.spot.lat != null && it.spot.lng != null);
      this.renderList(items, located, mode);
      this._renderLegend(drawItems, mode);
      if (!gmapsKey()) this._noteNeedKey();
      else if (this._failed) this._noteMapFallback();
      return;
    }
    // 坐标定位（优先用已填地图链接里解析出的坐标，按名称地理编码作为兜底）：
    //   - 有坐标 → 跳过；
    //   - 有地图链接且能解析出坐标 → 直接用链接坐标（免费、最准，且不按名称定位，避免同名地点错位）；
    //   - 否则仅在非「省 Credits」模式下按名称/地址做 Google 地理编码。
    let needSave = false;
    for (const it of drawItems) {
      const st = await this._resolveItemCoord(it);
      if (st === 'located' || st === 'failed-new') needSave = true;
    }
    if (needSave) app.saveState();
    const withCoord = drawItems.filter(it => it.spot.lat != null && it.spot.lng != null);
    this.renderList(items, withCoord, mode);
    await this.drawMap(withCoord, mode);
    this._renderLegend(drawItems, mode);
  },

  /* 取色：全部日期按「第几天」，单日按「地点类别」 */
  _colorForItem(it, mode) {
    if (mode === '__all') return DAY_COLORS[it.dayIndex % DAY_COLORS.length];
    return MAP_COLORS[it.spot.type] || MAP_COLORS.other;
  },

  _renderLegend(items, mode) {
    const el = document.getElementById('mapLegend');
    if (!el) return;
    if (mode === '__all') {
      // 按 dayIndex 去重，列出有行程的每天
      const seen = new Set();
      const days = [];
      items.forEach(it => { if (!seen.has(it.dayIndex)) { seen.add(it.dayIndex); days.push(it); } });
      el.innerHTML = days.map(it =>
        `<span class="inline-flex items-center gap-1"><span style="width:12px;height:12px;border-radius:3px;background:${this._colorForItem(it, mode)};display:inline-block"></span>Day ${it.dayIndex + 1}</span>`
      ).join('');
    } else {
      // 单日：列出地点类别
      el.innerHTML = Object.keys(CATEGORY_LABELS).map(k =>
        `<span class="inline-flex items-center gap-1"><span style="width:12px;height:12px;border-radius:3px;background:${MAP_COLORS[k]};display:inline-block"></span>${CATEGORY_LABELS[k]}</span>`
      ).join('');
    }
  },

  _pin(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">` +
      `<path fill="${color}" stroke="#ffffff" stroke-width="1.5" d="M12 0C5.4 0 0 5.4 0 12c0 8 12 24 12 24s12-16 12-24c0-6.6-5.4-12-12-12z"/>` +
      `<circle cx="12" cy="12" r="5" fill="#ffffff"/></svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  },

  async drawMap(withCoord, mode) {
    const view = document.getElementById('mapView');
    if (!view) return;
    this._map = null;
    const gm = window.google.maps;
    const center = withCoord.length ? { lat: parseFloat(withCoord[0].spot.lat), lng: parseFloat(withCoord[0].spot.lng) } : { lat: 25.033, lng: 121.565 };
    // 可选 Map ID（GMAPS_MAP_ID）：设置后地图改用矢量地图 + AdvancedMarkerElement，
    // 彻底消除 google.maps.Marker 的弃用告警；未设置则不传 mapId，回退经典 Marker
    // （仍可用、暂无停用计划，仅控制台有弃用提示）。
    const gmapsMapId = (typeof window !== 'undefined' && window.BOARD_CONFIG && window.BOARD_CONFIG.gmapsMapId) || '';
    let AdvMarker = null;
    if (gmapsMapId && typeof gm.importLibrary === 'function') {
      try { const lib = await gm.importLibrary('marker'); AdvMarker = lib.AdvancedMarkerElement || null; } catch (e) { AdvMarker = null; }
    }
    const useAdvanced = !!(gmapsMapId && AdvMarker);
    const mapOpts = { center, zoom: 12, mapTypeControl: true, streetViewControl: true };
    if (gmapsMapId) mapOpts.mapId = gmapsMapId;
    const map = new gm.Map(view, mapOpts);
    const bounds = new gm.LatLngBounds();
    withCoord.forEach(it => {
      const s = it.spot;
      const pos = { lat: parseFloat(s.lat), lng: parseFloat(s.lng) };
      const color = this._colorForItem(it, mode);
      let marker;
      if (useAdvanced) {
        marker = new AdvMarker({ position: pos, map, title: s.name || '地点', content: this._pinEl(color) });
      } else {
        marker = new gm.Marker({ position: pos, map, title: s.name || '地点', icon: this._pin(color) });
      }
      const dayPrefix = (mode === '__all' && it.dayIndex >= 0) ? ('Day ' + (it.dayIndex + 1) + ' ') : '';
      const dtText = it.isCand ? '（未加入行程）' : [it.date, s.startTime].filter(Boolean).join(' ');
      const detailCall = `app.modules.itinerary.openTripForm('${it.isCand ? 'cand' : 'spot'}','${it.isCand ? it.spot.id : it.dayId}','${it.spot.id}')`;
      const reLinkCall = s.mapUrl ? `app.modules.map.forceResolveFromLinkById('${it.dayId}','${it.spot.id}',${it.isCand})` : '';
      const content = `<div style="min-width:190px;max-width:240px">` +
        `<strong>${this._esc(s.name)}</strong>` +
        `<div style="font-size:.72rem;color:#64748b;margin-top:2px">${dayPrefix}${this._esc(dtText)}</div>` +
        `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">` +
          `<button class="btn btn-ghost btn-sm" onclick="${detailCall}">📝 行程详情</button>` +
          (reLinkCall ? `<button class="btn btn-ghost btn-sm" onclick="${reLinkCall}">📍 用链接定位</button>` : '') +
          `<button class="btn btn-ghost btn-sm" onclick="app.modules.map.toggleHidden('${it.dayId}','${it.spot.id}',${it.isCand});app.modules.map.closeInfo()">${it.hidden ? '👁 显示' : '🙈 隐藏'}</button>` +
        `</div>` +
        (this._mapsUrl(s) ? `<div style="margin-top:6px"><a href="${this._mapsUrl(s)}" target="_blank" rel="noopener" class="text-sky-600 hover:underline" style="font-size:.72rem">🔗 在 Google Maps 打开</a></div>` : '') +
        `</div>`;
      const info = new gm.InfoWindow({ content });
      this._lastInfo = info;
      if (useAdvanced) marker.addEventListener('click', () => info.open({ anchor: marker, map }));
      else marker.addListener('click', () => info.open(map, marker));
      bounds.extend(pos);
    });
    if (withCoord.length > 1) { map.fitBounds(bounds); this._lastBounds = bounds; }
    this._map = map;
  },

  // AdvancedMarkerElement 用 HTML 元素作为图钉内容（经典 Marker 的 icon(data URI) 不适用）
  _pinEl(color) {
    const el = document.createElement('div');
    el.style.width = '24px';
    el.style.height = '36px';
    el.style.cursor = 'pointer';
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">' +
      '<path fill="' + color + '" stroke="#ffffff" stroke-width="1.5" d="M12 0C5.4 0 0 5.4 0 12c0 8 12 24 12 24s12-16 12-24c0-6.6-5.4-12-12-12z"/>' +
      '<circle cx="12" cy="12" r="5" fill="#ffffff"/></svg>';
    return el;
  },

  renderList(items, withCoord, mode) {
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
      const color = this._colorForItem(it, mode);
      const url = this._mapsUrl(s);
      const dayTag = (mode === '__all' && it.dayIndex >= 0) ? `<span class="text-tiny text-slate-400">Day ${it.dayIndex + 1} · </span>` : '';
      const detailCall = `app.modules.itinerary.openTripForm('${it.isCand ? 'cand' : 'spot'}','${it.isCand ? it.spot.id : it.dayId}','${it.spot.id}')`;
      const nameHtml = `<span class="text-sm font-semibold truncate text-slate-800 hover:text-sky-700 hover:underline cursor-pointer" onclick="${detailCall}" title="点击打开行程详情">${this._esc(s.name || '未命名')}</span>`;
      const linkBtn = url ? ` <a href="${url}" target="_blank" rel="noopener" class="text-tiny text-sky-600 hover:underline" title="在 Google Maps 打开">🔗</a>` : '';
      // 仅在「既没坐标、也没有地图链接」时提示未定位；已有链接的地点不再显示多余说明
      const hint = (!located && !s.mapUrl)
        ? `<div class="text-tiny text-amber-600 truncate">${app.t('map.unlocated')}</div>`
        : '';
      // 仅地图范围内隐藏/显示：不影响行程库与时间轴
      const reLinkBtn = s.mapUrl
        ? `<button class="btn btn-ghost btn-sm shrink-0" onclick="app.modules.map.forceResolveFromLinkById('${it.dayId}','${it.spot.id}',${it.isCand})" title="用该地点地图链接的坐标覆盖当前位置">📍 用链接定位</button>`
        : '';
      const hideBtn = it.hidden
        ? `<button class="btn btn-ghost btn-sm shrink-0" onclick="app.modules.map.toggleHidden('${it.dayId}','${it.spot.id}',${it.isCand})">👁 显示</button>`
        : `<button class="btn btn-ghost btn-sm shrink-0" onclick="app.modules.map.toggleHidden('${it.dayId}','${it.spot.id}',${it.isCand})">🙈 隐藏</button>`;
      return `<div class="p-2 rounded border ${it.hidden ? 'border-slate-300 bg-slate-50' : 'border-slate-200'} flex items-start gap-2 ${located ? '' : 'opacity-60'}">
        <span style="width:10px;height:10px;border-radius:999px;background:${color};margin-top:5px;flex:none"></span>
        <div class="min-w-0 flex-1">
          <div class="truncate">${dayTag}${nameHtml}${linkBtn} <span class="text-tiny text-slate-400">${s.startTime || ''}</span></div>
          ${hint}
        </div>
        <div class="flex flex-col gap-1 items-end shrink-0">
          ${reLinkBtn}
          ${hideBtn}
        </div>
      </div>`;
    }).join('') + `</div>`;
  },

  _noteNeedKey() {
    const view = document.getElementById('mapView');
    if (view) view.innerHTML = '<div class="map-fallback">' + app.t('map.needKey') + '</div>';
  },

  _noteMapFallback() {
    const view = document.getElementById('mapView');
    if (view) view.innerHTML = '<div class="map-fallback">' + app.t('map.fallback') + '</div>';
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
