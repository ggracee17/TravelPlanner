/* ============================================================
   板块3：行前准备两份核对清单
   1. 证件手续清单（带勾选）
   2. 行李打包清单（按品类 + 气候动态调整）
   ============================================================ */

// 默认清单数据（在 app.init 的 loadState 之后由 ensureChecklists 填充，避免覆盖已持久化数据）
const DEFAULT_DOCS = [
  { id: 'c1', name: '护照（有效期 ≥ 6 个月）', checked: false, required: true },
  { id: 'c2', name: '签证（或电子签证确认页）', checked: false, required: true },
  { id: 'c3', name: '机票行程单（电子/纸质）', checked: false, required: true },
  { id: 'c4', name: '酒店预订单', checked: false, required: true },
  { id: 'c5', name: '旅行保险（保单 + 紧急联系人）', checked: false, required: true },
  { id: 'c6', name: '国际驾照（自驾国家需要）', checked: false, required: false },
  { id: 'c7', name: '信用卡（Visa/Master 各 1 张）', checked: false, required: true },
  { id: 'c8', name: '外币现金（按目的地换汇）', checked: false, required: false },
  { id: 'c9', name: '身份证（国内航班/高铁备用）', checked: false, required: false },
  { id: 'c10', name: '驾照（国内自驾/部分国家互认）', checked: false, required: false },
  { id: 'c11', name: '疫苗接种证明（如黄热病等）', checked: false, required: false },
  { id: 'c12', name: '紧急联系人清单（纸质 + 邮箱）', checked: false, required: true }
];
const DEFAULT_LUG = [
  { id: 'l1', cat: '衣物', name: '上衣（按天数准备）', checked: false },
  { id: 'l2', cat: '衣物', name: '裤子/裙装', checked: false },
  { id: 'l3', cat: '衣物', name: '内衣袜子套装', checked: false },
  { id: 'l4', cat: '衣物', name: '睡衣', checked: false },
  { id: 'l5', cat: '衣物', name: '外套（防风/保暖，按气候）', checked: false },
  { id: 'l6', cat: '衣物', name: '泳衣（海岛/温泉）', checked: false },
  { id: 'l7', cat: '衣物', name: '舒适步行鞋', checked: false },
  { id: 'l8', cat: '衣物', name: '拖鞋', checked: false },
  { id: 'l9', cat: '衣物', name: '帽子 + 墨镜', checked: false },
  { id: 'l10', cat: '洗护', name: '洗漱包（牙刷牙膏）', checked: false },
  { id: 'l11', cat: '洗护', name: '洗发水/沐浴露（旅行装）', checked: false },
  { id: 'l12', cat: '洗护', name: '面霜 + 防晒霜（高倍）', checked: false },
  { id: 'l13', cat: '洗护', name: '唇膏 + 护手霜', checked: false },
  { id: 'l14', cat: '洗护', name: '刮胡刀 / 化妆包', checked: false },
  { id: 'l15', cat: '洗护', name: '毛巾（快干型）', checked: false },
  { id: 'l16', cat: '洗护', name: '卫生用品', checked: false },
  { id: 'l17', cat: '电子设备', name: '手机 + 充电线', checked: false },
  { id: 'l18', cat: '电子设备', name: '充电宝（≤ 20000mAh, 民航规定）', checked: false },
  { id: 'l19', cat: '电子设备', name: '相机 + 存储卡 + 备用电池', checked: false },
  { id: 'l20', cat: '电子设备', name: '万能转换插头（按目的地制式）', checked: false },
  { id: 'l21', cat: '电子设备', name: '耳机', checked: false },
  { id: 'l22', cat: '电子设备', name: '便携 WiFi / 上网卡', checked: false },
  { id: 'l23', cat: '电子设备', name: '笔记本电脑 / iPad（按需）', checked: false },
  { id: 'l24', cat: '药品', name: '感冒药 + 退烧药', checked: false },
  { id: 'l25', cat: '药品', name: '肠胃药 + 止泻药', checked: false },
  { id: 'l26', cat: '药品', name: '晕车药', checked: false },
  { id: 'l27', cat: '药品', name: '创可贴 + 消毒湿巾', checked: false },
  { id: 'l28', cat: '药品', name: '个人慢性病药（按疗程）', checked: false },
  { id: 'l29', cat: '药品', name: '驱蚊水（热带/东南亚）', checked: false },
  { id: 'l30', cat: '药品', name: '抗过敏药', checked: false },
  { id: 'l31', cat: '随身杂物', name: '护照包 / 文件袋', checked: false },
  { id: 'l32', cat: '随身杂物', name: '零钱包', checked: false },
  { id: 'l33', cat: '随身杂物', name: '雨伞 / 雨衣', checked: false },
  { id: 'l34', cat: '随身杂物', name: '环保购物袋', checked: false },
  { id: 'l35', cat: '随身杂物', name: '水壶', checked: false },
  { id: 'l36', cat: '随身杂物', name: '小零食（飞机/路上）', checked: false },
  { id: 'l37', cat: '随身杂物', name: '眼罩 + 耳塞（长途飞行）', checked: false }
];

// 在 app.init() 的 loadState() 之后调用：仅当清单为空才用默认值填充，绝不覆盖用户已保存的行程数据
app.ensureChecklists = function () {
  if (!this.state.checklists) this.state.checklists = { documents: [], luggage: [], todos: [] };
  if (!Array.isArray(this.state.checklists.todos)) this.state.checklists.todos = [];
  if (this.state.checklists.documents.length === 0) {
    this.state.checklists.documents = DEFAULT_DOCS.map(x => ({ ...x }));
  }
  if (this.state.checklists.luggage.length === 0) {
    this.state.checklists.luggage = DEFAULT_LUG.map(x => ({ ...x }));
  }
  this.saveState();
};

app.modules.checklists = {
  render() {
    const sec = document.querySelector('[data-section=checklists]');
    if (!sec) return;
    const docs = app.state.checklists.documents || [];
    const lug = app.state.checklists.luggage || [];
    const todos = app.state.checklists.todos || [];
    const docsChecked = docs.filter(x => x.checked).length;
    const lugChecked = lug.filter(x => x.checked).length;
    const todoDone = todos.filter(x => x.done).length;
    // 乱码自检：若清单项名称含替换字符 U+FFFD（典型表现：括号前出现一堆 □），提示一键重置清理
    const hasMojibake = [...docs, ...lug].some(x => x.name && x.name.indexOf('\uFFFD') >= 0);
    if (hasMojibake && !this._warnedMojibake) {
      this._warnedMojibake = true;
      app.toast('检测到清单含乱码字符（如「\uFFFD」），点顶部「🔄 重置默认清单」可一键清理并恢复初始清单', 'warning', 7000);
    }
    const d = app.getActiveDestination();
    const climate = d ? this.suggestClimate(app.destName(d), d.startDate) : '请先在板块1选择目的地';

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>${app.t('checklist.title')}</span>
          <div class="ml-auto flex gap-2">
            <button class="btn btn-success" onclick="app.modules.checklists.exportXlsx()">${app.t('checklist.export')}</button>
            <button class="btn btn-ghost" onclick="app.modules.checklists.reset()">${app.t('checklist.reset')}</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-4">带勾选框的清单，出发前可逐项打勾。行李清单会根据当前目的地气候智能增减。</p>

        <div class="mb-2 p-3 bg-sky-50 border border-sky-200 rounded text-sm">
          💡 <strong>当前目的地气候建议：</strong>${climate}
        </div>
      </div>

      <!-- 待办事项（放在最顶上） -->
      <div class="card">
        <div class="card-title">
          <span>📋 ${app.t('todo.title')}（${app.t('checklist.checked')} ${todoDone} / ${todos.length}）</span>
          <div class="ml-auto flex gap-2">
            ${todoDone > 0 ? `<button class="btn btn-ghost btn-sm" onclick="app.modules.checklists.clearCompletedTodos()" title="删除所有已打勾的待办，缩短列表">🧹 清除已完成</button>` : ''}
            <button class="btn btn-primary btn-sm" onclick="app.modules.checklists.addTodo()">${app.t('todo.add')}</button>
          </div>
        </div>
        ${todos.length === 0 ? '<p class="text-sm text-slate-400 mt-2">还没有待办事项，点「➕ 添加待办」记录需要办的事。</p>' : `
          <div id="todoList">
            ${todos.map(t => this.renderTodoItem(t)).join('')}
          </div>
        `}
      </div>

      <!-- 证件清单 -->
      <div class="card">
        <div class="card-title">
          <span>${app.t('checklist.docsTitle')}（${app.t('checklist.checked')} ${docsChecked} / ${docs.length}）</span>
          <div class="ml-auto flex gap-2">
            <button class="btn btn-primary btn-sm" onclick="app.modules.checklists.addDoc()">${app.t('checklist.addItem')}</button>
          </div>
        </div>
        <div id="docList">
          ${docs.map(c => this.renderCheckItem(c, 'documents')).join('')}
        </div>
      </div>

      <!-- 行李清单 -->
      <div class="card">
        <div class="card-title">
          <span>${app.t('checklist.lugTitle')}（${app.t('checklist.checked')} ${lugChecked} / ${lug.length}）</span>
          <div class="ml-auto flex gap-2">
            <button class="btn btn-primary btn-sm" onclick="app.modules.checklists.addLug()">${app.t('checklist.addItem')}</button>
          </div>
        </div>
        <p class="text-tiny text-slate-500 mb-2">已按品类分组：衣物 / 洗护 / 电子设备 / 药品 / 随身杂物</p>
        ${this.renderLugByCategory(lug)}
      </div>
    `;
  },

  renderTodoItem(t) {
    return `
      <div class="checklist-item ${t.done ? 'checked' : ''}" data-todo-id="${t.id}">
        <input type="checkbox" ${t.done ? 'checked' : ''} onchange="app.modules.checklists.toggleTodo('${t.id}', this.checked)" />
        <div class="flex-1 min-w-0">
          <div class="font-medium ${t.done ? 'line-through text-slate-400' : ''}">${app._esc(t.name)}</div>
          ${t.detail ? `<div class="text-tiny text-slate-500 mt-0.5 whitespace-pre-wrap break-words">${app._esc(t.detail)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="app.modules.checklists.editTodo('${t.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="app.modules.checklists.removeTodo('${t.id}')">🗑️</button>
      </div>
    `;
  },

  renderCheckItem(item, type) {
    return `
      <div class="checklist-item ${item.checked ? 'checked' : ''}" data-check-id="${item.id}" data-check-type="${type}">
        <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="app.modules.checklists.toggle('${type}','${item.id}', this.checked)" />
        <span class="flex-1">${item.name}${item.required ? ' <span class="text-red-500 text-tiny">*必带</span>' : ''}</span>
        <button class="btn btn-ghost btn-sm" onclick="app.modules.checklists.edit('${type}','${item.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="app.modules.checklists.remove('${type}','${item.id}')">🗑️</button>
      </div>
    `;
  },

  renderLugByCategory(lug) {
    const groups = {};
    lug.forEach(x => { if (!groups[x.cat]) groups[x.cat] = []; groups[x.cat].push(x); });
    return Object.entries(groups).map(([cat, items]) => `
      <div class="mb-3">
        <h4 class="text-sm font-semibold text-slate-700 mb-1 px-2 py-1 bg-slate-100 rounded">📦 ${cat}（${items.filter(x => x.checked).length}/${items.length}）</h4>
        <div>
          ${items.map(x => this.renderCheckItem(x, 'luggage')).join('')}
        </div>
      </div>
    `).join('');
  },

  toggle(type, id, checked) {
    const list = app.state.checklists[type];
    const item = list.find(x => x.id === id);
    if (item) {
      item.checked = checked;
      app.saveState();
      // 视觉更新（不重渲染避免勾选跳动）
      const row = document.querySelector(`[data-check-id="${id}"]`);
      if (row) row.classList.toggle('checked', checked);
      // 更新顶部计数
      this.render();
    }
  },

  addDoc() {
    this.openEdit('documents', null);
  },

  addLug() {
    this.openEdit('luggage', null);
  },

  edit(type, id) {
    const item = app.state.checklists[type].find(x => x.id === id);
    if (!item) return;
    this.openEdit(type, item);
  },

  openEdit(type, item) {
    const isNew = !item;
    item = item || { name: '', checked: false, required: false, cat: type === 'luggage' ? '衣物' : '' };
    const html = `
      <div class="form-grid">
        <div class="form-field col-span-full"><label>名称 <span class="req">*</span></label><input id="ck_name" value="${item.name}" placeholder="如：防晒霜（SPF50+）" /></div>
        ${type === 'luggage' ? `
          <div class="form-field">
            <label>分类</label>
            <select id="ck_cat">
              <option ${item.cat==='衣物'?'selected':''}>衣物</option>
              <option ${item.cat==='洗护'?'selected':''}>洗护</option>
              <option ${item.cat==='电子设备'?'selected':''}>电子设备</option>
              <option ${item.cat==='药品'?'selected':''}>药品</option>
              <option ${item.cat==='随身杂物'?'selected':''}>随身杂物</option>
            </select>
          </div>
        ` : ''}
        <div class="form-field">
          <label><input type="checkbox" id="ck_req" ${item.required ? 'checked' : ''} /> 标记为必带（必带项以红字提醒）</label>
        </div>
        <div class="form-field">
          <label><input type="checkbox" id="ck_checked" ${item.checked ? 'checked' : ''} /> 立即标记为已勾选</label>
        </div>
      </div>
    `;
    app.openModal(isNew ? '➕ 新增清单项' : '✏️ 编辑清单项', html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.checklists.saveItem('${type}','${item.id || ''}')` }
    ]);
  },

  saveItem(type, id) {
    const name = document.getElementById('ck_name').value.trim();
    if (!name) return app.toast('请填写名称', 'warning');
    const data = {
      name,
      required: document.getElementById('ck_req')?.checked || false,
      checked: document.getElementById('ck_checked')?.checked || false
    };
    if (type === 'luggage') data.cat = document.getElementById('ck_cat').value;

    if (id) {
      const idx = app.state.checklists[type].findIndex(x => x.id === id);
      if (idx >= 0) app.state.checklists[type][idx] = { ...app.state.checklists[type][idx], ...data };
    } else {
      app.state.checklists[type].push({ id: 'ck_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ...data });
    }
    app.saveState();
    app.closeModal();
    this.render();
    app.toast('已保存', 'success');
  },

  remove(type, id) {
    if (!confirm('确定删除该清单项？')) return;
    app.state.checklists[type] = app.state.checklists[type].filter(x => x.id !== id);
    app.saveState();
    this.render();
  },

  /* ===== 待办事项：名称 + 详情 + 完成勾选 ===== */
  addTodo() {
    this.openTodoEdit(null);
  },

  editTodo(id) {
    const item = app.state.checklists.todos.find(x => x.id === id);
    if (!item) return;
    this.openTodoEdit(item);
  },

  openTodoEdit(item) {
    const isNew = !item;
    item = item || { name: '', detail: '', done: false };
    const html = `
      <div class="form-grid">
        <div class="form-field col-span-full"><label>待办名称 <span class="req">*</span></label><input id="td_name" value="${app._esc(item.name)}" placeholder="如：预约博物馆门票" /></div>
        <div class="form-field col-span-full"><label>详情</label><textarea id="td_detail" rows="3" placeholder="如：需提前 3 天官网预约，带护照">${app._esc(item.detail || '')}</textarea></div>
        <div class="form-field col-span-full">
          <label><input type="checkbox" id="td_done" ${item.done ? 'checked' : ''} /> 标记为已完成</label>
        </div>
      </div>
    `;
    app.openModal(isNew ? '➕ 新增待办事项' : '✏️ 编辑待办事项', html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.checklists.saveTodo('${item.id || ''}')` }
    ]);
  },

  saveTodo(id) {
    const name = document.getElementById('td_name').value.trim();
    if (!name) return app.toast('请填写待办名称', 'warning');
    const data = {
      name,
      detail: document.getElementById('td_detail').value.trim(),
      done: document.getElementById('td_done')?.checked || false
    };
    if (id) {
      const idx = app.state.checklists.todos.findIndex(x => x.id === id);
      if (idx >= 0) app.state.checklists.todos[idx] = { ...app.state.checklists.todos[idx], ...data };
    } else {
      app.state.checklists.todos.push({ id: 'td_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ...data });
    }
    app.saveState();
    app.closeModal();
    this.render();
    app.toast('已保存', 'success');
  },

  toggleTodo(id, done) {
    const item = app.state.checklists.todos.find(x => x.id === id);
    if (!item) return;
    item.done = done;
    app.saveState();
    const row = document.querySelector(`[data-todo-id="${id}"]`);
    if (row) {
      row.classList.toggle('checked', done);
      const nameEl = row.querySelector('.font-medium');
      if (nameEl) nameEl.classList.toggle('line-through', done), nameEl.classList.toggle('text-slate-400', done);
    }
  },

  removeTodo(id) {
    if (!confirm('确定删除该待办事项？')) return;
    app.state.checklists.todos = app.state.checklists.todos.filter(x => x.id !== id);
    app.saveState();
    this.render();
  },

  /* 清除所有已完成的待办事项（缩短任务列表）。仅在有已完成项时显示按钮；带二次确认。 */
  clearCompletedTodos() {
    const todos = app.state.checklists.todos || [];
    const done = todos.filter(x => x.done);
    if (done.length === 0) { app.toast('没有已完成的待办事项', 'info'); return; }
    if (!confirm(`确定清除 ${done.length} 条已完成的待办事项？清除后无法恢复。`)) return;
    app.state.checklists.todos = todos.filter(x => !x.done);
    app.saveState();
    this.render();
    app.toast(`已清除 ${done.length} 条已完成待办`, 'success');
  },

  reset() {
    if (!confirm('确定删除当前全部清单并恢复「初始默认清单」？此操作不可撤销。')) return;
    // 直接以源码里的干净默认值覆盖（无论当前是否为空/是否含乱码），保存即把损坏数据清掉。
    app.state.checklists.documents = DEFAULT_DOCS.map(x => ({ ...x }));
    app.state.checklists.luggage = DEFAULT_LUG.map(x => ({ ...x }));
    app.saveState();
    this.render();
    this._warnedMojibake = false; // 重置后数据已干净，允许下次再提示
    app.toast('已恢复初始默认清单', 'success');
  },

  /* ===== 气候建议 ===== */
  suggestClimate(place, startDate) {
    if (!place) return '请先在板块1选择目的地';
    const month = startDate ? new Date(startDate).getMonth() + 1 : new Date().getMonth() + 1;
    const tropical = ['泰国', '越南', '新加坡', '马来西亚', '印度尼西亚', '菲律宾', '马尔代夫', '斯里兰卡', '柬埔寨'];
    const cold = ['俄罗斯', '冰岛', '挪威', '瑞典', '芬兰', '加拿大', '瑞士(冬)'];

    // 台湾：5-10月为炎热潮湿且台风季（9月仍是盛夏尾声，午后雷阵雨频繁、台风风险高）
    if (/台湾/.test(place) && month >= 5 && month <= 10) {
      return `⚠️ 台湾湿热台风季（${place} ${month}月）——气温 21-31℃、湿度高、午后雷阵雨频繁、台风风险，建议：速干透气衣物、高倍防晒、驱蚊水、折叠雨伞/雨衣、防水文件袋、便携风扇`;
    }

    let suggestion = '';
    if (tropical.includes(place)) {
      suggestion = `🌴 热带气候（${place}）——气温 25-35℃，建议：轻薄透气衣物、泳衣、高倍防晒、驱蚊水、凉鞋、雨伞`;
    } else if (cold.includes(place) || month <= 2 || month === 12) {
      suggestion = `❄️ 寒冷气候（${place} ${month}月）——气温 0℃ 以下，建议：厚羽绒、保暖内衣、防水手套、暖宝宝、雪地靴、润唇膏`;
    } else if (month >= 6 && month <= 8) {
      suggestion = `☀️ 炎热夏季（${place} ${month}月）——气温 28-38℃，建议：短袖短裤、防晒服、太阳镜、补水喷雾、便携风扇`;
    } else {
      suggestion = `⛅ 温和气候（${place} ${month}月）——气温 15-25℃，建议：长袖+薄外套、薄毛衣、长裤、舒适步行鞋`;
    }
    return suggestion;
  },

  /* ===== 导出 Excel ===== */
  exportXlsx() {
    const docs = app.state.checklists.documents.map(x => ({ 项目: x.name, 必带: x.required ? '是' : '否', 已勾选: x.checked ? '✓' : '□' }));
    const lug = app.state.checklists.luggage.map(x => ({ 分类: x.cat, 项目: x.name, 已勾选: x.checked ? '✓' : '□' }));
    const todos = (app.state.checklists.todos || []).map(x => ({ 待办: x.name, 详情: x.detail || '', 已完成: x.done ? '✓' : '□' }));
    if (typeof XLSX === 'undefined') { app.downloadCSV(`travel_checklist_${new Date().toISOString().slice(0,10)}.csv`, [...docs, ...lug, ...todos]); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(docs), '证件手续清单');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lug), '行李打包清单');
    if (todos.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(todos), '待办事项');
    XLSX.writeFile(wb, `travel_checklist_${new Date().toISOString().slice(0,10)}.xlsx`);
    app.toast('已导出清单为 Excel', 'success');
  }
};
