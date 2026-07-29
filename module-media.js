/* ============================================================
   板块5：图文素材归档区
   存储：风景照片、酒店实拍、景点照片、攻略截图、外网攻略链接、导航链接
   所有素材绑定 目的地 + 游玩日期，支持多图归档
   ============================================================ */

app.modules.media = {
  render() {
    const sec = document.querySelector('[data-section=media]');
    if (!sec) return;
    const d = app.getActiveDestination();
    if (!d) {
      sec.innerHTML = `
        <div class="card">
          <div class="card-title">🖼️ 板块5 · 图文素材归档区</div>
          <div class="empty-state">
            <div class="icon">🗺️</div>
            <h3>请先选择或创建目的地</h3>
            <p class="text-sm">前往「板块1」建立目的地档案后，再回到这里归档素材</p>
          </div>
        </div>
      `;
      return;
    }

    const media = (app.state[d.id]?.media || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const images = media.filter(m => m.type === 'image');
    const links = media.filter(m => m.type === 'link');

    sec.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>🖼️ 板块5 · 图文素材归档区</span>
          <div class="ml-auto flex gap-2">
            <button class="btn btn-primary" onclick="app.modules.media.addMedia()">➕ 上传图片 / 添加链接</button>
            <button class="btn btn-success" onclick="app.modules.media.exportXlsx()">📥 链接导出 Excel</button>
          </div>
        </div>
        <p class="text-sm text-slate-600 mb-4">
          当前目的地：<strong class="text-sky-700">${d.city}, ${d.country}</strong>　·　共归档 <strong>${media.length}</strong> 项素材（图片 ${images.length} · 链接 ${links.length}）
        </p>

        <!-- 图片网格 -->
        <h4 class="font-semibold text-slate-700 text-sm mb-2">📸 图片素材（${images.length}）</h4>
        ${images.length === 0 ? `
          <div class="empty-state" style="padding:1.5rem">
            <div class="icon">📷</div>
            <p class="text-sm">暂无图片，点击右上角「上传图片 / 添加链接」开始归档</p>
          </div>
        ` : `
          <div class="media-grid mb-5">
            ${images.map(m => `
              <div class="media-item">
                <img src="${m.url}" alt="${m.caption || ''}" loading="lazy" onclick="app.modules.media.preview('${m.id}')" style="cursor:pointer" />
                <div class="media-caption">${m.caption || '未命名'} ${m.date ? '· ' + m.date : ''}</div>
                <button class="btn btn-danger btn-sm absolute top-1 right-1" style="opacity:0.9" onclick="app.modules.media.remove('${m.id}')">🗑️</button>
              </div>
            `).join('')}
          </div>
        `}

        <!-- 链接列表 -->
        <h4 class="font-semibold text-slate-700 text-sm mb-2">🔗 攻略 / 导航链接（${links.length}）</h4>
        ${links.length === 0 ? `
          <div class="empty-state" style="padding:1.5rem">
            <p class="text-sm">暂无链接，可添加外网攻略链接、导航链接等</p>
          </div>
        ` : `
          <div class="space-y-2">
            ${links.map(m => `
              <div class="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200">
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-slate-700 truncate">${m.caption || '未命名链接'}</div>
                  <a href="${m.url}" target="_blank" class="text-tiny text-sky-600 hover:underline break-all">${m.url}</a>
                  ${m.date ? '<span class="text-tiny text-slate-400"> · ' + m.date + '</span>' : ''}
                </div>
                <button class="btn btn-danger btn-sm ml-2" onclick="app.modules.media.remove('${m.id}')">🗑️</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  },

  addMedia() {
    const d = app.getActiveDestination();
    if (!d) return app.toast('请先选择目的地', 'warning');
    const html = `
      <div class="space-y-4">
        <div>
          <h4 class="font-semibold text-slate-800 mb-2">📷 上传图片（支持多图，自动转 Base64 永久存储）</h4>
          <input type="file" id="m_files" accept="image/*" multiple class="block w-full text-sm border border-slate-300 rounded p-2" />
          <p class="text-tiny text-slate-500 mt-1">提示：图片以 Base64 存储于本地浏览器，建议单张 ≤ 2MB，避免数据过大影响性能。</p>
        </div>
        <div class="border-t pt-3">
          <h4 class="font-semibold text-slate-800 mb-2">🔗 或添加链接（攻略/导航）</h4>
          <div class="form-grid">
            <div class="form-field col-span-full"><label>链接地址</label><input id="m_url" placeholder="https://..." /></div>
            <div class="form-field"><label>绑定游玩日期</label><input type="date" id="m_date" value="${d.startDate || app.today()}" /></div>
            <div class="form-field"><label>说明（如：浅草寺攻略 / 酒店实拍 / 导航）</label><input id="m_caption" placeholder="图说或链接标题" /></div>
          </div>
        </div>
      </div>
    `;
    app.openModal('➕ 上传图片 / 添加链接', html, [
      { text: '取消', class: 'btn btn-ghost', action: 'app.closeModal()' },
      { text: '保存', class: 'btn btn-primary', action: 'app.modules.media.save()' }
    ]);
  },

  async save() {
    const d = app.getActiveDestination();
    if (!d) return;
    if (!app.state[d.id]) app.state[d.id] = {};
    if (!app.state[d.id].media) app.state[d.id].media = [];

    let added = 0;

    // 处理图片
    const files = document.getElementById('m_files').files;
    if (files.length > 0) {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const base64 = await this.fileToBase64(file);
        app.state[d.id].media.push({
          id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          type: 'image',
          url: base64,
          caption: file.name.replace(/\.[^.]+$/, ''),
          date: document.getElementById('m_date').value
        });
        added++;
      }
    }

    // 处理链接
    const url = document.getElementById('m_url').value.trim();
    if (url) {
      if (!/^https?:\/\//i.test(url)) return app.toast('链接需以 http(s):// 开头', 'warning');
      app.state[d.id].media.push({
        id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: 'link',
        url,
        caption: document.getElementById('m_caption').value.trim() || '未命名链接',
        date: document.getElementById('m_date').value
      });
      added++;
    }

    if (added === 0) return app.toast('请选择图片或填写链接', 'warning');

    app.saveState();
    app.closeModal();
    this.render();
    app.toast(`已归档 ${added} 项素材`, 'success');
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  preview(id) {
    const d = app.getActiveDestination();
    if (!d) return;
    const m = (app.state[d.id]?.media || []).find(x => x.id === id);
    if (!m) return;
    app.openModal('🔍 图片预览', `
      <div class="text-center">
        <img src="${m.url}" alt="${m.caption}" class="max-w-full max-h-[60vh] mx-auto rounded" />
        <p class="text-sm text-slate-600 mt-2">${m.caption || ''} ${m.date ? '· ' + m.date : ''}</p>
      </div>
    `, [
      { text: '关闭', class: 'btn btn-ghost', action: 'app.closeModal()' }
    ]);
  },

  remove(id) {
    const d = app.getActiveDestination();
    if (!d || !confirm('确定删除该素材？')) return;
    if (app.state[d.id]?.media) {
      app.state[d.id].media = app.state[d.id].media.filter(x => x.id !== id);
      app.saveState();
      this.render();
    }
  },

  exportXlsx() {
    const d = app.getActiveDestination();
    if (!d) return;
    const media = app.state[d.id]?.media || [];
    if (media.length === 0) return app.toast('暂无素材', 'warning');
    const rows = media.map(m => ({ 类型: m.type === 'image' ? '图片' : '链接', 日期: m.date, 说明: m.caption, 链接: m.url }));
    if (typeof XLSX === 'undefined') { app.downloadCSV(`media_${d.city}_${new Date().toISOString().slice(0,10)}.csv`, rows); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `${d.city}-素材`);
    XLSX.writeFile(wb, `media_${d.city}_${new Date().toISOString().slice(0,10)}.xlsx`);
    app.toast('已导出素材链接为 Excel', 'success');
  }
};
