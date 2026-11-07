/* ============================================================
   板块4：旅行花销记账台账
   字段：日期、分类、详情、金额、支付方式
   自动计算当日/总累计，临近预算上限主动超支提醒
   货币：内部以「台币(TWD)」为基准，澳币(AUD)、人民币(CNY) 按汇率折算；
        各目的地可在「显示币种」中勾选保留哪些货币（未勾选即从下拉中隐藏）。
   ============================================================ */

app.modules.expenses = {
  /* ====== 货币工具 ====== */
  // 货币符号：台币 ¥ / 澳币 A$ / 人民币 CN¥（用 CN¥ 区分人民币与台币的 ¥）
  symOf(cur) { return cur === 'AUD' ? 'A$' : cur === 'CNY' ? 'CN¥' : '¥'; },
  // 货币中文标签
  labelOf(cur) { return cur === 'AUD' ? '澳币 (A$)' : cur === 'CNY' ? '人民币 (CN¥)' : '台币 (NT$)'; },
  // 货币简称（用于导出）
  shortName(cur) { return cur === 'AUD' ? '澳币' : cur === 'CNY' ? '人民币' : '台币'; },
  // 某目的地「显示币种」列表（用于下拉与双币展示），至少保留一个，缺省全开
  visibleCurrencies(d) {
    let list = (d && Array.isArray(d.enabledCurrencies)) ? d.enabledCurrencies.slice() : ['TWD', 'AUD', 'CNY'];
    list = list.filter(c => ['TWD', 'AUD', 'CNY'].includes(c));
    return list.length ? list : ['TWD'];
  },
  // 原币金额 → 台币（基准）
  toTwd(amt, cur, d) {
    const rA = parseFloat(d && d.audToTwd) || 21;   // 1 澳币 = ? 台币
    const rC = parseFloat(d && d.cnyToTwd) || 4.5;  // 1 人民币 = ? 台币
    return cur === 'AUD' ? amt * rA : cur === 'CNY' ? amt * rC : amt;
  },
  // 台币 → 原币
  fromTwd(twd, cur, d) {
    const rA = parseFloat(d && d.audToTwd) || 21;
    const rC = parseFloat(d && d.cnyToTwd) || 4.5;
    return cur === 'AUD' ? twd / rA : cur === 'CNY' ? twd / rC : twd;
  },
  // 把台币值格式化成「¥…（≈ A$… / CN¥…）」文本（尊重显示币种，仅展示非台币的勾选币种）
  fmtTwd(twd, d) {
    const rA = parseFloat(d && d.audToTwd) || 21;
    const rC = parseFloat(d && d.cnyToTwd) || 4.5;
    const fromTwd = (t, c) => c === 'AUD' ? t / rA : c === 'CNY' ? t / rC : t;
    const others = this.visibleCurrencies(d).filter(c => c !== 'TWD');
    let s = `¥${twd.toFixed(0)}`;
    if (others.length) s += `（≈ ${others.map(c => `${this.symOf(c)}${fromTwd(twd, c).toFixed(0)}`).join(' / ')}）`;
    return s;
  },

  render() {
    const sec = document.querySelector('[data-section=expenses]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">${app.t('expense.title')}</div>
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>请先选择或创建目的地</h3>
            <p class="text-sm">前往「板块1」建立目的地档案后，再回到这里记账</p>
          </div>
        </div>
      `;
      return;
    }

    const expenses = (app.state[d.id]?.expenses || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const rateA = parseFloat(d.audToTwd) || 21;   // 1 澳币 = ? 台币
    const rateC = parseFloat(d.cnyToTwd) || 4.5;  // 1 人民币 = ? 台币
    const travelers = Math.max(1, parseFloat(d.travelers) || 1);          // 本次旅行人数
    const tripPeople = (Array.isArray(d.tripPeople) && d.tripPeople.length) ? d.tripPeople : ['我'];
    const vis = this.visibleCurrencies(d);
    // 计价：single=仅一人（不按人数翻倍）；total=总价；per=单人价格×旅行人数；旧数据无 priceType 回落原 people
    const toTwd = (amt, cur) => cur === 'AUD' ? amt * rateA : cur === 'CNY' ? amt * rateC : amt;
    const fromTwd = (twd, cur) => cur === 'AUD' ? twd / rateA : cur === 'CNY' ? twd / rateC : twd;
    const twdOf = (e) => {
      const unit = toTwd(parseFloat(e.amount) || 0, e.currency);
      if (e.single) return unit; // 仅一人：不乘旅行人数
      if (e.priceType === 'total') return unit;
      const mult = (e.priceType === undefined) ? (parseFloat(e.people) || 1) : travelers;
      return unit * mult;
    };
    const total = expenses.reduce((s, e) => s + twdOf(e), 0);

    // 逐项预算：每个 budget 项 { id, name, amount, currency, priceType }，汇总成台币
    const budgets = (app.state[d.id]?.budgets || []).slice();
    const bTwdOf = (b) => {
      const unit = toTwd(parseFloat(b.amount) || 0, b.currency);
      if (b.priceType === 'total') return unit;
      const mult = (b.priceType === undefined) ? (parseFloat(b.people) || 1) : travelers;
      return unit * mult;
    };
    const budget = app.getBudgetTotal(d.id);
    const pct = budget > 0 ? (total / budget) * 100 : 0;
    const remaining = budget - total;
    const pCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : '';
    const pColor = pct >= 100 ? '#b91c1c' : pct >= 80 ? '#ea580c' : '#10b981';
    // 双币展示：当前台币值 + 勾选的非台币币种等价（如 A$ / CN¥）
    const tailHtml = (twd) => {
      const others = vis.filter(c => c !== 'TWD');
      return others.length
        ? `<span class="text-tiny text-slate-500">≈ ${others.map(c => `${this.symOf(c)}${fromTwd(twd, c).toFixed(0)}`).join(' / ')}</span>`
        : '';
    };
    // 按原始币种展示，并标注其它勾选币种等价
    const dualAmt = (cur, amt) => {
      const v = parseFloat(amt) || 0;
      const twd = toTwd(v, cur);
      const targets = vis.filter(c => c !== cur);
      const prim = `${this.symOf(cur)}${v.toFixed(2)}`;
      return targets.length
        ? `${prim} <span class="text-tiny text-slate-500">≈ ${targets.map(c => `${this.symOf(c)}${fromTwd(twd, c).toFixed(0)}`).join(' / ')}</span>`
        : prim;
    };

    // 按分类汇总（以台币计）
    const byCat = {};
    expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + twdOf(e); });
    const catLabels = { 交通: '✈️', 住宿: '🏨', 门票: '🎫', 娱乐: '🎡', 拍照: '📷', 餐饮: '🍽️', 甜品: '🍰', 小吃: '🥟', 购物: '🛍️', 其他杂费: '💼' };
    const catColors = { 交通: '#0ea5e9', 住宿: '#10b981', 门票: '#8b5cf6', 娱乐: '#6366f1', 拍照: '#0d9488', 餐饮: '#f59e0b', 甜品: '#d946ef', 小吃: '#f97316', 购物: '#ec4899', 其他杂费: '#64748b' };

    // 按日汇总（以台币计）
    const byDay = {};
    expenses.forEach(e => { if (e.date) byDay[e.date] = (byDay[e.date] || 0) + twdOf(e); });

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>${app.t('expense.title')}</span>
          <div class="ml-auto flex gap-2 items-center flex-wrap">
            <label class="text-xs text-slate-500 whitespace-nowrap">💱 ${app.t('expense.rateLabel')}</label>
            <span class="text-xs text-slate-500 whitespace-nowrap">1 澳币 =</span>
            <input id="expRate" type="number" min="0" step="0.1" value="${rateA}" class="w-16 text-sm border border-slate-300 rounded px-2 py-1" onchange="app.modules.expenses.saveRate(this.value)" title="1 澳币折合多少台币" />
            <span class="text-xs text-slate-500">台币</span>
            <span class="text-xs text-slate-500 whitespace-nowrap">1 人民币 =</span>
            <input id="expCnyRate" type="number" min="0" step="0.1" value="${rateC}" class="w-16 text-sm border border-slate-300 rounded px-2 py-1" onchange="app.modules.expenses.saveCnyRate(this.value)" title="1 人民币折合多少台币" />
            <span class="text-xs text-slate-500">台币</span>
            <button class="btn btn-primary" onclick="app.modules.expenses.addExp()">${app.t('expense.add')}</button>
            <button class="btn btn-success" onclick="app.modules.expenses.exportXlsx()">${app.t('expense.export')}</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          当前目的地：<strong class="text-sky-700">${app.destName(d)}</strong>　·　共 <strong>${expenses.length}</strong> 笔消费
        </p>

        <!-- 旅行设置：本次旅行人数 + 出行人 + 显示币种 -->
        <div class="mb-4 p-4 rounded-lg border border-slate-200 bg-slate-50/70">
          <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div class="flex items-center gap-2">
              <label class="text-sm font-semibold text-slate-700">👥 本次旅行人数</label>
              <input id="expTravelers" type="number" min="1" step="1" value="${travelers}" class="w-16 text-sm border border-slate-300 rounded px-2 py-1" onchange="app.modules.expenses.saveTravelers(this.value)" title="用于把「单人价格」乘以人数得到总价，以及计算每人均价" />
              <span class="text-xs text-slate-500">人</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <label class="text-sm font-semibold text-slate-700">出行人</label>
              ${tripPeople.map((p, i) => `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-xs">
                  ${p}
                  <button type="button" class="text-sky-500 hover:text-sky-800" title="移除" onclick="app.modules.expenses.removePerson(${i})">✕</button>
                </span>`).join('')}
              <input id="expNewPerson" placeholder="输入人名" class="w-24 text-sm border border-slate-300 rounded px-2 py-1" />
              <button class="btn btn-ghost btn-sm" onclick="app.modules.expenses.addPerson()">＋ 添加</button>
            </div>
          </div>
          <div class="flex items-center gap-4 flex-wrap mt-3 pt-3 border-t border-slate-200">
            <label class="text-sm font-semibold text-slate-700">💱 显示币种</label>
            ${['TWD', 'AUD', 'CNY'].map(c => `<label class="inline-flex items-center gap-1 text-xs text-slate-600 cursor-pointer"><input type="checkbox" data-cur="${c}" ${vis.includes(c) ? 'checked' : ''} onchange="app.modules.expenses.saveVisibleCurrencies()" /> ${this.labelOf(c)}</label>`).join('')}
            <span class="text-xs text-slate-400">（取消勾选即从记账/预算的货币下拉中隐藏，已有记录不受影响）</span>
          </div>
        </div>

        <!-- 预算明细（逐项添加，可选项货币） -->
        <div class="mb-4 p-4 rounded-lg border border-indigo-200 bg-indigo-50/40">
          <div class="flex items-center justify-between mb-3">
            <div class="font-semibold text-slate-700 text-sm">💰 ${app.t('expense.budgetTitle')}</div>
            <button class="btn btn-primary btn-sm" onclick="app.modules.expenses.addBudget()">${app.t('expense.budgetAdd')}</button>
          </div>
          ${budgets.length === 0 ? `
            <div class="text-sm text-slate-600">
              ${parseFloat(d.budget) > 0
                ? `当前使用「整体总预算 ${this.fmtTwd(parseFloat(d.budget) || 0, d)}」，可将其转为逐项预算：<button class="btn btn-ghost btn-sm ml-2" onclick="app.modules.expenses.migrateLegacyBudget()">${app.t('expense.budgetMigrate')}</button>`
                : `📝 ${app.t('expense.budgetEmpty')} — ${app.t('expense.budgetNoItem')}`}
            </div>
          ` : `
            <div class="overflow-x-auto">
              <table class="data-table">
                <thead><tr><th>预算项</th><th>货币</th><th>金额</th><th>计价</th><th>折合台币</th><th>操作</th></tr></thead>
                <tbody>
                  ${budgets.map(b => `
                    <tr>
                      <td>${b.name || '-'}</td>
                      <td>${this.labelOf(b.currency)}</td>
                      <td class="font-semibold">${dualAmt(b.currency, b.amount)}</td>
                      <td><span class="badge ${b.priceType === 'total' ? 'badge-other' : 'badge-hotel'}">${b.priceType === 'total' ? '总价' : '单人'}</span></td>
                      <td class="text-slate-600">¥${bTwdOf(b).toFixed(0)} ${tailHtml(bTwdOf(b))}</td>
                      <td>
                        <button class="btn btn-ghost btn-sm" onclick="app.modules.expenses.editBudget('${b.id}')">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="app.modules.expenses.removeBudget('${b.id}')">🗑️</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr style="background:#f1f5f9;font-weight:600">
                    <td colspan="4" class="text-right">${app.t('expense.budgetTotal')}（台币 · ${travelers} 人）</td>
                    <td>¥${budget.toFixed(2)} ${tailHtml(budget).replace(/^/, '≈ ')}　·　每人 ¥${(budget / travelers).toFixed(0)} ${tailHtml(budget / travelers)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          `}
        </div>

        <!-- 预算总览 -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div class="p-4 bg-gradient-to-br from-sky-50 to-sky-100 rounded-lg border border-sky-200">
            <div class="text-xs text-sky-700 font-semibold">💰 总预算（${travelers} 人）</div>
            <div class="text-2xl font-bold text-sky-800">¥${budget.toFixed(0)} ${tailHtml(budget)}</div>
            <div class="text-xs text-sky-600 mt-0.5">每人 ¥${(budget / travelers).toFixed(0)} ${tailHtml(budget / travelers)}</div>
          </div>
          <div class="p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg border border-orange-200">
            <div class="text-xs text-orange-700 font-semibold">📊 已支出（${travelers} 人）</div>
            <div class="text-2xl font-bold text-orange-800">¥${total.toFixed(0)} ${tailHtml(total)}</div>
            <div class="text-xs text-orange-600 mt-0.5">每人 ¥${(total / travelers).toFixed(0)} ${tailHtml(total / travelers)}</div>
          </div>
          <div class="p-4 rounded-lg border" style="${remaining >= 0 ? 'background:#ecfdf5;border-color:#a7f3d0;' : 'background:#fef2f2;border-color:#fecaca;'}">
            <div class="text-xs font-semibold" style="color:${remaining >= 0 ? '#047857' : '#b91c1c'}">${remaining >= 0 ? '💵 剩余预算' : '⚠️ 超支金额'}</div>
            <div class="text-2xl font-bold" style="color:${remaining >= 0 ? '#065f46' : '#991b1b'}">¥${Math.abs(remaining).toFixed(0)} ${tailHtml(Math.abs(remaining))}</div>
          </div>
          <div class="p-4 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg border border-indigo-200">
            <div class="text-xs text-indigo-700 font-semibold">📈 预算占用</div>
            <div class="text-2xl font-bold" style="color:${pColor}">${pct.toFixed(1)}%</div>
          </div>
        </div>

        <div class="budget-bar mb-4">
          <div class="budget-bar-fill ${pCls}" style="width:${Math.min(100, pct)}%"></div>
        </div>
        ${pct >= 80 && pct < 100 ? `<div class="p-3 bg-amber-50 border border-amber-200 rounded mb-3 text-sm">⚠️ <strong>提醒：</strong>预算已使用 ${pct.toFixed(0)}%，请注意控制消费。</div>` : ''}
        ${pct >= 100 ? `<div class="p-3 bg-red-50 border border-red-200 rounded mb-3 text-sm">🚨 <strong>超支警告：</strong>${this.fmtTwd(Math.abs(remaining), d)}，建议减少非必要消费。</div>` : ''}

        <!-- 分类汇总 -->
        ${expenses.length > 0 ? `
          <h4 class="font-semibold text-slate-700 text-sm mb-2 mt-4">📊 按分类汇总</h4>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            ${Object.entries(byCat).map(([cat, amt]) => `
              <div class="p-3 rounded-lg border" style="background:${catColors[cat]}15; border-color:${catColors[cat]}40">
                <div class="text-xs" style="color:${catColors[cat]}">${catLabels[cat] || '📌'} ${cat}</div>
                <div class="text-lg font-bold" style="color:${catColors[cat]}">¥${amt.toFixed(0)} ${tailHtml(amt)}</div>
                <div class="text-tiny text-slate-500">${((amt/total)*100).toFixed(1)}%</div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- 明细表 -->
        <h4 class="font-semibold text-slate-700 text-sm mb-2 mt-4">📋 消费明细</h4>
        ${expenses.length === 0 ? `
          <div class="empty-state">
            <div class="icon">💸</div>
            <h3>还没有消费记录</h3>
            <p class="text-sm">点击「➕ 记一笔」开始记录旅途中的每一笔消费</p>
          </div>
        ` : `
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr><th>日期</th><th>分类</th><th>详情</th><th>金额</th><th>计价</th><th>付款人</th><th>支付方式</th><th>操作</th></tr>
              </thead>
              <tbody>
                ${expenses.map(e => {
                  const cur = e.currency || 'TWD';
                  const amt = parseFloat(e.amount) || 0;
                  const twd = twdOf(e);
                  return `
                  <tr>
                    <td class="text-tiny">${e.date || '-'}</td>
                    <td>${catLabels[e.category] || ''} ${e.category}</td>
                    <td>${e.detail || '-'}${e.merchant ? ` <span class="text-tiny text-slate-500">· ${e.merchant}</span>` : ''}</td>
                    <td class="font-semibold">${dualAmt(cur, amt)}</td>
                    <td><span class="badge ${e.single ? 'badge-shop' : e.priceType === 'total' ? 'badge-other' : 'badge-hotel'}">${e.single ? '仅一人' : e.priceType === 'total' ? '总价' : '单人'}</span></td>
                    <td class="text-tiny">${e.paidBy || '-'}</td>
                    <td class="text-tiny">${e.payment || '-'}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm" onclick="app.modules.expenses.editExp('${e.id}')">✏️</button>
                      <button class="btn btn-danger btn-sm" onclick="app.modules.expenses.removeExp('${e.id}')">🗑️</button>
                    </td>
                  </tr>
                `;
                }).join('')}
              </tbody>
              <tfoot>
                <tr style="background:#f1f5f9;font-weight:600">
                  <td colspan="3" class="text-right">合计（台币 · ${travelers} 人）</td>
                  <td>¥${total.toFixed(2)} ${tailHtml(total).replace(/^/, '≈ ')}　·　每人 ¥${(total / travelers).toFixed(0)} ${tailHtml(total / travelers)}</td>
                  <td colspan="4"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        `}
      </div>
    `;
  },

  addExp() {
    const d = app.getActiveDestination();
    if (!d) return app.toast('请先选择目的地', 'warning');
    this.openForm();
  },

  editExp(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const exp = (app.state[d.id]?.expenses || []).find(x => x.id === id);
    if (!exp) return;
    this.openForm(exp);
  },

  // 生成货币下拉选项（仅显示勾选币种；若已有记录用了被隐藏的币种，仍保留该行可选）
  currencyOptions(existingCur) {
    const d = app.getActiveDestination();
    const vis = this.visibleCurrencies(d);
    const cur = existingCur || vis[0] || 'TWD';
    const opts = vis.includes(cur) ? vis.slice() : Array.from(new Set([...vis, cur]));
    return opts.map(c => `<option value="${c}" ${cur === c ? 'selected' : ''}>${this.labelOf(c)}</option>`).join('');
  },

  openForm(existing = null) {
    const e = existing || {};
    const d = app.getActiveDestination();
    const tripPeople = (d && Array.isArray(d.tripPeople) && d.tripPeople.length) ? d.tripPeople : ['我'];
    const curSel = e.currency || (this.visibleCurrencies(d)[0]) || 'TWD';
    const html = `
      <div class="form-grid">
        <div class="form-field">
          <label>消费日期 <span class="req">*</span></label>
          <input type="date" id="e_date" value="${e.date || app.today()}" />
        </div>
        <div class="form-field">
          <label>消费分类 <span class="req">*</span></label>
          <select id="e_cat">
            <option ${e.category==='交通'?'selected':''}>交通</option>
            <option ${e.category==='住宿'?'selected':''}>住宿</option>
            <option ${e.category==='门票'?'selected':''}>门票</option>
            <option ${e.category==='娱乐'?'selected':''}>娱乐</option>
            <option ${e.category==='拍照'?'selected':''}>拍照</option>
            <option ${e.category==='餐饮'?'selected':''}>餐饮</option>
            <option ${e.category==='甜品'?'selected':''}>甜品</option>
            <option ${e.category==='小吃'?'selected':''}>小吃</option>
            <option ${e.category==='购物'?'selected':''}>购物</option>
            <option ${e.category==='其他杂费'?'selected':'' || !e.category?'selected':''}>其他杂费</option>
          </select>
        </div>
        <div class="form-field col-span-2">
          <label>消费详情 <span class="req">*</span></label>
          <input id="e_detail" value="${e.detail || ''}" placeholder="如：东京塔门票 / 京都到大阪新干线" />
        </div>
        <div class="form-field">
          <label>商家名称</label>
          <input id="e_merchant" value="${e.merchant || ''}" placeholder="如：7-11 / 全家 / 高岛屋" />
        </div>
        <div class="form-field">
          <label>消费货币 <span class="req">*</span></label>
          <select id="e_currency" onchange="app.modules.expenses.updatePreview()">
            ${this.currencyOptions(e.currency)}
          </select>
        </div>
        <div class="form-field">
          <label>单笔金额 <span class="req">*</span></label>
          <input type="number" id="e_amount" value="${e.amount || ''}" min="0" step="0.01" oninput="app.modules.expenses.updatePreview()" />
          <div class="text-tiny text-slate-500 mt-1" id="e_twd_prev"></div>
        </div>
        <div class="form-field">
          <label>支付方式</label>
          <select id="e_payment">
            <option ${e.payment==='现金'?'selected':''}>现金</option>
            <option ${e.payment==='信用卡'?'selected':''}>信用卡</option>
            <option ${e.payment==='支付宝'?'selected':''}>支付宝</option>
            <option ${e.payment==='微信'?'selected':''}>微信</option>
            <option ${e.payment==='Apple Pay'?'selected':''}>Apple Pay</option>
            <option ${e.payment==='日元/美元/欧元'?'selected':''}>外币</option>
            <option ${e.payment==='AMEX'?'selected':''}>AMEX</option>
            <option ${e.payment==='UP'?'selected':''}>UP</option>
            <option ${e.payment==='2UP'?'selected':''}>2UP</option>
            <option ${e.payment==='CommBank'?'selected':''}>CommBank</option>
            <option ${e.payment==='Wise'?'selected':''}>Wise</option>
            <option ${!e.payment?'selected':''}>其他</option>
          </select>
        </div>
        <div class="form-field">
          <label>计价方式</label>
          <select id="e_priceType" onchange="app.modules.expenses.updatePreview()">
            <option value="per" ${e.priceType !== 'total' ? 'selected' : ''}>单人价格（× 本次旅行人数）</option>
            <option value="total" ${e.priceType === 'total' ? 'selected' : ''}>总价（已含全部人）</option>
          </select>
        </div>
        <div class="form-field col-span-full">
          <label style="display:flex;align-items:center;gap:0.5rem;font-weight:400;text-transform:none;color:#334155;cursor:pointer;">
            <input type="checkbox" id="e_single" ${e.single ? 'checked' : ''} />
            🙋 仅一人（不按旅行人数翻倍，例如给自己买的伴手礼；可在「谁付的款」选自己）
          </label>
        </div>
        <div class="form-field">
          <label>谁付的款</label>
          <select id="e_paidby">
            ${tripPeople.map(p => `<option value="${p}" ${e.paidBy === p ? 'selected' : ''}>${p}</option>`).join('')}
            ${e.paidBy && !tripPeople.includes(e.paidBy) ? `<option value="${e.paidBy}" selected>${e.paidBy}</option>` : ''}
          </select>
        </div>
      </div>
    `;
    app.openModal(existing ? '✏️ 编辑消费' : '➕ 记一笔消费', html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.expenses.save('${e.id || ''}')` }
    ]);
    setTimeout(() => this.updatePreview(), 0);
  },

  updatePreview() {
    const amtEl = document.getElementById('e_amount');
    const curEl = document.getElementById('e_currency');
    const priceEl = document.getElementById('e_priceType');
    const singleEl = document.getElementById('e_single');
    const prev = document.getElementById('e_twd_prev');
    if (!amtEl || !curEl || !prev) return;
    const d = app.getActiveDestination();
    const rateA = parseFloat(d && d.audToTwd) || 21;
    const rateC = parseFloat(d && d.cnyToTwd) || 4.5;
    const travelers = Math.max(1, parseFloat(d && d.travelers) || 1);
    const amt = parseFloat(amtEl.value) || 0;
    const cur = curEl.value;
    const unit = cur === 'AUD' ? amt * rateA : cur === 'CNY' ? amt * rateC : amt;
    const isTotal = priceEl && priceEl.value === 'total';
    const isSingle = singleEl && singleEl.checked;
    const rateNote = cur !== 'TWD' ? `（1 ${this.shortName(cur)} = ${cur === 'AUD' ? rateA : rateC} 台币）` : '';
    prev.textContent = amt > 0
      ? (isSingle
          ? `🙋 仅一人：总额 ≈ 台币 ¥${unit.toFixed(0)}（不乘 ${travelers} 人${rateNote}）`
          : isTotal
            ? `💱 总价 ≈ 台币 ¥${unit.toFixed(0)}（已含 ${travelers} 人，每人 ≈ ¥${(unit / travelers).toFixed(0)}）`
            : `💱 单人 ≈ 台币 ¥${unit.toFixed(0)}　·　${travelers} 人合计 ≈ 台币 ¥${(unit * travelers).toFixed(0)}${rateNote}`)
      : '';
  },

  save(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const date = document.getElementById('e_date').value;
    const detail = document.getElementById('e_detail').value.trim();
    const amount = parseFloat(document.getElementById('e_amount').value);
    if (!date) return app.toast('请填写日期', 'warning');
    if (!detail) return app.toast('请填写详情', 'warning');
    if (!amount || amount < 0) return app.toast('请填写有效金额', 'warning');

    const data = {
      date, detail, amount,
      currency: document.getElementById('e_currency').value,
      category: document.getElementById('e_cat').value,
      payment: document.getElementById('e_payment').value,
      priceType: document.getElementById('e_priceType').value,
      single: document.getElementById('e_single') ? document.getElementById('e_single').checked : false,
      merchant: document.getElementById('e_merchant').value.trim(),
      paidBy: document.getElementById('e_paidby').value
    };

    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].expenses) app.state[d.id].expenses = [];
    if (id) {
      const idx = app.state[d.id].expenses.findIndex(x => x.id === id);
      if (idx >= 0) app.state[d.id].expenses[idx] = { ...app.state[d.id].expenses[idx], ...data };
    } else {
      app.state[d.id].expenses.push({ id: 'ex_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ...data });
    }
    app.saveState();
    app.closeModal();
    this.render();
    // 检查预算
    this.checkBudget();
    app.toast('消费已记录', 'success');
  },

  saveRate(val) {
    const d = app.getActiveDestination();
    if (!d) return;
    const r = parseFloat(val);
    if (!r || r <= 0) return app.toast('汇率需为正数', 'warning');
    d.audToTwd = r;
    app.saveState();
    this.render();
  },

  saveCnyRate(val) {
    const d = app.getActiveDestination();
    if (!d) return;
    const r = parseFloat(val);
    if (!r || r <= 0) return app.toast('汇率需为正数', 'warning');
    d.cnyToTwd = r;
    app.saveState();
    this.render();
  },

  saveVisibleCurrencies() {
    const d = app.getActiveDestination();
    if (!d) return;
    const enabled = ['TWD', 'AUD', 'CNY'].filter(c => {
      const el = document.querySelector(`input[data-cur="${c}"]`);
      return el ? el.checked : true;
    });
    d.enabledCurrencies = enabled.length ? enabled : ['TWD'];
    app.saveState();
    this.render();
  },

  removeExp(id) {
    const d = app.getActiveDestination();
    if (!d || !confirm('确定删除该消费记录？')) return;
    if (app.state[d.id]?.expenses) {
      app.state[d.id].expenses = app.state[d.id].expenses.filter(x => x.id !== id);
      app.saveState();
      this.render();
    }
  },

  /* ====== 旅行设置：本次旅行人数 + 出行人 ====== */
  saveTravelers(val) {
    const d = app.getActiveDestination();
    if (!d) return;
    const n = parseInt(val, 10);
    if (!n || n < 1) return app.toast('旅行人数至少为 1', 'warning');
    d.travelers = n;
    app.saveState();
    this.render();
  },

  addPerson() {
    const d = app.getActiveDestination();
    if (!d) return;
    const input = document.getElementById('expNewPerson');
    const name = input && input.value.trim();
    if (!name) return;
    if (!Array.isArray(d.tripPeople)) d.tripPeople = [];
    if (d.tripPeople.includes(name)) { app.toast('该出行人已存在', 'warning'); return; }
    d.tripPeople.push(name);
    app.saveState();
    this.render();
    app.toast(`已添加出行人「${name}」`, 'success');
  },

  removePerson(i) {
    const d = app.getActiveDestination();
    if (!d || !Array.isArray(d.tripPeople)) return;
    d.tripPeople.splice(i, 1);
    if (d.tripPeople.length === 0) d.tripPeople = ['我'];
    app.saveState();
    this.render();
  },

  /* ====== 逐项预算 ====== */
  addBudget() {
    const d = app.getActiveDestination();
    if (!d) return app.toast('请先选择目的地', 'warning');
    this.openBudgetForm();
  },

  editBudget(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const b = (app.state[d.id]?.budgets || []).find(x => x.id === id);
    if (!b) return;
    this.openBudgetForm(b);
  },

  openBudgetForm(existing = null) {
    const b = existing || {};
    const html = `
      <div class="form-grid">
        <div class="form-field col-span-full">
          <label>预算项名称 <span class="req">*</span></label>
          <input id="b_name" value="${b.name || ''}" placeholder="例如：机票预算 / 酒店预算 / 餐饮预算" />
        </div>
        <div class="form-field">
          <label>货币 <span class="req">*</span></label>
          <select id="b_currency" onchange="app.modules.expenses.updateBudgetPreview()">
            ${this.currencyOptions(b.currency)}
          </select>
        </div>
        <div class="form-field">
          <label>金额 <span class="req">*</span></label>
          <input type="number" id="b_amount" value="${b.amount || ''}" min="0" step="0.01" oninput="app.modules.expenses.updateBudgetPreview()" />
          <div class="text-tiny text-slate-500 mt-1" id="b_twd_prev"></div>
        </div>
        <div class="form-field">
          <label>计价方式</label>
          <select id="b_priceType" onchange="app.modules.expenses.updateBudgetPreview()">
            <option value="per" ${b.priceType !== 'total' ? 'selected' : ''}>单人价格（× 本次旅行人数）</option>
            <option value="total" ${b.priceType === 'total' ? 'selected' : ''}>总价（已含全部人）</option>
          </select>
        </div>
      </div>
    `;
    app.openModal(existing ? '✏️ 编辑预算项' : '➕ 添加预算项', html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.expenses.saveBudget('${b.id || ''}')` }
    ]);
    setTimeout(() => this.updateBudgetPreview(), 0);
  },

  updateBudgetPreview() {
    const amtEl = document.getElementById('b_amount');
    const curEl = document.getElementById('b_currency');
    const priceEl = document.getElementById('b_priceType');
    const prev = document.getElementById('b_twd_prev');
    if (!amtEl || !curEl || !prev) return;
    const d = app.getActiveDestination();
    const rateA = parseFloat(d && d.audToTwd) || 21;
    const rateC = parseFloat(d && d.cnyToTwd) || 4.5;
    const travelers = Math.max(1, parseFloat(d && d.travelers) || 1);
    const amt = parseFloat(amtEl.value) || 0;
    const cur = curEl.value;
    const unit = cur === 'AUD' ? amt * rateA : cur === 'CNY' ? amt * rateC : amt;
    const isTotal = priceEl && priceEl.value === 'total';
    const rateNote = cur !== 'TWD' ? `（1 ${this.shortName(cur)} = ${cur === 'AUD' ? rateA : rateC} 台币）` : '';
    prev.textContent = amt > 0
      ? (isTotal
          ? `💱 总价 ≈ 台币 ¥${unit.toFixed(0)}（已含 ${travelers} 人，每人 ≈ ¥${(unit / travelers).toFixed(0)}）`
          : `💱 单人 ≈ 台币 ¥${unit.toFixed(0)}　·　${travelers} 人合计 ≈ 台币 ¥${(unit * travelers).toFixed(0)}${rateNote}`)
      : '';
  },

  saveBudget(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const name = document.getElementById('b_name').value.trim();
    const amount = parseFloat(document.getElementById('b_amount').value);
    if (!name) return app.toast('请填写预算项名称', 'warning');
    if (!amount || amount < 0) return app.toast('请填写有效金额', 'warning');

    const data = {
      name,
      amount,
      currency: document.getElementById('b_currency').value,
      priceType: document.getElementById('b_priceType').value
    };

    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].budgets) app.state[d.id].budgets = [];
    if (id) {
      const idx = app.state[d.id].budgets.findIndex(x => x.id === id);
      if (idx >= 0) app.state[d.id].budgets[idx] = { ...app.state[d.id].budgets[idx], ...data };
    } else {
      app.state[d.id].budgets.push({ id: 'bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ...data });
    }
    app.saveState();
    app.closeModal();
    this.render();
    app.toast('预算项已保存', 'success');
  },

  removeBudget(id) {
    const d = app.getActiveDestination();
    if (!d || !confirm('确定删除该预算项？')) return;
    if (app.state[d.id]?.budgets) {
      app.state[d.id].budgets = app.state[d.id].budgets.filter(x => x.id !== id);
      app.saveState();
      this.render();
    }
  },

  migrateLegacyBudget() {
    const d = app.getActiveDestination();
    if (!d) return;
    const legacy = parseFloat(d.budget) || 0;
    if (legacy <= 0) return;
    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].budgets) app.state[d.id].budgets = [];
    app.state[d.id].budgets.push({ id: 'bg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: '整体预算', amount: legacy, currency: 'TWD' });
    app.saveState();
    this.render();
    app.toast('已把原总预算转为一条预算项，可继续逐项添加', 'success');
  },

  checkBudget() {
    const d = app.getActiveDestination();
    if (!d) return;
    const total = app.getExpensesTotal(d.id);
    const budget = app.getBudgetTotal(d.id);
    if (budget > 0) {
      const pct = (total / budget) * 100;
      if (pct >= 100) {
        app.toast(`🚨 预算已超！当前已花 ${this.fmtTwd(total, d)}，超出预算 ${this.fmtTwd(total - budget, d)}`, 'error', 6000);
      } else if (pct >= 80) {
        app.toast(`⚠️ 预算使用已达 ${pct.toFixed(0)}%，请注意控制`, 'warning', 5000);
      }
    }
  },

  exportXlsx() {
    const d = app.getActiveDestination();
    if (!d) return;
    const expenses = app.state[d.id]?.expenses || [];
    if (expenses.length === 0) return app.toast('暂无消费记录', 'warning');

    const rateA = parseFloat(d.audToTwd) || 21;
    const rateC = parseFloat(d.cnyToTwd) || 4.5;
    const travelers = Math.max(1, parseFloat(d.travelers) || 1);
    const toTwd = (amt, cur) => cur === 'AUD' ? amt * rateA : cur === 'CNY' ? amt * rateC : amt;
    const twdOf = (e) => {
      const unit = toTwd(parseFloat(e.amount) || 0, e.currency);
      if (e.single) return unit;
      if (e.priceType === 'total') return unit;
      const mult = (e.priceType === undefined) ? (parseFloat(e.people) || 1) : travelers;
      return unit * mult;
    };
    const rows = expenses.map(e => ({
      日期: e.date, 分类: e.category, 详情: e.detail,
      货币: this.shortName(e.currency), 原金额: e.amount, 计价: e.single ? '仅我' : e.priceType === 'total' ? '总价' : '单人',
      台币: Math.round(twdOf(e)), 商家: e.merchant || '', 付款人: e.paidBy || '', 支付方式: e.payment
    }));
    const totalTwd = expenses.reduce((s, e) => s + twdOf(e), 0);
    rows.push({ 日期: '', 分类: '合计', 详情: '', 货币: '', 原金额: '', 台币: Math.round(totalTwd), 支付方式: '' });
    if (typeof XLSX === 'undefined') { app.downloadCSV(`expense_${app.destName(d)}_${new Date().toISOString().slice(0,10)}.csv`, rows); return; }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `${app.destName(d)}-花销`);
    XLSX.writeFile(wb, `expense_${app.destName(d)}_${new Date().toISOString().slice(0,10)}.xlsx`);
    app.toast('已导出花销为 Excel', 'success');
  }
};
