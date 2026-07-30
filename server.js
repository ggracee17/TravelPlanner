/* ============================================================
   旅行规划工作台 · 全栈后端（纯 Node，零外部依赖）
   - 单密码鉴权（scrypt 校验，签发确定性 token）
   - 服务端永久存储（data/board.json，原子写 + 定时 JSON 快照）
   - 多人实时协作（SSE：状态广播 + 在线人数）
   注意：原计划用 better-sqlite3 + ws，但在受管运行时中为避免原生编译/安装风险，
        改用 Node 内置 http/crypto/fs + SSE 实现同等能力，零依赖、更稳健。
   ============================================================ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(ROOT, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 访问密码（环境变量优先，缺省给一个弱默认值并告警）
const BOARD_PASSWORD = process.env.BOARD_PASSWORD || 'travel2026';
if (!process.env.BOARD_PASSWORD) {
  console.warn('[安全] 未设置环境变量 BOARD_PASSWORD，正在使用默认弱密码 "travel2026"，请尽快修改！');
}

// 持久化后端：设为 GITHUB_TOKEN + GIST_ID 时，数据存到私人 Gist（部署在 Render 之外，重部署不丢）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID = process.env.GIST_ID || '';
const USE_GIST = !!(GITHUB_TOKEN && GIST_ID);
const GIST_FILENAME = 'board.json';

function gistHeaders() {
  return {
    'Authorization': 'Bearer ' + GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'travel-planner',
    'Content-Type': 'application/json'
  };
}

// 从 Gist 读取看板（失败返回 null，由调用方回退到本地缓存）
function loadBoardFromGist() {
  return new Promise((resolve) => {
    const url = 'https://api.github.com/gists/' + GIST_ID;
    const req = https.get(url, { headers: gistHeaders() }, (r) => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => {
        try {
          if (r.statusCode === 200) {
            const j = JSON.parse(buf);
            const file = j.files && j.files[GIST_FILENAME];
            if (file && file.content) { resolve(JSON.parse(file.content)); return; }
          } else {
            console.warn('[存储] Gist 读取失败 HTTP', r.statusCode, buf.slice(0, 200));
          }
        } catch (e) { console.warn('[存储] Gist 解析失败:', e.message); }
        resolve(null);
      });
    });
    req.on('error', e => { console.warn('[存储] Gist 网络错误:', e.message); resolve(null); });
    req.end();
  });
}

// 把看板写入 Gist（best-effort；失败仅告警，不丢本地缓存）
function saveBoardToGist(state) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(state, null, 2) } } });
    const req = https.request('https://api.github.com/gists/' + GIST_ID, {
      method: 'PATCH',
      headers: Object.assign(gistHeaders(), { 'Content-Length': Buffer.byteLength(body) })
    }, (r) => {
      let buf = '';
      r.on('data', c => buf += c);
      r.on('end', () => {
        if (r.statusCode === 200) console.log('[存储] 已写入 Gist');
        else console.warn('[存储] Gist 写入失败 HTTP', r.statusCode, buf.slice(0, 200));
        resolve();
      });
    });
    req.on('error', e => { console.warn('[存储] Gist 写入网络错误:', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

// 服务端密钥（持久化到文件，重启后仍稳定 → token 可跨重启有效）
function loadOrCreateSecret() {
  try {
    if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch (e) {}
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); } catch (e) { console.warn('写密钥失败', e.message); }
  return s;
}
const SERVER_SECRET = loadOrCreateSecret();
const SALT = crypto.createHash('sha256').update(SERVER_SECRET).digest();

function pwHash(pw) { return crypto.scryptSync(String(pw), SALT, 32).toString('hex'); }
const PW_HASH = pwHash(BOARD_PASSWORD);
// 确定性 token：HMAC(密钥, 密码哈希)。密码不变 → token 不变 → 重启后无需重新登录。
const VALID_TOKEN = crypto.createHmac('sha256', SERVER_SECRET).update(PW_HASH).digest('hex');

// 共享看板（内存权威态 + 持久文件）
let boardState = null;        // 完整 app.state 对象，或 null（尚未有任何数据）
let boardSig = '';            // 当前看板的规范化签名，用于去重广播
let writeChain = Promise.resolve(); // 序列化写操作，避免并发交错

function loadBoard() {
  return (async () => {
    if (USE_GIST) {
      console.log('[存储] 使用 GitHub Gist 作为持久化（GIST_ID=' + GIST_ID + '）');
      const gistState = await loadBoardFromGist();
      if (gistState) {
        boardState = gistState;
        boardSig = JSON.stringify(boardState);
        console.log('[存储] 已从 Gist 载入看板');
        try { atomicWrite(BOARD_FILE, JSON.stringify(boardState, null, 2)); } catch (e) {} // 同步到本地缓存
        return;
      }
      console.warn('[存储] Gist 无数据或读取失败，回退到本地缓存…');
    }
    try {
      if (fs.existsSync(BOARD_FILE)) {
        boardState = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
        boardSig = JSON.stringify(boardState);
        console.log('[存储] 已从 data/board.json 载入看板');
      } else {
        console.log('[存储] 暂无看板数据（首次启动）');
      }
    } catch (e) {
      console.error('[存储] 载入失败：', e.message);
      boardState = null;
    }
  })();
}

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function snapshotBackup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    // 仅保留最近 30 个快照
    for (const x of files.slice(30)) fs.unlinkSync(path.join(BACKUP_DIR, x.f));
    const name = 'board_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    fs.copyFileSync(BOARD_FILE, path.join(BACKUP_DIR, name));
  } catch (e) { console.warn('[备份] 快照失败（忽略）:', e.message); }
}

function saveBoard(state) {
  return writeChain = writeChain.then(async () => {
    boardState = state;
    boardSig = JSON.stringify(state);
    const payload = JSON.stringify(state, null, 2);
    atomicWrite(BOARD_FILE, payload);   // 本地缓存
    snapshotBackup();
    if (USE_GIST) { await saveBoardToGist(state); }  // 云端持久化（重部署不丢）
    broadcast('state', { type: 'state', data: boardState });
    broadcast('presence', { type: 'presence', count: sseClients.size });
    return true;
  }).catch(e => { console.error('[存储] 写入失败:', e.message); throw e; });
}

// ---- SSE 实时推送 ----
const sseClients = new Set();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch (e) { sseClients.delete(res); }
  }
}

// ---- 鉴权 ----
function extractToken(req, urlObj) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const t = urlObj.searchParams.get('token');
  return t || '';
}
function authorized(req, urlObj) {
  return extractToken(req, urlObj) === VALID_TOKEN;
}

// ---- 工具：读取请求体 ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 5 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } buf += c; });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

// ---- HTTP 路由 ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json'
};

const BLOCKED = new Set(['server.js', 'package.json', 'package-lock.json', '.gitignore']);

function serveStatic(req, res, pathname) {
  // 路径穿越防护
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (BLOCKED.has(path.basename(filePath))) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  // --- 动态配置：后端部署时启用后端模式 ---
  if (pathname === '/config.js') {
    const base = process.env.BOARD_BASE || '';
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(`window.BOARD_CONFIG = { enabled: true, base: ${JSON.stringify(base)}, storage: ${JSON.stringify(USE_GIST ? 'gist' : 'local')} };`);
    return;
  }

  // --- API ---
  if (pathname.startsWith('/api/')) {
    // 健康检查
    if (pathname === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, online: sseClients.size, storage: USE_GIST ? 'gist' : 'local' }));
      return;
    }

    // 解锁：校验密码 → 返回 token
    if (pathname === '/api/unlock' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { password } = JSON.parse(body || '{}');
        if (typeof password === 'string' && pwHash(password) === PW_HASH) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, token: VALID_TOKEN }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '密码错误' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '请求无效' }));
      }
      return;
    }

    // 读取看板（需鉴权）
    if (pathname === '/api/board' && req.method === 'GET') {
      if (!authorized(req, urlObj)) { res.writeHead(401); res.end(JSON.stringify({ error: '未授权' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: boardState }));
      return;
    }

    // 写入看板（需鉴权）：覆盖式全量写入（最后写入获胜）
    if (pathname === '/api/board' && req.method === 'PUT') {
      if (!authorized(req, urlObj)) { res.writeHead(401); res.end(JSON.stringify({ error: '未授权' })); return; }
      try {
        const body = await readBody(req);
        const state = JSON.parse(body || 'null');
        if (!state || typeof state !== 'object') throw new Error('无效的看板数据');
        await saveBoard(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, updated_at: new Date().toISOString() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // SSE 实时流（需鉴权）
    if (pathname === '/api/stream' && req.method === 'GET') {
      if (!authorized(req, urlObj)) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      // 连接即推送当前状态
      if (boardState) res.write(`event: state\ndata: ${JSON.stringify({ type: 'state', data: boardState })}\n\n`);
      res.write(`event: presence\ndata: ${JSON.stringify({ type: 'presence', count: sseClients.size })}\n\n`);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); broadcast('presence', { type: 'presence', count: sseClients.size }); });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API 不存在' }));
    return;
  }

  // --- 静态资源 ---
  serveStatic(req, res, pathname);
});

async function boot() {
  await loadBoard();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 旅行规划工作台后端已启动： http://localhost:${PORT}`);
    console.log(`   密码保护：单密码（环境变量 BOARD_PASSWORD，默认 "travel2026"）`);
    console.log(`   永久存储：${USE_GIST ? 'GitHub Gist（重部署不丢）' : 'data/board.json（含 /data/backups 快照，重部署会被清空，建议配置 GIST_ID+GITHUB_TOKEN）'}`);
    console.log(`   多人实时：SSE /api/stream`);
  });
}
boot();
