#!/usr/bin/env node
/* ============================================================
   一次性迁移脚本：从旧 GitHub Gist 拉取 board.json，写入：
     1) 本地 data/board.json   —— 供本地测试
     2) 仓库根 seed-board.json —— 供 Render 首次启动「播种」到持久磁盘
   说明：
     - 只发 1 次 GET 请求，极省 GitHub 配额。
     - seed-board.json 需手动 git add/commit/push；server.js 在持久磁盘为空时
       会自动把它复制到 /data/board.json（仅一次）。
   用法：
     GIST_ID=xxx GITHUB_TOKEN=xxx node tools/migrate-gist-to-disk.js
     node tools/migrate-gist-to-disk.js --gist-id xxx --token xxx
   可选参数：
     --local-only   只写本地 data/board.json（不写 seed）
     --seed-only    只写仓库根 seed-board.json（不写本地 data）
   ============================================================ */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');
const SEED_FILE = path.join(ROOT, 'seed-board.json');

// ---- 解析参数 ----
let gistId = process.env.GIST_ID;
let token = process.env.GITHUB_TOKEN;
let localOnly = false;
let seedOnly = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--local-only') localOnly = true;
  else if (a === '--seed-only') seedOnly = true;
  else if (a === '--gist-id') gistId = process.argv[++i];
  else if (a === '--token') token = process.argv[++i];
}

if (!gistId || !token) {
  console.error('缺少 GIST_ID / GITHUB_TOKEN。');
  console.error('用法：GIST_ID=xxx GITHUB_TOKEN=xxx node tools/migrate-gist-to-disk.js');
  console.error('  或：node tools/migrate-gist-to-disk.js --gist-id xxx --token xxx');
  process.exit(1);
}

function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpsGetJson(res.headers.location, headers)); // 跟随一次重定向
        }
        if (res.statusCode !== 200) return reject(new Error('GitHub 返回 HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('响应 JSON 解析失败: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')));
  });
}

(async () => {
  console.log('正在从 Gist', gistId, '拉取 board.json …');
  const data = await httpsGetJson(`https://api.github.com/gists/${gistId}`, {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'travel-board-migrate'
  });
  const files = data.files || {};
  const file = files['board.json'] || Object.values(files)[0];
  if (!file || !file.content) {
    console.error('Gist 中未找到 board.json（请确认 GIST_ID 正确、token 有 gist 读取权限）。');
    process.exit(2);
  }
  const content = file.content;
  try { JSON.parse(content); } catch (e) {
    console.error('Gist 内容不是合法 JSON:', e.message);
    process.exit(3);
  }

  if (!seedOnly) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BOARD_FILE, content, 'utf8');
    console.log('✅ 已写入本地', BOARD_FILE);
  }
  if (!localOnly) {
    fs.writeFileSync(SEED_FILE, content, 'utf8');
    console.log('✅ 已写入仓库种子', SEED_FILE);
    console.log('   → 请执行：git add seed-board.json && git commit && git push origin main');
    console.log('   → Render 首次启动会把 seed 播种到持久磁盘 /data/board.json（仅一次）。');
    console.log('   → 播种成功后可在 Render 控制台删除仓库里的 seed-board.json（数据安全落在磁盘）。');
  }
  console.log('迁移完成。若曾在 Render 设置过 GIST_ID/GITHUB_TOKEN 环境变量，可一并移除。');
})().catch(e => {
  console.error('迁移失败：', e.message);
  process.exit(1);
});
