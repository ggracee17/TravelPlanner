/* ============================================================
   板块4：旅行花销记账台账
   字段：日期、分类、详情、金额、支付方式
   自动计算当日/总累计，临近预算上限主动超支提醒
   ============================================================ */

app.modules.expenses = {
  render() {
    const sec = document.querySelector('[data-section=expenses]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">💰 板块4 · 旅行花销记账台账</div>
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
    const total = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const budget = parseFloat(d.budget) || 0;
    const pct = budget > 0 ? (total / budget) * 100 : 0;
    const remaining = budget - total;
    const pCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : '';
    const pColor = pct >= 100 ? '#b91c1c' : pct >= 80 ? '#ea580c' : '#10b981';

    // 按分类汇总
    const byCat = {};
    expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + (parseFloat(e.amount) || 0); });
    const catLabels = { 交通: '✈️', 住宿: '🏨', 门票: '🎫', 餐饮: '🍽️', 购物: '🛍️', 其他杂费: '💼' };
    const catColors = { 交通: '#0ea5e9', 住宿: '#10b981', 门票: '#8b5cf6', 餐饮: '#f59e0b', 购物: '#ec4899', 其他杂费: '#64748b' };

    // 按日汇总
    const byDay = {};
    expenses.forEach(e => { if (e.date) byDay[e.date] = (byDay[e.date] || 0) + (parseFloat(e.amount) || 0); });

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>💰 板块4 · 旅行花销记账台账</span>
          <div class="ml-auto flex gap-2">
            <button class="btn btn-primary" onclick="app.modules.expenses.addExp()">➕ 记一笔</button>
            <button class="btn btn-success" onclick="app.modules.expenses.exportXlsx()">📥 导出 Excel</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          当前目的地：<strong class="text-sky-700">${app.destName(d)}</strong>　·　共 <strong>${expenses.length}</strong> 笔消费
        </p>

        <!-- 预算总览 -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div class="p-4 bg-gradient-to-br from-sky-50 to-sky-100 rounded-lg border border-sky-200">
            <div class="text-xs text-sky-700 font-semibold">💰 总预算</div>
            <div class="text-2xl font-bold text-sky-800">¥${budget.toFixed(0)}</div>
          </div>
          <div class="p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg border border-orange-200">
            <div class="text-xs text-orange-700 font-semibold">📊 已支出</div>
            <div class="text-2xl font-bold text-orange-800">¥${total.toFixed(0)}</div>
          </div>
          <div class="p-4 rounded-lg border" style="${remaining >= 0 ? 'background:#ecfdf5;border-color:#a7f3d0;' : 'background:#fef2f2;border-color:#fecaca;'}">
            <div class="text-xs font-semibold" style="color:${remaining >= 0 ? '#047857' : '#b91c1c'}">${remaining >= 0 ? '💵 剩余预算' : '⚠️ 超支金额'}</div>
            <div class="text-2xl font-bold" style="color:${remaining >= 0 ? '#065f46' : '#991b1b'}">¥${Math.abs(remaining).toFixed(0)}</div>
          </div>
          <div class="p-4 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg border border-indigo-200">
            <div class="text-xs text-indigo-700 font-semibold">📈 预算占用</div>
            <div class="text-2xl font-bold" style="color:${pColor}">${pct.toFixed(1)}%</div>
          </div>
        </div>

        <div class="budget-bar mb-4">
          <div class="budget-bar-fill ${pCls}" style="width:${Math.min(100, pct)}%"></div>
        </div>
        ${pct >= 80 && pct < 100 ? '<div class="p-3 bg-amber-50 border border-amber-200 rounded mb-3 text-sm">⚠️ <strong>提醒：</strong>预算已使用 ${pct.toFixed(0)}%，请注意控制消费。</div>' : ''}
        ${pct >= 100 ? '<div class="p-3 bg-red-50 border border-red-200 rounded mb-3 text-sm">🚨 <strong>超支警告：</strong>已超出预算 ¥${(-remaining).toFixed(0)}，建议减少非必要消费。</div>' : ''}

        <!-- 分类汇总 -->
        ${expenses.length > 0 ? `
          <h4 class="font-semibold text-slate-700 text-sm mb-2 mt-4">📊 按分类汇总</h4>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            ${Object.entries(byCat).map(([cat, amt]) => `
              <div class="p-3 rounded-lg border" style="background:${catColors[cat]}15; border-color:${catColors[cat]}40">
                <div class="text-xs" style="color:${catColors[cat]}">${catLabels[cat] || '📌'} ${cat}</div>
                <div class="text-lg font-bold" style="color:${catColors[cat]}">¥${amt.toFixed(0)}</div>
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
                <tr><th>日期</th><th>分类</th><th>详情</th><th>金额</th><th>支付方式</th><th>操作</th></tr>
              </thead>
              <tbody>
                ${expenses.map(e => `
                  <tr>
                    <td class="text-tiny">${e.date || '-'}</td>
                    <td>${catLabels[e.category] || ''} ${e.category}</td>
                    <td>${e.detail || '-'}</td>
                    <td class="font-semibold">¥${(parseFloat(e.amount) || 0).toFixed(2)}</td>
                    <td class="text-tiny">${e.payment || '-'}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm" onclick="app.modules.expenses.editExp('${e.id}')">✏️</button>
                      <button class="btn btn-danger btn-sm" onclick="app.modules.expenses.removeExp('${e.id}')">🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background:#f1f5f9;font-weight:600">
                  <td colspan="3" class="text-right">合计</td>
                  <td>¥${total.toFixed(2)}</td>
                  <td colspan="2"></td>
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

  openForm(existing = null) {
    const e = existing || {};
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
            <option ${e.category==='餐饮'?'selected':''}>餐饮</option>
            <option ${e.category==='购物'?'selected':''}>购物</option>
            <option ${e.category==='其他杂费'?'selected':'' || !e.category?'selected':''}>其他杂费</option>
          </select>
        </div>
        <div class="form-field col-span-full">
          <label>消费详情 <span class="req">*</span></label>
          <input id="e_detail" value="${e.detail || ''}" placeholder="如：东京塔门票 / 京都到大阪新干线" />
        </div>
        <div class="form-field">
          <label>单笔金额 (¥) <span class="req">*</span></label>
          <input type="number" id="e_amount" value="${e.amount || ''}" min="0" step="0.01" />
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
            <option ${!e.payment?'selected':''}>其他</option>
          </select>
        </div>
      </div>
    `;
    app.openModal(existing ? '✏️ 编辑消费' : '➕ 记一笔消费', html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: `app.modules.expenses.save('${e.id || ''}')` }
    ]);
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
      category: document.getElementById('e_cat').value,
      payment: document.getElementById('e_payment').value
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

  removeExp(id) {
    const d = app.getActiveDestination();
    if (!d || !confirm('确定删除该消费记录？')) return;
    if (app.state[d.id]?.expenses) {
      app.state[d.id].expenses = app.state[d.id].expenses.filter(x => x.id !== id);
      app.saveState();
      this.render();
    }
  },

  checkBudget() {
    const d = app.getActiveDestination();
    if (!d) return;
    const total = app.getExpensesTotal(d.id);
    const budget = parseFloat(d.budget) || 0;
    if (budget > 0) {
      const pct = (total / budget) * 100;
      if (pct >= 100) {
        app.toast(`🚨 预算已超！当前已花 ¥${total.toFixed(0)}，超出预算 ¥${(total - budget).toFixed(0)}`, 'error', 6000);
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

    const rows = expenses.map(e => ({
      日期: e.date, 分类: e.category, 详情: e.detail,
      金额: e.amount, 支付方式: e.payment
    }));
    const total = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    rows.push({ 日期: '', 分类: '合计', 详情: '', 金额: total, 支付方式: '' });
    if (typeof XLSX === 'undefined') { app.downloadCSV(`expense_${app.destName(d)}_${new Date().toISOString().slice(0,10)}.csv`, rows); return; }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `${app.destName(d)}-花销`);
    XLSX.writeFile(wb, `expense_${app.destName(d)}_${new Date().toISOString().slice(0,10)}.xlsx`);
    app.toast('已导出花销为 Excel', 'success');
  }
};
