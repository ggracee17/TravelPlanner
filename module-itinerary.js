/* ============================================================
   板块2：每日行程表（时间轴 · 可拖拽版本）
   每天 = 一条时间轴（默认只显示有行程的部分，可展开 06:00–24:00），
   行程以"块"形式落在时间上。各天<strong>横向排列</strong>，可左右滚动。
   每个块按分类着色：餐饮(红) / 酒店(紫) / 景点(蓝) / 交通(青) / 购物(橙) / 娱乐(靛) / 拍照(青绿) / 甜品(品红) / 小吃(橙) / 活动(绿) / 其他(灰)。
   块上显示 名称 + 时间段；拖动块可改时间或跨日移动（对齐线落在块的<strong>开始</strong>时间）；
   点块编辑详情（门票 / 是否需预约 / 建议时长 / 地址 / 营业时间 / 地图 / 图片 / 备注）。
   行程块与「板块5·行程库」共用同一编辑表单，双方改动<strong>双向同步</strong>。
   ============================================================ */

/* ===== 时间轴常量 & 工具（全局，供内联 ondrop 等调用） ===== */
const ITIN_TL_START = 6;     // 时间轴起点 06:00
const ITIN_TL_END = 24;      // 时间轴终点 24:00

function itinHourPx() {
  const z = (typeof app !== 'undefined' && app.state && app.state.itineraryZoom) || 'normal';
  return z === 'compact' ? 30 : 48;
}

const ITIN_TYPES = {
  restaurant: { label: '餐饮', cls: 'blk-restaurant' },
  hotel:      { label: '酒店', cls: 'blk-hotel' },
  spot:       { label: '景点', cls: 'blk-spot' },
  transport:  { label: '交通', cls: 'blk-transport' },
  shopping:   { label: '购物', cls: 'blk-shopping' },
  entertainment: { label: '娱乐', cls: 'blk-entertainment' },
  photo:      { label: '拍照', cls: 'blk-photo' },
  dessert:    { label: '甜品', cls: 'blk-dessert' },
  snack:      { label: '小吃', cls: 'blk-snack' },
  activity:   { label: '活动', cls: 'blk-activity' },
  other:      { label: '其他', cls: 'blk-other' }
};

// 行程库(中文类型) ↔ 行程块(英文 key) 映射
const ITIN_KEY_TO_CN = { restaurant: '餐饮', spot: '景点', hotel: '住宿', transport: '交通', shopping: '购物', entertainment: '娱乐', photo: '拍照', dessert: '甜品', snack: '小吃', activity: '活动', other: '其他' };

/* 从 Google Maps 链接里离线解析经纬度（零 credits，不调 API）。
   支持的格式：
     - .../@LAT,LNG,Z            （@ 后逗号分隔前两个浮点）
     - ...!3dLAT!4dLNG           （编码坐标）
     - ...?q=LAT,LNG             （q= 后逗号分隔）
   解析不到（名称搜索 / maps.app.goo.gl 短链等）返回 null。 */
function extractCoordsFromMapUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let m;
  // 1) @lat,lng,z
  m = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // 2) !3dLAT!4dLNG（顺序可能互换，各取其一）
  const d3 = url.match(/!3d(-?\d+(?:\.\d+)?)/);
  const d4 = url.match(/!4d(-?\d+(?:\.\d+)?)/);
  if (d3 && d4) return { lat: parseFloat(d3[1]), lng: parseFloat(d4[1]) };
  // 3) ?q=lat,lng 或 ?query=lat,lng（Maps URL API 两种写法）
  m = url.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}
const CN_TO_ITIN_KEY = { '餐饮': 'restaurant', '景点': 'spot', '住宿': 'hotel', '交通': 'transport', '购物': 'shopping', '娱乐': 'entertainment', '拍照': 'photo', '甜品': 'dessert', '小吃': 'snack', '活动': 'activity', '其他': 'other' };

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
function itinWeekdayLabel(dateStr) {
  if (!dateStr || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d); // 用本地时间构造，避免 UTC 偏移导致错位
  if (isNaN(dt.getTime())) return '';
  return '周' + '日一二三四五六'[dt.getDay()];
}
function itinWeekdayIndex(dateStr) {
  if (!dateStr || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return null;
  return dt.getDay(); // 0=周日 … 6=周六
}
// 日期显示：紧凑视图下隐藏年份，仅显示 月-日（如 08-09）；普通视图显示完整 YYYY-MM-DD
function itinDateLabel(dateStr) {
  if (!dateStr) return '未填日期';
  const compact = (typeof app !== 'undefined' && app.state && app.state.itineraryZoom) === 'compact';
  if (compact) {
    const p = String(dateStr).split('-');
    if (p.length === 3) return p[1] + '-' + p[2];
  }
  return dateStr;
}

app.modules.itinerary = {

  render() {
    const sec = document.querySelector('[data-section=itinerary]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">${app.t('itinerary.title')}</div>
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
    const expanded = !!app.state.itineraryExpand;
    const travMode = app.state.itineraryTravelMode || 'transit';

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>${app.t('itinerary.title')}</span>
          <div class="ml-auto flex gap-2 items-center">
            <label class="text-sm text-slate-600 whitespace-nowrap">${app.t('itinerary.travelMode')}</label>
            <select id="itinTravelMode" class="text-sm border border-slate-300 rounded px-2 py-1" onchange="app.modules.itinerary.setTravelMode(this.value)">
              <option value="driving" ${travMode === 'driving' ? 'selected' : ''}>🚗 ${app.t('itinerary.driving')}</option>
              <option value="walking" ${travMode === 'walking' ? 'selected' : ''}>🚶 ${app.t('itinerary.walking')}</option>
              <option value="transit" ${travMode === 'transit' ? 'selected' : ''}>🚌 ${app.t('itinerary.transit')}</option>
              <option value="bicycling" ${travMode === 'bicycling' ? 'selected' : ''}>🚲 ${app.t('itinerary.bicycling')}</option>
            </select>
            <button class="btn btn-primary" onclick="app.modules.itinerary.computeTravelAll()" title="按顶部所选交通方式，重新计算所有天的相邻行程点交通时间">${app.t('itinerary.recalc')}</button>
            <button class="btn btn-ghost" onclick="app.modules.itinerary.clearTravelAll()" title="清除当前目的地所有天的相邻交通时间（设为待重算，可再次点「重新计算」）">🧹 清除交通时间</button>
            <button class="btn ${app.state.ecoMode ? 'btn-warning' : 'btn-ghost'}" onclick="app.modules.itinerary.toggleEco()" title="开启后暂停「交通距离计算」与「地图自动地理编码」两类 Google API 调用，省 credits">💡 ${app.t('itinerary.ecoLabel')}：${app.state.ecoMode ? app.t('on') : app.t('off')}</button>
            <button class="btn btn-ghost" onclick="app.modules.itinerary.toggleZoom()">${app.state.itineraryZoom === 'compact' ? '🔍 ' + app.t('itinerary.zoomLoose') : '🔍 ' + app.t('itinerary.zoomCompact')}</button>
            <button class="btn btn-ghost" onclick="app.modules.itinerary.toggleExpand()">${expanded ? '🔼 ' + app.t('itinerary.collapse') : '🔽 ' + app.t('itinerary.expand')}</button>
            <button class="btn btn-warning" onclick="app.modules.itinerary.autoGenDays()">${app.t('itinerary.autoGen')}</button>
            <button class="btn btn-primary" onclick="app.modules.itinerary.addDay()">${app.t('itinerary.addDay')}</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          当前目的地：<strong class="text-sky-700">${app.destName(d)}</strong>　·　共 <strong>${app.dateDiff(d.startDate, d.endDate)}</strong> 天　·　已规划 <strong>${days.length}</strong> 天。
          下方为<strong>横向时间轴</strong>：每天一条时间轴，各天并排可左右滚动；每个行程块按分类着色
          （餐饮红 / 酒店紫 / 景点蓝 / 交通青 / 购物橙 / 娱乐靛 / 拍照青绿 / 甜品品红 / 小吃橙 / 活动绿 / 其他灰），<strong>拖动块</strong>即可改时间或换到别的日期
          （对齐线落在块的<strong>开始时间</strong>处）。时间轴默认只显示有行程的时段，点「🔽 展开全部时间」查看完整 06:00–24:00。
        </p>

        ${days.length === 0 ? `
          <div class="empty-state">
            <div class="icon">📅</div>
            <h3>该目的地还没有每日行程</h3>
            <p class="text-sm">点击右上角「⚡ 按日期自动生成空白日程」一键按起止日期生成全部空日程，再拖入行程块</p>
          </div>
        ` : `
          <div class="itinerary-rows ${app.state.itineraryZoom === 'compact' ? 'compact' : ''}">
            ${days.map((day, idx) => this.renderDayColumn(day, idx, d, expanded)).join('')}
          </div>
        `}
      </div>`;
  },

  toggleZoom() {
    app.state.itineraryZoom = app.state.itineraryZoom === 'compact' ? 'normal' : 'compact';
    app.saveState();
    this.render();
  },

  toggleExpand() {
    app.state.itineraryExpand = !app.state.itineraryExpand;
    app.saveState();
    this.render();
  },

  /* 时间轴固定显示 06:00–24:00：每天等长，且早于 6 点的行程不画在行程表上（保持各天长度一致）。
     注：此前为支持凌晨行程曾允许窗口起点 < 6，现已按需求改回固定窗口。 */
  dayWindow(day, expanded) {
    return { start: ITIN_TL_START, end: ITIN_TL_END };
  },

  renderDayColumn(day, idx, dest, expanded) {
    this.normalizeDay(day);
    const win = this.dayWindow(day, expanded);
    const hpx = itinHourPx();
    const allSpots = day.spots || [];
    // 不再过滤 6 点前的行程：清晨航班 / 日出 / 深夜抵达等活动照常画在行程表（仅在时间轴顶部对齐），避免「已加入却看不到」
    const spots = allSpots;
    const laneMap = this.computeLanes(spots);
    const totalTicket = spots.reduce((s, x) => s + (parseFloat(x.ticket) || 0), 0);
    const hours = [];
    for (let h = win.start; h < win.end; h++) hours.push(h);
    const tlHeight = (win.end - win.start) * hpx;

    return `
      <div class="day-card">
        <div class="day-card-header">
          <div>
            <div class="text-lg font-bold">Day ${idx + 1} · ${itinDateLabel(day.date)}${day.date ? ` <span class="day-weekday">${itinWeekdayLabel(day.date)}</span>` : ''}</div>
            <div class="text-xs opacity-90">${day.weather || '天气未填'}　·　行程块 ${spots.length} 个　·　门票 ¥${totalTicket.toFixed(0)}</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="app.modules.itinerary.computeTravel('${day.id}')" title="用 Google 计算相邻行程点之间的交通时间（按顶部所选交通方式）">${app.t('itinerary.travelTime')}</button>
            <button class="btn btn-primary btn-sm" onclick="app.modules.itinerary.openTripForm('spot','${day.id}','')">${app.t('itinerary.addSpot')}</button>
            <button class="btn btn-ghost btn-sm" onclick="app.modules.itinerary.editDay('${day.id}')">✏️ 日期</button>
            <button class="btn btn-danger btn-sm" onclick="app.modules.itinerary.removeDay('${day.id}')">🗑️</button>
          </div>
        </div>
        <div class="day-card-body">
          ${day.hotel?.name || day.dining ? `
            <div class="day-legacy mb-2">
              ${day.hotel?.name ? `🏨 <strong>${day.hotel.name}</strong>` : ''}
              ${day.dining ? `<span class="ml-2">🍽️ ${day.dining}</span>` : ''}
            </div>` : ''}
          <div class="timeline" data-day-id="${day.id}" data-win-start="${win.start}" data-win-end="${win.end}" style="height:${tlHeight}px; --tl-hour:${hpx}px"
               ondragover="app.modules.itinerary.onDragOver(event)"
               ondrop="app.modules.itinerary.onDrop(event)"
               ondragleave="app.modules.itinerary.onDragLeave(event)">
            <div class="tl-hours">${hours.map(h => `<div class="tl-hour"><span class="tl-label">${h}:00</span></div>`).join('')}</div>
            ${spots.map(s => this.renderBlock(s, day, win, laneMap[s.id])).join('')}
          </div>
          ${spots.length === 0 ? '<p class="text-xs text-slate-400 mt-2 text-center">勾选「板块5·行程库」加入，或点「➕ 添加」，再拖到合适时间</p>' : ''}
        </div>
      </div>`;
  },

  /* ===== 单个行程块 ===== */
  renderBlock(s, day, win, laneInfo) {
    const meta = ITIN_TYPES[s.type] || ITIN_TYPES.other;
    const hpx = itinHourPx();
    const span = win.end - win.start;
    let top = (itinTimeToNum(s.startTime) - win.start) * hpx;
    top = Math.max(0, Math.min(top, span * hpx - hpx));
    let h = Math.max(parseFloat(s.durationH) || 1, 0.5) * hpx;
    h = Math.min(h, span * hpx - top);
    const dispH = Math.max(h, 26);
    const isShort = dispH < 50;    // < ~1 小时：隐藏标签，缩小字号
    const isXShort = dispH < 30;   // < ~0.5 小时：连时间也隐藏，只留名称
    const dur = parseFloat(s.durationH) || 1;
    // 重叠分栏：同一时间簇内的块按 lane 左右排列，互不重叠；不重叠的保持整宽
    const lane = laneInfo ? laneInfo.lane : 0;
    const lanes = laneInfo ? laneInfo.lanes : 1;
    const LP = 52, RP = 8, GAP = 4;
    const leftStyle = `calc(${LP}px + (100% - ${LP + RP}px) * ${lane} / ${lanes})`;
    const widthStyle = `calc((100% - ${LP + RP}px) / ${lanes} - ${GAP}px)`;
    // 开始时间不在营业时间内的提示（按当天星期取对应的每日营业时间）
    const wd = itinWeekdayIndex(day.date);
    const timeWarn = this.outsideHours(s.startTime, dur, this.effectiveHours(s, wd));
    const closedWarn = (wd != null && Array.isArray(s.closedDays) && s.closedDays.includes(wd)) ? `今日为固定休息日（${itinWeekdayLabel(day.date)}）` : '';
    const warn = timeWarn || closedWarn;
    let flags = '';
    if (!isShort) {
      if (s.reservation === 'needed') flags += '<span class="tl-flag">需预约</span>';
      else if (s.reservation === 'booked') flags += '<span class="tl-flag">已预约</span>';
      if (s.ticket > 0) flags += `<span class="tl-flag tl-flag-ticket">¥${s.ticket}</span>`;
      if (timeWarn) flags += `<span class="tl-flag tl-flag-warn" title="${timeWarn}">⚠️ 非营业</span>`;
      if (closedWarn) flags += `<span class="tl-flag tl-flag-warn" title="${closedWarn}">⚠️ 今日休</span>`;
    }
    const cls = `tl-block ${meta.cls}${isShort ? ' tl-short' : ''}${isXShort ? ' tl-xshort' : ''}`;
    const title = `点击编辑 · 拖动改时间${warn ? ' · ' + warn : ''}`;
    return `
      <div class="${cls}" draggable="true"
           style="top:${top}px;height:${dispH}px;left:${leftStyle};width:${widthStyle};right:auto"
           data-day-id="${day.id}" data-spot-id="${s.id}" data-start="${s.startTime}"
           ondragstart="app.modules.itinerary.onDragStart(event)"
           ondragend="app.modules.itinerary.onDragEnd(event)"
           onclick="app.modules.itinerary.openTripForm('spot','${day.id}','${s.id}')"
           title="${title}">
        <div class="tl-block-cat-v">${meta.label}</div>
      <div class="tl-block-main">
        ${!isXShort && s.travelFromPrev ? `<div class="tl-travel">${this.travelIcon(s.travelFromPrev.mode)} ${s.travelFromPrev.durText}${s.travelFromPrev.distText ? ' · ' + s.travelFromPrev.distText : ''}${s.travelFromPrev.unavailable ? '（无法计算）' : '　距上一站'}</div>` : ''}
        <div class="tl-block-title">${s.name || '未命名'}</div>
        ${isXShort ? '' : `<div class="tl-block-time">${s.startTime || '--:--'}–${s.endTime || itinEndTime(s.startTime, dur)} · ${dur}h</div>`}
        ${flags ? `<div class="tl-flags">${flags}</div>` : ''}
      </div>
      </div>`;
  },

  /* 计算各行程块的左右分栏（lane）：把重叠的时间段聚成簇，簇内贪心分配列。
     返回 { spotId: { lane, lanes } }，lanes 为该簇总列数。 */
  computeLanes(spots) {
    const arr = (spots || []).slice().sort((a, b) =>
      itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime) || (a.id < b.id ? -1 : 1));
    const result = {};
    const used = new Set();
    const overlap = (c, o) => {
      const cs = itinTimeToNum(c.startTime), ce = cs + (parseFloat(c.durationH) || 1);
      const os = itinTimeToNum(o.startTime), oe = os + (parseFloat(o.durationH) || 1);
      return os < ce - 1e-9 && cs < oe - 1e-9;
    };
    for (let i = 0; i < arr.length; i++) {
      if (used.has(arr[i].id)) continue;
      const cluster = [];
      const stack = [arr[i]];
      used.add(arr[i].id);
      while (stack.length) {
        const cur = stack.pop();
        cluster.push(cur);
        for (let j = 0; j < arr.length; j++) {
          const o = arr[j];
          if (used.has(o.id)) continue;
          if (overlap(cur, o)) { used.add(o.id); stack.push(o); }
        }
      }
      cluster.sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
      const lanesEnd = []; // 每列当前的结束时间
      cluster.forEach(c => {
        const st = itinTimeToNum(c.startTime);
        const en = st + (parseFloat(c.durationH) || 1);
        let li = lanesEnd.findIndex(e => e <= st + 1e-6);
        if (li === -1) { li = lanesEnd.length; lanesEnd.push(en); }
        else lanesEnd[li] = en;
        c._lane = li;
      });
      const lanes = lanesEnd.length;
      cluster.forEach(c => { result[c.id] = { lane: c._lane, lanes }; });
    }
    return result;
  },

  /* 判断行程开始/结束时间是否落在营业时间之外；支持多段。返回提示文案或 null */
  outsideHours(start, dur, hours) {
    const segs = Array.isArray(hours) ? hours : this.parseLegacyHours(hours || '');
    if (!segs || !segs.length) return null;
    const st = itinTimeToNum(start), en = st + (parseFloat(dur) || 1);
    const inAny = segs.some(g => {
      const o = itinTimeToNum(g.open), cRaw = itinTimeToNum(g.close);
      // 00:00 表示营业到午夜，需视为 24:00（cRaw<=o 说明跨越午夜，整段 +24）
      const c = cRaw <= o + 1e-6 ? cRaw + 24 : cRaw;
      return st >= o - 1e-6 && en <= c + 1e-6;
    });
    if (inAny) return null;
    const rangeText = segs.map(g => `${g.open}–${g.close}`).join(' / ');
    return `营业时间 ${rangeText}，当前安排 ${itinNumToTime(st)}–${itinNumToTime(en)}`;
  },

  /* ===== 拖拽：改时间 / 跨日 ===== */
  _drag: null,

  onDragStart(e) {
    const el = e.target.closest && e.target.closest('[data-spot-id]');
    if (!el) return;
    const d = app.getActiveDestination();
    if (!d) return;
    const day = (app.state[d.id]?.itinerary || []).find(x => x.id === el.dataset.dayId);
    const sp = day ? (day.spots || []).find(s => s.id === el.dataset.spotId) : null;
    this._drag = {
      spotId: el.dataset.spotId,
      fromDayId: el.dataset.dayId,
      durH: sp ? sp.durationH : 1,
      type: sp ? sp.type : 'spot'
    };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', this._drag.spotId); } catch (_) {}
    // 隐藏原生拖拽影像，改用「幽灵块 + 对齐线」显示落点，使拖动的模块与对齐线齐平
    try {
      const blank = new Image();
      blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(blank, 0, 0);
    } catch (_) {}

    // 拖拽时展开所有时间轴，便于看到全部可放置区域（按各天真实窗口，含早于 06:00 的行程）
    const hpx = itinHourPx();
    const allDays = app.state[d.id]?.itinerary || [];
    document.querySelectorAll('[data-section=itinerary] .timeline').forEach(tl => {
      const day = allDays.find(x => x.id === tl.dataset.dayId);
      const win = day ? this.dayWindow(day, true) : { start: ITIN_TL_START, end: ITIN_TL_END };
      const ws = win.start, we = win.end;
      tl.dataset.winStart = ws; tl.dataset.winEnd = we;
      tl.style.height = ((we - ws) * hpx) + 'px';
      const hb = tl.querySelector('.tl-hours');
      if (hb) {
        let hh = '';
        for (let i = ws; i < we; i++) hh += `<div class="tl-hour"><span class="tl-label">${i}:00</span></div>`;
        hb.innerHTML = hh;
      }
      tl.querySelectorAll('.tl-block').forEach(b => {
        const st = itinTimeToNum(b.dataset.start);
        b.style.top = ((st - ws) * hpx) + 'px';
      });
    });
  },

  onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tl = e.currentTarget;
    const ws = parseFloat(tl.dataset.winStart), we = parseFloat(tl.dataset.winEnd);
    const hpx = itinHourPx();
    const rect = tl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let hour = itinSnap(ws + y / hpx);
    hour = Math.max(ws, Math.min(we - 0.5, hour));

    // 只保留当前时间轴上的指示，其余隐藏
    document.querySelectorAll('.tl-drop-line, .tl-drop-ghost').forEach(el => {
      if (el.closest('.timeline') !== tl) el.remove();
    });

    let line = tl.querySelector('.tl-drop-line');
    if (!line) { line = document.createElement('div'); line.className = 'tl-drop-line'; tl.appendChild(line); }
    line.style.top = ((hour - ws) * hpx) + 'px';
    line.style.display = 'block';

    // 半透明"幽灵块"展示落点整段（对齐线落在块的开始时间）
    const dur = this._drag ? (parseFloat(this._drag.durH) || 1) : 1;
    let ghost = tl.querySelector('.tl-drop-ghost');
    if (!ghost) { ghost = document.createElement('div'); ghost.className = 'tl-drop-ghost'; tl.appendChild(ghost); }
    ghost.style.display = 'block';
    ghost.style.top = ((hour - ws) * hpx) + 'px';
    ghost.style.height = Math.max(dur * hpx, 26) + 'px';
  },

  onDragLeave(e) {
    const tl = e.currentTarget;
    if (e.relatedTarget && tl.contains(e.relatedTarget)) return;
    const l = tl.querySelector('.tl-drop-line'); if (l) l.style.display = 'none';
    const g = tl.querySelector('.tl-drop-ghost'); if (g) g.remove();
  },

  onDrop(e) {
    e.preventDefault();
    const tl = e.currentTarget;
    const line = tl.querySelector('.tl-drop-line'); if (line) line.style.display = 'none';
    const ghost = tl.querySelector('.tl-drop-ghost'); if (ghost) ghost.remove();
    const from = this._drag;
    if (!from) return;
    const ws = parseFloat(tl.dataset.winStart), we = parseFloat(tl.dataset.winEnd);
    const hpx = itinHourPx();
    const rect = tl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let hour = itinSnap(ws + y / hpx);
    hour = Math.max(ws, Math.min(we - 0.5, hour));
    this.moveSpotToTime(from.spotId, tl.dataset.dayId, itinNumToTime(hour));
    this._drag = null;
  },

  onDragEnd(e) {
    const el = e.target.closest && e.target.closest('[data-spot-id]');
    if (el) el.classList.remove('dragging');
    if (this._drag) { app.renderAll(); } // 拖拽被取消（未成功 drop），恢复折叠视图
    this._drag = null;
    document.querySelectorAll('.tl-drop-line').forEach(l => l.style.display = 'none');
    document.querySelectorAll('.tl-drop-ghost').forEach(g => g.remove());
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
    // 拖动时让开始、结束时间一起平移，时长(durationH)保持不变
    const durH = parseFloat(found.durationH) || 1;
    found.endTime = itinNumToTime(itinTimeToNum(newStart) + durH);
    toDay.spots.push(found);
    toDay.spots.sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
    // 移动后相邻段交通时间已失效：配置了 API Key 且未开「省 Credits」则自动重算；
    // 无 Key 则清除待手动重算；开了省 Credits 则保留原值静默跳过——
    // 拖动是高频操作，此处不再弹「已暂停计算」提示（与 saveTrip 的处理保持一致）。
    const travelKey = (typeof window !== 'undefined' && window.BOARD_CONFIG && window.BOARD_CONFIG.gmapsApiKey) || '';
    if (travelKey && !app.state.ecoMode) {
      this.computeTravel(fromDay.id);
      if (toDay.id !== fromDay.id) this.computeTravel(toDay.id);
    } else if (!travelKey) {
      this.clearTravelForDay(fromDay.id);
      this.clearTravelForDay(toDay.id);
    }
    app.saveState();
    app.renderAll();
    app.toast('已调整行程时间', 'success');
  },

  /* ===== 相邻行程点交通时间（Google Distance Matrix） ===== */
  travelIcon(mode) {
    return ({ driving: '🚗', walking: '🚶', transit: '🚌', bicycling: '🚲' })[mode] || '🚗';
  },

  setTravelMode(mode) {
    app.state.itineraryTravelMode = mode;
    app.saveState();
    const label = this.travelIcon(mode) + ({ driving: '驾车', walking: '步行', transit: '公交/地铁', bicycling: '骑行' })[mode] || mode;
    app.toast('交通方式已设为 ' + label + '，点每天的「🚗 交通时间」重新计算', 'info');
  },

  /* 省 Credits 开关：开启后暂停「交通距离计算(Distance Matrix)」+「地图自动地理编码(Geocoding)」两类按次计费 API 调用。
     状态存进看板(随 SSE 同步、持久化)。computeTravel / showMap 会读取此开关提前返回。 */
  toggleEco() {
    app.state.ecoMode = !app.state.ecoMode;
    app.saveState();
    app.renderAll();
    app.toast(app.state.ecoMode ? '💡 省 Credits 模式已开启：暂停交通距离与地图地理编码 API 调用' : '省 Credits 模式已关闭：恢复交通距离与地图地理编码', app.state.ecoMode ? 'warning' : 'success');
  },

  clearTravelForDay(dayId) {
    const d = app.getActiveDestination();
    if (!d) return;
    const day = (app.state[d.id]?.itinerary || []).find(x => x.id === dayId);
    if (!day || !day.spots) return;
    day.spots.forEach(s => { s.travelFromPrev = null; });
  },

  _clearTravelAllDays() {
    const d = app.getActiveDestination();
    if (!d) return;
    (app.state[d.id]?.itinerary || []).forEach(day => { if (day.spots) day.spots.forEach(s => { s.travelFromPrev = null; }); });
  },

  /* 清除当前目的地下所有天的相邻交通时间（设为待重算） */
  clearTravelAll() {
    const d = app.getActiveDestination();
    if (!d) return;
    if (!confirm('确定清除当前目的地所有天的交通时间？（之后可点「重新计算全部交通时间」再算）')) return;
    this._clearTravelAllDays();
    app.saveState();
    app.renderAll();
    app.toast('已清除全部交通时间', 'success');
  },

  computeTravel(dayId, silent) {
    if (app.state.ecoMode) {
      if (!silent) app.toast('💡 省 Credits 模式已开启，交通距离计算已暂停', 'info');
      return Promise.resolve();
    }
    const key = (typeof window !== 'undefined' && window.BOARD_CONFIG && window.BOARD_CONFIG.gmapsApiKey) || '';
    if (!key) {
      if (!silent) app.toast('需先配置 Google Maps API Key（环境变量 GMAPS_API_KEY）并启用 Distance Matrix API', 'error', 7000);
      return Promise.resolve();
    }
    const mode = app.state.itineraryTravelMode || 'transit';
    const d = app.getActiveDestination();
    if (!d) return Promise.resolve();
    const day = (app.state[d.id]?.itinerary || []).find(x => x.id === dayId);
    if (!day || !day.spots || day.spots.length < 2) {
      if (!silent) app.toast('至少需要 2 个行程块才能计算交通时间', 'warning');
      return Promise.resolve();
    }
    if (!silent) app.toast('正在用 Google 计算交通时间…', 'info');
    return new Promise((resolve) => {
      app.modules.map.ensureMaps(() => {
        const gm = window.google && window.google.maps;
        if (!gm || !gm.DistanceMatrixService) {
          if (!silent) app.toast('Google Maps 未就绪，请刷新页面后重试', 'error');
          return resolve();
        }
        this._computeTravelRun(dayId, mode, silent)
          .then(() => resolve())
          .catch(e => { if (!silent) app.toast('交通时间计算出错：' + (e && e.message ? e.message : e), 'error'); resolve(); });
      });
    });
  },

  /* 全部重算：按当前交通方式，依次计算所有天（每天 ≥2 个行程块）的交通时间。silent 时 suppressing 单天成功提示。 */
  async computeTravelAll() {
    if (app.state.ecoMode) {
      app.toast('💡 省 Credits 模式已开启，交通距离计算已暂停（点顶部「💡 省 Credits：开」关闭以恢复）', 'warning', 6000);
      return;
    }
    const key = (typeof window !== 'undefined' && window.BOARD_CONFIG && window.BOARD_CONFIG.gmapsApiKey) || '';
    if (!key) {
      app.toast('需先配置 Google Maps API Key（环境变量 GMAPS_API_KEY）并启用 Distance Matrix API', 'error', 7000);
      return;
    }
    const d = app.getActiveDestination();
    if (!d) return;
    const days = (app.state[d.id]?.itinerary || []).filter(day => (day.spots || []).length >= 2);
    if (!days.length) {
      app.toast('没有可计算的天数（每天至少需要 2 个行程块）', 'warning');
      return;
    }
    app.toast('开始重算 ' + days.length + ' 天的交通时间…', 'info');
    for (const day of days) {
      await this.computeTravel(day.id, true);
    }
    app.toast('全部交通时间已重算完成', 'success');
  },

  async _computeTravelRun(dayId, mode, silent) {
    try {
      const d = app.getActiveDestination();
      const day = (app.state[d.id]?.itinerary || []).find(x => x.id === dayId);
      if (!day) return;
      const spots = (day.spots || []).slice().sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
      if (spots.length < 2) return;

      // 1) 缺坐标的行程块先按「名称 + 地址」地理编码获取坐标
      for (const s of spots) {
        if (s.lat == null || s.lng == null) {
          const q = (s.name || '') + (s.address ? ' ' + s.address : '');
          const g = await app.modules.map.geocodeCached(q);
          if (g) { s.lat = g.lat; s.lng = g.lng; }
        }
      }
      const noCoord = spots.filter(s => s.lat == null || s.lng == null);
      if (noCoord.length && !silent) {
        app.toast('以下地点无法定位（建议填地址或经纬度）：' + noCoord.map(s => s.name).join('、'), 'warning', 6000);
      }

      // 2) 构造相邻错位坐标对：origins[i] → destinations[i] = spots[i] → spots[i+1]
      const origins = [], dests = [];
      for (let i = 0; i < spots.length - 1; i++) { origins.push(spots[i]); dests.push(spots[i + 1]); }
      const validO = [], validD = [], validIdx = [];
      for (let i = 0; i < origins.length; i++) {
        if (origins[i].lat != null && origins[i].lng != null && dests[i].lat != null && dests[i].lng != null) {
          validO.push({ lat: origins[i].lat, lng: origins[i].lng });
          validD.push({ lat: dests[i].lat, lng: dests[i].lng });
          validIdx.push(i);
        }
      }
      // 先清空旧的交通时间（按当前顺序），稍后只回填有效段
      spots.forEach(s => { s.travelFromPrev = null; });

      if (validO.length === 0) {
        app.saveState();
        app.renderAll();
        if (!silent) app.toast('没有可计算的坐标对', 'warning');
        return;
      }

      await new Promise((res) => {
        const service = new window.google.maps.DistanceMatrixService();
        service.getDistanceMatrix({
          origins: validO,
          destinations: validD,
          travelMode: (window.google.maps.TravelMode || {})[mode.toUpperCase()] || mode,
          unitSystem: (window.google.maps.UnitSystem || {}).METRIC || 'METRIC',
          avoidFerries: false
          // 注意：provideRouteAlternatives 是 DirectionsService 的字段，DistanceMatrixService 不支持，
          // 传入会导致 InvalidValueError: unknown property provideRouteAlternatives。
        }, (resp, status) => {
          if (status !== 'OK' || !resp || !resp.rows) {
            if (!silent) app.toast('Google 交通时间计算失败：' + status, 'error');
            app.saveState();
            app.renderAll();
            return res();
          }
          validIdx.forEach((segIdx, k) => {
            const el = resp.rows[k] && resp.rows[k].elements && resp.rows[k].elements[k];
            const target = dests[segIdx];
            if (el && el.status === 'OK') {
              target.travelFromPrev = {
                mode,
                durText: el.duration ? el.duration.text : '',
                durMin: el.duration ? el.duration.value / 60 : 0,
                distText: el.distance ? el.distance.text : ''
              };
            } else {
              target.travelFromPrev = { mode, unavailable: true };
            }
          });
          app.saveState();
          app.renderAll();
          if (!silent) app.toast('交通时间已计算（' + validIdx.length + ' 段）', 'success');
          res();
        });
      });
    } catch (e) {
      app.toast('交通时间计算出错：' + (e && e.message ? e.message : e), 'error');
    }
  },

  // 计算新行程块放入某天后的默认开始时间（接在最后一块之后）
  defaultStart(day, durH) {
    const ends = (day.spots || []).map(s => itinTimeToNum(s.startTime) + (parseFloat(s.durationH) || 1));
    let start = ends.length ? Math.max.apply(null, ends) : 9;
    start = itinSnap(start);
    const minS = 0;
    const maxS = ITIN_TL_END - (parseFloat(durH) || 1);
    if (start < minS) start = minS;
    if (start > maxS) start = minS; // 溢出则回到凌晨
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

  /* ============================================================
     统一行程编辑（行程块 与 行程库 共用同一表单，双向同步）
     mode: 'spot' 编辑/新增行程块 (a=dayId, b=spotId)
           'cand' 编辑行程库项目 (a=candId)
           'newcand' 新增行程库项目
     ============================================================ */
  /* 生成 00:00–23:59 的 24 小时制时间下拉选项（step 分钟一档，默认 30） */
  itinTimeOptions(sel, step) {
    step = step || 30;
    let o = '';
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += step) {
        const v = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        o += `<option value="${v}" ${v === sel ? 'selected' : ''}>${v}</option>`;
      }
    }
    return o;
  },

  /* 解析旧版营业时间字符串为分段数组；支持 "09:00-22:00" 及多段用 , ; 、 或换行分隔 */
  parseLegacyHours(str) {
    if (!str || typeof str !== 'string') return [];
    const segs = [];
    str.split(/[,;、\n]+/).map(x => x.trim()).filter(Boolean).forEach(p => {
      const m = p.match(/(\d{1,2}:\d{2})\s*[-~至到]\s*(\d{1,2}:\d{2})/);
      if (m) segs.push({ open: m[1], close: m[2] });
    });
    return segs;
  },

  /* 取得营业时间分段：优先用结构化 hoursSegments，否则回退解析旧字符串。
     若标记为「24 小时开放」(alwaysOpen)，直接返回全天时段 00:00~24:00。 */
  hoursToSegments(s) {
    if (s && s.alwaysOpen) return [{ open: '00:00', close: '24:00' }];
    if (s && Array.isArray(s.hoursSegments) && s.hoursSegments.length) return s.hoursSegments;
    return this.parseLegacyHours(s && s.hours);
  },

  /* 按当天星期取有效营业时间分段：若该星期在 dailyHours 里有单独设置则用之，否则回退通用营业时间 */
  effectiveHours(s, wd) {
    if (s && s.dailyHours && wd != null) {
      const arr = s.dailyHours[wd];
      if (Array.isArray(arr) && arr.length) return arr;
    }
    return this.hoursToSegments(s);
  },

  /* 清空某一行的每日营业时间（置为「不填」） */
  clearDailyHour(btn) {
    const row = btn.closest && btn.closest('[data-dh]');
    if (!row) return;
    const o = row.querySelector('.t_dh_open'), c = row.querySelector('.t_dh_close');
    if (o) o.value = '';
    if (c) c.value = '';
  },

  /* 单个营业时间分段的行（开放/结束两个下拉 + 删除） */
  hoursSegRow(i, seg) {
    seg = seg || {};
    return `
      <div class="flex gap-2 items-center mb-1" data-seg="${i}">
        <select class="t_hours_open flex-1">${this.itinTimeOptions(seg.open, 5)}</select>
        <span class="text-slate-500">~</span>
        <select class="t_hours_close flex-1">${this.itinTimeOptions(seg.close, 5)}</select>
        <button type="button" class="btn btn-ghost btn-sm" onclick="app.modules.itinerary.removeHoursSeg(this)">🗑️</button>
      </div>`;
  },

  addHoursSeg() {
    const wrap = document.getElementById('t_hours_segs');
    if (!wrap) return;
    const idx = wrap.children.length;
    wrap.insertAdjacentHTML('beforeend', this.hoursSegRow(idx, { open: '09:00', close: '22:00' }));
  },

  removeHoursSeg(btn) {
    const row = btn.closest && btn.closest('[data-seg]');
    if (row && row.parentNode) row.parentNode.removeChild(row);
  },

  _commonFields(s) {
    const typeOpts = Object.entries(ITIN_TYPES)
      .map(([k, v]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${v.label}</option>`).join('');
    const WD = [['周一',1],['周二',2],['周三',3],['周四',4],['周五',5],['周六',6],['周日',0]];
    const closed = Array.isArray(s.closedDays) ? s.closedDays : [];
    // 若已设置过每日营业时间，则默认展开，方便用户看到已有数据；否则默认折叠
    const hasDaily = !!(s.dailyHours && Object.values(s.dailyHours)
      .some(arr => Array.isArray(arr) && arr.length && arr[0] && (arr[0].open || arr[0].close)));
    return `
      <div class="form-field col-span-full"><label>名称 <span class="req">*</span></label><input id="t_name" value="${s.name || ''}" placeholder="如：台北101" /></div>
      <div class="form-field"><label>分类</label><select id="t_type">${typeOpts}</select></div>
      <div class="form-field"><label>时长(小时)</label><input type="number" id="t_dur" min="0.5" step="0.5" value="${s.durationH || 1}" onchange="app.modules.itinerary.onSchedChange('dur')" /></div>
      <div class="form-field col-span-full">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" id="t_24h" ${s.alwaysOpen ? 'checked' : ''} onchange="app.modules.itinerary.onAlwaysOpenChange()" />
          <span>🕛 24 小时开放（全天营业，无需分段）</span>
        </label>
        <div id="t_hours_body" class="${s.alwaysOpen ? 'hidden' : ''}">
          <label>🕒 营业时间（可分段）</label>
          <div id="t_hours_segs">${this.hoursToSegments(s).map((seg, i) => this.hoursSegRow(i, seg)).join('')}</div>
          <button type="button" class="btn btn-ghost btn-sm mt-1" onclick="app.modules.itinerary.addHoursSeg()">➕ 添加分段</button>
          <div class="text-tiny text-slate-500 mt-1">从列表选择每段开始/结束时间（如 14:00~16:00）；未添加分段 = 不限制营业时间。可叠加多段（如午市+晚市）。</div>
        </div>
      </div>
      <div class="form-field col-span-full">
        <details class="dh-details" ${(hasDaily || s.alwaysOpen) ? 'open' : ''}>
          <summary class="dh-summary">🗓️ 每日营业时间（若每天不同，分别设置；留空则该天沿用上方通用营业时间）</summary>
          <div id="t_daily_hours" class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
            ${WD.map(([label, wd]) => {
              const seg = (s.dailyHours && s.dailyHours[wd] && s.dailyHours[wd][0]) || null;
              // 24 小时开放时，每天固定为 00:00~24:00（全天）并锁定编辑；否则每天默认「不填」沿用通用营业时间
              const dhOpenSel = s.alwaysOpen ? '00:00' : (seg ? seg.open : '');
              const dhCloseSel = s.alwaysOpen ? '24:00' : (seg ? seg.close : '');
              const dhDisabled = s.alwaysOpen ? 'disabled' : '';
              const dhOpts = (sel) => {
                const base = '<option value="">— 不填 —</option>' + this.itinTimeOptions(sel && sel !== '24:00' ? sel : '', 5);
                const o24 = (sel === '24:00') ? '<option value="24:00" selected>24:00</option>' : '<option value="24:00">24:00</option>';
                return base + o24;
              };
              return `
              <div class="flex gap-2 items-center mb-1" data-dh="${wd}">
                <span class="w-10 text-slate-600 text-sm shrink-0">${label}</span>
                <select class="t_dh_open flex-1" ${dhDisabled}>${dhOpts(dhOpenSel)}</select>
                <span class="text-slate-500">~</span>
                <select class="t_dh_close flex-1" ${dhDisabled}>${dhOpts(dhCloseSel)}</select>
                <button type="button" class="btn btn-ghost btn-sm shrink-0" onclick="app.modules.itinerary.clearDailyHour(this)">清除</button>
              </div>`;
            }).join('')}
          </div>
          ${s.alwaysOpen
            ? '<p class="text-tiny text-emerald-600 mt-1">🕛 已选 24 小时开放：每天均按 <strong>00:00~24:00（全天）</strong> 处理，下方每日时间已锁定为「全天」，保存后时间轴不再提示「非营业」。</p>'
            : '<p class="text-tiny text-slate-500 mt-1">按星期分别设置（如周一至周五 09:00~17:00，周末 09:00~18:00）。某天留空即沿用上方通用营业时间；时间轴会按当天星期校验「非营业」提示。点击上方标题可展开/收起。</p>'}
        </details>
      </div>
      <div class="form-field col-span-full">
        <label>🚫 固定休息日（每周不营业的星期）</label>
        <div id="t_closed" class="flex flex-wrap gap-2">
          ${WD.map(([label, wd]) => `<label class="chk-pill"><input type="checkbox" data-wd="${wd}" ${closed.includes(wd) ? 'checked' : ''}/> ${label}</label>`).join('')}
        </div>
        <div class="text-tiny text-slate-500 mt-1">勾选该地点每周几固定休息（如周一）。若把行程排在休息日，时间轴上会提示「今日休」。</div>
      </div>
      <div class="form-field col-span-full">
        <label>🔗 Google Map 链接</label>
        <div class="flex gap-2">
          <input id="t_map" class="flex-1" value="${s.mapUrl || ''}" placeholder="https://www.google.com/maps/place/.../@25.03,121.56,15z" />
          <button type="button" class="btn btn-ghost" style="white-space:nowrap" onclick="app.modules.itinerary.openMapLink('${s.lat != null ? s.lat : ''}','${s.lng != null ? s.lng : ''}')">🌐 打开</button>
        </div>
        <div class="text-tiny text-slate-500 mt-1">填好链接或经纬度后，点「打开」可直接跳转到 Google Maps（链接留空时按经纬度或名称搜索）</div>
      </div>
      <div class="form-field col-span-full"><label>🖼️ 图片链接 (URL)</label><input id="t_img" value="${s.image || ''}" placeholder="https://.../photo.jpg" /></div>
      <div class="form-field col-span-full"><label>📝 备注</label><textarea id="t_note" rows="2">${s.note || ''}</textarea></div>
    `;
  },

  /* 在编辑行程块/行程库时，直接跳转到 Google Maps。
     优先级：① 已填的地图链接；② 已存经纬度拼坐标 URL；③ 用名称搜索。 */
  openMapLink(lat, lng) {
    const mapEl = document.getElementById('t_map');
    const url = (mapEl && mapEl.value || '').trim();
    if (url) { window.open(url, '_blank', 'noopener'); return; }
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (!isNaN(la) && !isNaN(ln)) {
      window.open(`https://www.google.com/maps/@${la},${ln},15z`, '_blank', 'noopener');
      return;
    }
    const nameEl = document.getElementById('t_name');
    const name = (nameEl && nameEl.value || '').trim();
    if (name) {
      window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name), '_blank', 'noopener');
      return;
    }
    app.toast('请先填写 Google Map 链接、经纬度或名称', 'warning');
  },

  _schedFields(s, opts) {
    opts = opts || {};
    const daySel = opts.dayOptions
      ? `<div class="form-field col-span-full"><label>📅 加入行程表的日期</label><select id="t_day" onchange="app.modules.itinerary.onDayChange()">${opts.dayOptions}</select></div>`
      : '';
    // 选中「暂不加入」时隐藏开始/结束时间（该候选不进时间轴，无需排时间）
    const timeWrapCls = opts.showTime === false ? 'hidden' : '';
    return `
      ${daySel}
      <div id="schedTimeWrap" class="${timeWrapCls}">
        <div class="form-field">
          <label>开始时间（24 小时制）</label>
          <select id="t_start" onchange="app.modules.itinerary.onSchedChange('start')">${this.itinTimeOptions(s.startTime || '09:00', 5)}</select>
        </div>
        <div class="form-field">
          <label>结束时间（24 小时制）</label>
          <select id="t_end" onchange="app.modules.itinerary.onSchedChange('end')">${this.itinTimeOptions(s.endTime || '', 5)}</select>
        </div>
      </div>
      <div class="form-field"><label>门票(¥)</label><input type="number" id="t_ticket" min="0" value="${s.ticket || 0}" /></div>
      <div class="form-field"><label>是否需预约</label>
        <select id="t_resv">
          <option value="" ${!s.reservation ? 'selected' : ''}>未知</option>
          <option value="needed" ${s.reservation === 'needed' ? 'selected' : ''}>需预约</option>
          <option value="booked" ${s.reservation === 'booked' ? 'selected' : ''}>已预约</option>
          <option value="none" ${s.reservation === 'none' ? 'selected' : ''}>无需预约</option>
        </select>
      </div>
    `;
  },

  /* 加入行程表的日期改变时：选「暂不加入」（空值）则隐藏开始/结束时间字段 */
  onDayChange() {
    const dayEl = document.getElementById('t_day');
    const wrap = document.getElementById('schedTimeWrap');
    if (!dayEl || !wrap) return;
    wrap.classList.toggle('hidden', !dayEl.value);
  },

  /* 勾选「24 小时开放」时：隐藏分段营业时间编辑器，并把每日营业时间同步为「每天 00:00~24:00（全天）」并锁定编辑 */
  onAlwaysOpenChange() {
    const cb = document.getElementById('t_24h');
    const body = document.getElementById('t_hours_body');
    if (!cb || !body) return;
    const on = cb.checked;
    body.classList.toggle('hidden', on);
    // 同步每日营业时间：开 → 每天 00:00~24:00 且禁用；关 → 解除禁用并清空（恢复「沿用通用营业时间」）
    const rows = typeof document.querySelectorAll === 'function'
      ? document.querySelectorAll('#t_daily_hours [data-dh]') : [];
    rows.forEach(row => {
      const o = row.querySelector ? row.querySelector('.t_dh_open') : null;
      const c = row.querySelector ? row.querySelector('.t_dh_close') : null;
      if (!o || !c) return;
      if (on) { o.value = '00:00'; c.value = '24:00'; o.disabled = true; c.disabled = true; }
      else { o.disabled = false; c.disabled = false; o.value = ''; c.value = ''; }
    });
  },

  /* 行程块表单：开始 / 时长 / 结束时间 三者联动
     - 改「开始」或「时长」→ 结束 = 开始 + 时长（自动填写，封顶 23:55）
     - 改「结束」→ 时长 = 结束 - 开始（自动改） */
  onSchedChange(src) {
    const startEl = document.getElementById('t_start');
    const endEl = document.getElementById('t_end');
    const durEl = document.getElementById('t_dur');
    if (!startEl || !endEl || !durEl) return;
    const stN = itinTimeToNum(startEl.value);
    if (src === 'end') {
      // 改结束时间 → 时长不变，开始时间 = 结束时间 - 时长（整块平移）
      const eN = itinTimeToNum(endEl.value);
      const dur = Math.max(0.5, parseFloat(durEl.value) || 1);
      let startN = eN - dur;
      if (startN < 0)       startN = 0;
      startEl.value = itinNumToTime(startN);
      return;
    }
    const dur = Math.max(0.5, parseFloat(durEl.value) || 1);
    let endN = stN + dur;
    if (endN > 23 + 55 / 60) endN = 23 + 55 / 60; // 不超过 23:55
    endEl.value = itinNumToTime(endN);
  },


  openTripForm(mode, a, b) {
    const cands = app.state.candidates || (app.state.candidates = []);
    let cand = null, day = null, s = null, isNew = false, placedDayId = '';
    let dayOptions = '';

    if (mode === 'spot') {
      const d = app.getActiveDestination();
      if (!d) return;
      day = (app.state[d.id].itinerary || []).find(x => x.id === a);
      if (!day) return;
      isNew = !b;
      s = isNew
        ? { name: '', type: 'spot', startTime: this.defaultStart(day, 2), durationH: 2, ticket: 0, reservation: '', address: '', hours: '', mapUrl: '', image: '', note: '', lat: null, lng: null }
        : (day.spots || []).find(x => x.id === b);
      if (!s) return;
      if (s.sourceId) cand = cands.find(c => c.id === s.sourceId) || null;
    } else {
      // 行程库编辑 / 新增：与行程表编辑模块一模一样，且可直接选择加入行程表的日期
      const d = app.getActiveDestination();
      if (d) {
        const days = (app.state[d.id]?.itinerary || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
        // 找到当前已加入的实例（用于预填日期/时间/门票）
        let placed = null;
        for (const dy of days) {
          const sp = (dy.spots || []).find(sp => sp.sourceId === a);
          if (sp) { placed = sp; placedDayId = dy.id; break; }
        }
        // 顶部插入「暂不加入」选项（空值）：选中后该候选不进入任何一天的行程表，
        // 且开始/结束时间字段隐藏（见 _schedFields 的 showTime 与 onDayChange）。
        const unjoinedOpt = `<option value="">暂不加入</option>`;
        dayOptions = unjoinedOpt + days.map((dy, i) =>
          `<option value="${dy.id}" ${dy.id === placedDayId ? 'selected' : ''}>Day ${i + 1} · ${itinDateLabel(dy.date)}${dy.date ? ' ' + itinWeekdayLabel(dy.date) : ''}</option>`
        ).join('');
        if (mode === 'cand') {
          cand = cands.find(x => x.id === a);
          if (!cand) return;
          s = {
            name: cand.name, type: CN_TO_ITIN_KEY[cand.type] || 'other',
            startTime: placed ? placed.startTime : '09:00',
            durationH: cand.durationH || 2, ticket: placed ? placed.ticket : 0, reservation: placed ? placed.reservation : '',
            address: cand.address || '', hours: cand.hours || '', mapUrl: cand.mapUrl || '', image: cand.image || '', note: cand.note || '',
            closedDays: Array.isArray(cand.closedDays) ? cand.closedDays : [],
            dailyHours: cand.dailyHours || {},
            alwaysOpen: !!cand.alwaysOpen
          };
        } else {
          s = { name: '', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', address: '', hours: '', mapUrl: '', image: '', note: '', closedDays: [] };
        }
      } else {
        // 无目的地时仍允许编辑行程库（仅不提供加入日期）
        if (mode === 'cand') {
          cand = cands.find(x => x.id === a);
          if (!cand) return;
          s = { name: cand.name, type: CN_TO_ITIN_KEY[cand.type] || 'other', startTime: '09:00', durationH: cand.durationH || 2, ticket: 0, reservation: '', address: cand.address || '', hours: cand.hours || '', mapUrl: cand.mapUrl || '', image: cand.image || '', note: cand.note || '', dailyHours: cand.dailyHours || {} };
        } else {
          s = { name: '', type: 'spot', startTime: '09:00', durationH: 2, ticket: 0, reservation: '', address: '', hours: '', mapUrl: '', image: '', note: '' };
        }
      }
    }

    const titleMap = {
      spot: isNew ? '➕ 添加行程块' : '✏️ 编辑行程块',
      cand: '✏️ 编辑行程库项目',
      newcand: '➕ 新增行程库项目'
    };

    let placedNote = '';
    if (mode === 'cand' && cand) {
      const d = app.getActiveDestination();
      if (d) {
        const days = (app.state[d.id]?.itinerary || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
        const where = [];
        days.forEach((dy, i) => { (dy.spots || []).forEach(sp => { if (sp.sourceId === cand.id) where.push(`Day ${i + 1}（${dy.date || '?'}）${sp.startTime || ''}`); }); });
        if (where.length) placedNote = `<p class="text-tiny text-emerald-600 mb-2">已在行程表：${where.join('、')}</p>`;
      }
    }

    const sched = mode === 'spot' ? this._schedFields(s) : this._schedFields(s, { dayOptions, showTime: placedDayId !== '' });
    app.openModal(titleMap[mode] || '编辑', `
      ${placedNote}
      <div class="form-grid cols-3">
        ${this._commonFields(s)}
        ${sched}
      </div>
    `, [
      ...(mode === 'spot' && !isNew ? [{ text: '📋 复制到其它日期', class: 'btn btn-secondary', action: `app.modules.itinerary.copyTripToOtherDays('${a}','${b}')` }] : []),
      ...(mode === 'spot' && !isNew ? [{ text: '从表移除', class: 'btn btn-danger', action: `app.modules.itinerary.deleteTrip('${a}','${b}')` }] : []),
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.itinerary.saveTrip('${mode}','${a}','${b || ''}')` }
    ]);
    // 新行程块：结束时间默认 = 开始时间 + 时长（仅当尚未填写结束时间）
    setTimeout(() => {
      const e = document.getElementById('t_end');
      if (e && !e.value) app.modules.itinerary.onSchedChange('dur');
    }, 0);
  },

  saveTrip(mode, a, b) {
    const name = (document.getElementById('t_name').value || '').trim();
    if (!name) return app.toast('请填写名称', 'warning');
    const common = {
      name,
      type: document.getElementById('t_type').value,
      durationH: Math.max(0.5, parseFloat(document.getElementById('t_dur').value) || 1),
      hours: '',
      mapUrl: (document.getElementById('t_map').value || '').trim(),
      image: (document.getElementById('t_img').value || '').trim(),
      note: (document.getElementById('t_note').value || '').trim()
    };
    // 营业时间：从分段选择器收集（结构化 hoursSegments + 兼容旧字符串 hours）
    const _segEls = Array.from(document.querySelectorAll('#t_hours_segs [data-seg]'));
    const _segs = _segEls
      .map(el => ({ open: el.querySelector('.t_hours_open').value, close: el.querySelector('.t_hours_close').value }))
      .filter(g => g.open && g.close);
    // 「24 小时开放」：标记 alwaysOpen，清空分段（全天营业无需分段），hours 显示「24小时」
    const alwaysOpen = document.getElementById('t_24h') ? document.getElementById('t_24h').checked : false;
    common.alwaysOpen = alwaysOpen;
    if (alwaysOpen) {
      common.hoursSegments = [];
      common.hours = '24小时';
    } else {
      common.hoursSegments = _segs;
      common.hours = _segs.map(g => `${g.open}-${g.close}`).join('; ');
    }
    // 固定休息日：收集勾选的星期（data-wd = getDay() 值，0=周日…6=周六）
    const _closedEls = Array.from(document.querySelectorAll('#t_closed input[type=checkbox]'));
    common.closedDays = _closedEls.filter(el => el.checked).map(el => parseInt(el.dataset.wd, 10)).sort((a, b) => a - b);
    // 每日营业时间：按星期分别收集（留空则该天用通用营业时间）
    const _dhEls = Array.from(document.querySelectorAll('#t_daily_hours [data-dh]'));
    const dailyHours = {};
    _dhEls.forEach(el => {
      const wd = el.dataset.dh;
      const o = el.querySelector('.t_dh_open').value;
      const c = el.querySelector('.t_dh_close').value;
      if (o && c) dailyHours[wd] = [{ open: o, close: c }];
    });
    common.dailyHours = dailyHours;
    // 结束时间 + 由开始/结束推导时长
    const _startV = document.getElementById('t_start') ? document.getElementById('t_start').value : '09:00';
    const _endV = document.getElementById('t_end') ? document.getElementById('t_end').value : '';
    if (_endV) {
      const _stN = itinTimeToNum(_startV), _eN = itinTimeToNum(_endV);
      if (_eN > _stN) common.durationH = Math.round((_eN - _stN) * 100) / 100;
    }
    common.endTime = _endV;
    if (mode === 'spot') {
      const d = app.getActiveDestination();
      if (!d) return;
      const day = (app.state[d.id].itinerary || []).find(x => x.id === a);
      if (!day) return;
      if (!day.spots) day.spots = [];
      const sched = {
        startTime: document.getElementById('t_start').value || '09:00',
        endTime: document.getElementById('t_end') ? document.getElementById('t_end').value : '',
        ticket: parseFloat(document.getElementById('t_ticket').value) || 0,
        reservation: document.getElementById('t_resv').value
      };
      let spot;
      if (b) {
        spot = day.spots.find(x => x.id === b);
        if (!spot) return;
      } else {
        spot = { id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), sourceId: '' };
        day.spots.push(spot);
      }
      // 行程表内容同步到行程库：确保每个行程块都有对应的行程库条目
      if (!spot.sourceId) {
        const nc = this._createCandFromCommon(common);
        (app.state.candidates || (app.state.candidates = [])).push(nc);
        spot.sourceId = nc.id;
      } else {
        const cand = (app.state.candidates || []).find(c => c.id === spot.sourceId);
        if (cand) this._writeCommonToCand(cand, common);
      }
      Object.assign(spot, common, sched);
      // 从地图链接解析经纬度（零 credits）：链接带坐标则直接写入，地图上即能定位，不再显示「未定位」
      if (spot.lat == null || spot.lng == null) {
        const c = extractCoordsFromMapUrl(common.mapUrl);
        if (c) { spot.lat = c.lat; spot.lng = c.lng; }
      }
      day.spots.sort((x, y) => itinTimeToNum(x.startTime) - itinTimeToNum(y.startTime));
      // 行程块内容/顺序变更：配置了 API Key 且未开「省 Credits」则自动重算，否则清除待手动重算
      const travelKey = (typeof window !== 'undefined' && window.BOARD_CONFIG && window.BOARD_CONFIG.gmapsApiKey) || '';
      if (travelKey && !app.state.ecoMode) this.computeTravel(a); else if (!travelKey) this.clearTravelForDay(a);
    } else {
      this._clearTravelAllDays();   // 行程库改动可能同步到多天，统一清除待重算
      // 行程库编辑 / 新增：与行程表同一套字段，并可直接加入 / 移动到行程表的日期
      const cands = app.state.candidates || (app.state.candidates = []);
      let cand;
      const isNew = (mode === 'newcand');
      if (mode === 'cand') {
        cand = cands.find(x => x.id === a);
        if (!cand) return;
      } else {
        // 新增行程库项目：默认【不】加入行程表，仅记录偏好日期，供后续勾选「加入行程」时再放进去
        cand = { id: 'cand_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), checked: false, preferredDayId: '' };
        cands.push(cand);
      }
      this._writeCommonToCand(cand, common);
      this.propagateCandToSpots(cand, common); // 同步其它已加入的实例（若有）

      const d = app.getActiveDestination();
      if (d) {
        const list = app.state[d.id]?.itinerary || [];
        // 移除本目的地中该行程库的旧实例（实现跨日移动 / 重新放置）
        list.forEach(dy => { if (dy.spots) dy.spots = dy.spots.filter(s => s.sourceId !== cand.id); });
        const dayId = document.getElementById('t_day') ? document.getElementById('t_day').value : '';
        if (isNew) {
          // 新增：只记录用户想加入的偏好日期，默认不加入行程表
          cand.preferredDayId = dayId || '';
        } else if (dayId) {
          // 编辑已有：按所选日期重新加入行程表
          const day = list.find(x => x.id === dayId);
          if (day) {
            const sched = {
              startTime: document.getElementById('t_start').value || '09:00',
              endTime: document.getElementById('t_end') ? document.getElementById('t_end').value : '',
              ticket: parseFloat(document.getElementById('t_ticket').value) || 0,
              reservation: document.getElementById('t_resv').value
            };
            const ns = Object.assign({ id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), sourceId: cand.id }, common, sched);
            if (!day.spots) day.spots = [];
            day.spots.push(ns);
            day.spots.sort((x, y) => itinTimeToNum(x.startTime) - itinTimeToNum(y.startTime));
            cand.checked = true;
          }
        } else {
          // 选「暂不加入」（dayId 为空）：移除旧实例并保持未加入状态，
          // 这样编辑一个原本未加入的行程、且没改加入日期时，它依旧保持未加入
          cand.checked = false;
        }
      }
    }
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('已保存', 'success');
  },

  /* 把一个行程块（spot）转成「公共字段」对象，用于同步/创建行程库项目（无需 DOM） */
  _spotToCommon(s) {
    return {
      name: s.name || '',
      type: s.type || 'spot',
      durationH: parseFloat(s.durationH) || 1,
      endTime: s.endTime || '',
      hoursSegments: s.hoursSegments || [],
      hours: s.hours || '',
      mapUrl: s.mapUrl || '',
      image: s.image || '',
      note: s.note || '',
      closedDays: Array.isArray(s.closedDays) ? s.closedDays : [],
      dailyHours: s.dailyHours || {},
      alwaysOpen: !!s.alwaysOpen
    };
  },

  _createCandFromCommon(common) {    return {
      id: 'cand_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      checked: true,
      name: common.name,
      type: ITIN_KEY_TO_CN[common.type] || '其他',
      durationH: common.durationH,
      endTime: common.endTime || '',
      hoursSegments: common.hoursSegments || [],
      hours: common.hours,
      mapUrl: common.mapUrl,
      image: common.image,
      note: common.note,
      closedDays: Array.isArray(common.closedDays) ? common.closedDays : [],
      dailyHours: common.dailyHours || {},
      alwaysOpen: !!common.alwaysOpen
    };
  },

  _writeCommonToCand(cand, common) {
    cand.name = common.name;
    cand.type = ITIN_KEY_TO_CN[common.type] || cand.type;
    cand.durationH = common.durationH;
    cand.endTime = common.endTime || '';
    cand.hoursSegments = common.hoursSegments || [];
    cand.hours = common.hours;
    cand.mapUrl = common.mapUrl;
    cand.image = common.image;
    cand.note = common.note;
    cand.closedDays = Array.isArray(common.closedDays) ? common.closedDays : [];
    cand.dailyHours = common.dailyHours || {};
    cand.alwaysOpen = !!common.alwaysOpen;
  },

  // 把行程库项目改动同步到所有关联行程块（按 sourceId 跨目的地）
  propagateCandToSpots(cand, common) {
    const fields = {
      name: common.name, type: common.type, durationH: common.durationH,
      endTime: common.endTime || '', hoursSegments: common.hoursSegments || [],
      hours: common.hours, mapUrl: common.mapUrl,
      image: common.image, note: common.note,
      closedDays: Array.isArray(common.closedDays) ? common.closedDays : [],
      alwaysOpen: !!common.alwaysOpen,
      dailyHours: common.dailyHours || {}
    };
    (app.state.destinations || []).forEach(dest => {
      const list = app.state[dest.id]?.itinerary || [];
      list.forEach(day => { (day.spots || []).forEach(s => { if (s.sourceId === cand.id) Object.assign(s, fields); }); });
    });
  },

  // 已移除「根据地图链接获取地址」功能：地址栏、获取按钮、短链解析与反向地理编码均已删除；地图链接字段保留。

  deleteTrip(dayId, spotId) {
    if (!confirm('确定把这个行程块从行程表移除？（仍保留在「行程库」，可随时重新加入）')) return;
    const d = app.getActiveDestination();
    if (!d) return;
    const day = (app.state[d.id].itinerary || []).find(x => x.id === dayId);
    if (!day) return;
    const removed = (day.spots || []).find(s => s.id === spotId);
    day.spots = (day.spots || []).filter(s => s.id !== spotId);
    // 从行程表移除后，若该行程库项目没有再出现在任何一天，则标记为「未加入行程」
    if (removed && removed.sourceId) {
      const stillPlaced = (app.state[d.id].itinerary || []).some(dy => (dy.spots || []).some(s => s.sourceId === removed.sourceId));
      if (!stillPlaced) {
        const c = (Array.isArray(app.state.candidates) ? app.state.candidates : []).find(x => x.id === removed.sourceId);
        if (c) c.checked = false;
      }
    }
    this.clearTravelForDay(dayId);
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast('已从行程表移除（行程库保留，已标记为未加入）', 'success');
  },

  /* ===== 复制行程块到其它日期（共享同一行程库项目，不重复添加） ===== */
  copyTripToOtherDays(dayId, spotId) {
    const d = app.getActiveDestination();
    if (!d) return;
    const srcDay = (app.state[d.id].itinerary || []).find(x => x.id === dayId);
    const spot = srcDay && (srcDay.spots || []).find(s => s.id === spotId);
    if (!spot) return;
    const days = (app.state[d.id].itinerary || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const opts = days.map((dy, i) =>
      dy.id === dayId ? '' :
      `<label class="flex items-center gap-2 p-2 rounded border border-slate-200 mb-1 cursor-pointer">
        <input type="checkbox" class="copy-day-cb" value="${dy.id}" checked />
        <span>Day ${i + 1} · ${itinDateLabel(dy.date)}</span>
      </label>`
    ).join('');
    if (!opts) return app.toast('没有其他日期可复制', 'warning');
    app.openModal('📋 复制到其它日期', `
      <p class="text-sm text-slate-600 mb-2">把「<strong>${spot.name}</strong>」复制为独立的行程块到以下日期（与原块<strong>共享同一行程库项目</strong>，不会在行程库里重复添加；可在目标日再单独改时间）。</p>
      <div class="max-h-64 overflow-y-auto">${opts}</div>
    `, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '复制', class: 'btn btn-secondary', action: `app.modules.itinerary.confirmCopyTrip('${dayId}','${spotId}')` }
    ]);
  },

  confirmCopyTrip(dayId, spotId) {
    const d = app.getActiveDestination();
    if (!d) return;
    const srcDay = (app.state[d.id].itinerary || []).find(x => x.id === dayId);
    const spot = srcDay && (srcDay.spots || []).find(s => s.id === spotId);
    if (!spot) return;
    // 确保存在对应的行程库项目（原块没有 sourceId 时新建；有则同步最新内容）
    if (!spot.sourceId) {
      const nc = this._createCandFromCommon(this._spotToCommon(spot));
      (app.state.candidates || (app.state.candidates = [])).push(nc);
      spot.sourceId = nc.id;
    } else {
      const cand = (app.state.candidates || []).find(c => c.id === spot.sourceId);
      if (cand) this._writeCommonToCand(cand, this._spotToCommon(spot));
    }
    const cbs = Array.from(document.querySelectorAll('.copy-day-cb:checked'));
    if (!cbs.length) return app.toast('请至少选择一个日期', 'warning');
    const list = app.state[d.id].itinerary;
    let count = 0;
    const cand = (app.state.candidates || []).find(c => c.id === spot.sourceId);
    if (cand) cand.checked = true;
    cbs.forEach(cb => {
      const tday = list.find(x => x.id === cb.value);
      if (!tday) return;
      if (!tday.spots) tday.spots = [];
      const ns = {
        id: 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        sourceId: spot.sourceId,
        name: spot.name, type: spot.type,
        startTime: spot.startTime || '09:00',
        endTime: spot.endTime || '',
        durationH: parseFloat(spot.durationH) || 1,
        ticket: parseFloat(spot.ticket) || 0,
        reservation: spot.reservation || '',
        hoursSegments: spot.hoursSegments || [],
        hours: spot.hours || '',
        mapUrl: spot.mapUrl || '', image: spot.image || '',
        note: spot.note || '',
        dailyHours: spot.dailyHours || {},
        address: spot.address || '',
        lat: spot.lat != null ? spot.lat : null,
        lng: spot.lng != null ? spot.lng : null,
        travelFromPrev: null
      };
      tday.spots.push(ns);
      tday.spots.sort((a, b) => itinTimeToNum(a.startTime) - itinTimeToNum(b.startTime));
      this.clearTravelForDay(tday.id);
      count++;
    });
    app.saveState();
    app.closeModal();
    app.renderAll();
    app.toast(`已复制「${spot.name}」到 ${count} 天（共享同一行程库项目）`, 'success');
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
