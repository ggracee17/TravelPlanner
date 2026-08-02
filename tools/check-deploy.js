#!/usr/bin/env node
/* ============================================================
   部署后自检：确认 Render 服务在线、持久磁盘(local)已挂载、且看板已有数据。
   用法：
     node tools/check-deploy.js --url https://your-app.onrender.com --password 你的密码
   或环境变量：
     DEPLOY_URL=https://your-app.onrender.com BOARD_PASSWORD=你的密码 node tools/check-deploy.js
   说明：
     - 免费版 Render 会休眠，首次请求需冷启动（约数十秒），脚本已设 60s 超时。
     - 不传 --password 也会检查服务/存储，只是跳过数据校验。
   ============================================================ */

const https = require('https');

function getJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: opts.method || 'GET',
      timeout: 60000,
      headers: Object.assign({ 'Content-Type': 'application/json', 'User-Agent': 'deploy-check' }, opts.headers || {})
    }, res => {
      // 同 server.js readBody：必须攒 Buffer 后统一解码，否则中文可能被分包切坏
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(body); } catch (e) { json = body; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（可能 Render 冷启动过慢，稍后重试）')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

(async () => {
  const args = process.argv.slice(2);
  let url = process.env.DEPLOY_URL;
  let pw = process.env.BOARD_PASSWORD;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url') url = args[++i];
    else if (args[i] === '--password') pw = args[++i];
  }
  if (!url) {
    console.error('缺少部署地址。用法：');
    console.error('  node tools/check-deploy.js --url https://xxx.onrender.com --password 你的密码');
    process.exit(1);
  }
  url = url.replace(/\/$/, '');

  // ① 健康检查
  console.log('① 健康检查 →', url + '/api/health');
  try {
    const h = await getJson(url + '/api/health');
    if (h.status !== 200) { console.error('  ✗ 服务未就绪（HTTP ' + h.status + '）'); process.exit(2); }
    const storage = h.json.storage;
    console.log('  ✓ ok=' + h.json.ok + '  存储模式=' + storage + '  在线人数=' + h.json.online);
    if (storage !== 'local') {
      console.warn('  ⚠ 存储模式非 local：请确认 Render 已挂持久磁盘 travel-data 且环境变量 DATA_DIR=/data');
    }
  } catch (e) { console.error('  ✗ 无法连接：', e.message); process.exit(3); }

  // ② 解锁 + 校验数据
  if (!pw) {
    console.warn('② 跳过数据校验（未提供 --password）。加 --password 你的密码 可校验数据是否已导入。');
    return;
  }
  console.log('② 解锁并校验看板数据');
  let token;
  try {
    const u = await getJson(url + '/api/unlock', { method: 'POST', body: JSON.stringify({ password: pw }) });
    if (!u.json.ok) { console.error('  ✗ 密码错误'); process.exit(4); }
    token = u.json.token;
    console.log('  ✓ 解锁成功');
  } catch (e) { console.error('  ✗ 解锁失败：', e.message); process.exit(4); }

  const b = await getJson(url + '/api/board?token=' + encodeURIComponent(token));
  if (b.status !== 200) { console.error('  ✗ 读取看板失败（HTTP ' + b.status + '）'); process.exit(5); }
  const data = b.json.data || {};
  const dests = (data.destinations || []).length;
  const cands = (data.candidates || []).length;
  console.log('  ✓ 看板已载入：目的地 ' + dests + ' 个，行程库 ' + cands + ' 条');
  if (dests === 0 && cands === 0) {
    console.warn('  ⚠ 看板为空——若预期应有数据，请确认持久磁盘(travel-data)已挂载且 /data 下 board.json 存在（首次部署或清空后会为空）。');
    process.exit(6);
  }
  console.log('✅ 部署自检通过：服务在线、磁盘(local)已挂载、数据已成功导入持久磁盘。');
})();
