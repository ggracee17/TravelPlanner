/* ============================================================
   旅行规划工作台 · 全栈后端（纯 Node，零外部依赖）
   - 每用户独立账号（用户名 + 密码，scrypt 校验），各自拥有独立的旅行看板
   - 无状态 token：HMAC(密钥, 用户名:密码哈希)，可跨重启、按用户名隔离数据
   - 服务端永久存储（DATA_DIR/boards/<user>.json，原子写 + 定时 JSON 快照）
   - 多人实时协作（SSE：仅同账号客户端间状态广播 + 在线人数）
   注意：原计划用 better-sqlite3 + ws，但在受管运行时中为避免原生编译/安装风险，
        改用 Node 内置 http/crypto/fs + SSE 实现同等能力，零依赖、更稳健。
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
// 数据目录：Render 持久磁盘约定挂载在 /data。若启动时检测到 /data 是独立挂载点（磁盘已挂），
// 强制用 /data——避免环境变量 DATA_DIR 未正确注入（Render Blueprint 不覆盖控制台手动设过的同名值）时，
// 落到临时目录导致数据跨部署丢失。无磁盘时退回环境变量或默认 ./data。
const DATA_DIR = (() => {
  try {
    if (fs.existsSync('/proc/mounts')) {
      const isDataMount = fs.readFileSync('/proc/mounts', 'utf8').split('\n')
        .some(l => { const p = l.split(' '); return p[1] === '/data'; });
      if (isDataMount) return '/data';
    }
  } catch (e) {}
  return process.env.DATA_DIR || path.join(ROOT, 'data');
})();
const BOARD_FILE = path.join(DATA_DIR, 'board.json');     // 旧版共享看板（迁移用，迁移后可删）
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BOARDS_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 访问密码（环境变量优先，缺省给一个弱默认值并告警）——仅用于「旧版共享看板」迁移后的 owner 账号初始密码。
const BOARD_PASSWORD = process.env.BOARD_PASSWORD || 'travel2026';
if (!process.env.BOARD_PASSWORD) {
  console.warn('[安全] 未设置环境变量 BOARD_PASSWORD，owner 初始账号将使用默认弱密码 "travel2026"，请尽快修改！');
}

// 持久化：后端模式下数据存到本地文件（DATA_DIR，默认 ./data）。注意：仅付费实例挂了持久磁盘后，
// 重部署/重启后数据才保留；免费实例的 /data 是临时的、部署即清空。
// 零外部 API 调用。

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

// ===== 账号 & 每用户看板 =====
// accounts: { [username]: { pwHash, boardFile, createdAt } }
let accounts = {};
function loadAccounts() {
  try { if (fs.existsSync(ACCOUNTS_FILE)) accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) || {}; }
  catch (e) { accounts = {}; }
}
function saveAccounts() { atomicWrite(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)); }

// 内存看板缓存 + 每用户写链（串行化，避免并发交错）
const boards = new Map();          // username -> { state, sig }
const boardChains = new Map();     // username -> Promise

function safeUser(u) {
  return String(u == null ? '' : u).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
}

// 无状态 token：username + ':' + HMAC(密钥, username + ':' + 密码哈希)。改密码即失效。
function tokenFor(username, pwHashVal) {
  return username + ':' + crypto.createHmac('sha256', SERVER_SECRET).update(username + ':' + pwHashVal).digest('hex');
}
function userFromToken(token) {
  if (!token) return null;
  const i = token.indexOf(':');
  if (i < 0) return null;
  const username = token.slice(0, i);
  const sig = token.slice(i + 1);
  const acc = accounts[username];
  if (!acc) return null;
  const expected = crypto.createHmac('sha256', SERVER_SECRET).update(username + ':' + acc.pwHash).digest('hex');
  return sig === expected ? username : null;
}

function defaultState() {
  return {
    destinations: [], activeDestinationId: null, candidates: [], searchHistory: [],
    checklists: { documents: [], luggage: [] },
    itineraryTravelMode: 'transit', ecoMode: false
  };
}

function loadBoardForUser(username) {
  if (boards.has(username)) return boards.get(username).state;
  const acc = accounts[username];
  let st = null;
  if (acc && acc.boardFile && fs.existsSync(acc.boardFile)) {
    try { st = JSON.parse(fs.readFileSync(acc.boardFile, 'utf8')); } catch (e) { st = null; }
  }
  if (!st) st = defaultState();
  boards.set(username, { state: st, sig: JSON.stringify(st) });
  return st;
}

function snapshotBackup(boardFile, namePrefix) {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const x of files.slice(30)) fs.unlinkSync(path.join(BACKUP_DIR, x.f));
    const name = namePrefix + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    fs.copyFileSync(boardFile, path.join(BACKUP_DIR, name));
  } catch (e) { console.warn('[备份] 快照失败（忽略）:', e.message); }
}

function saveBoardForUser(username, state) {
  const prev = boardChains.get(username) || Promise.resolve();
  const next = prev.then(async () => {
    const acc = accounts[username];
    if (!acc) throw new Error('账号不存在');
    boards.set(username, { state, sig: JSON.stringify(state) });
    atomicWrite(acc.boardFile, JSON.stringify(state, null, 2));
    snapshotBackup(acc.boardFile, 'board_' + username);
    broadcast('state', username, { type: 'state', data: state });
    broadcast('presence', username, { type: 'presence', count: (sseClients.get(username) || new Set()).size });
    return true;
  }).catch(e => { console.error('[存储] 写入失败:', e.message); throw e; });
  boardChains.set(username, next);
  return next;
}

// 存储诊断：确认持久磁盘是否已真正挂载到 DATA_DIR（而非临时根目录）。
function checkStorage() {
  const info = { dataDir: DATA_DIR, exists: false, writable: false, mounted: false, mountLine: '' };
  try {
    info.exists = fs.existsSync(DATA_DIR) && fs.statSync(DATA_DIR).isDirectory();
  } catch (e) {}
  try {
    const probe = path.join(DATA_DIR, '.probe_' + Date.now());
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    info.writable = true;
  } catch (e) {}
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n');
    const hit = mounts.find(l => { const p = l.split(' '); return p[1] === DATA_DIR; });
    if (hit) { info.mounted = true; info.mountLine = hit; }
  } catch (e) {}
  return info;
}

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// ===== SSE：仅同账号客户端间广播 =====
const sseClients = new Map();   // username -> Set<res>

function broadcast(event, username, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const set = sseClients.get(username);
  if (!set) return;
  for (const res of set) {
    try { res.write(frame); } catch (e) { set.delete(res); }
  }
}

// ---- 鉴权 ----
function extractToken(req, urlObj) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const t = urlObj.searchParams.get('token');
  return t || '';
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
    const ds = checkStorage();
    // 后端模式开启条件（满足任一即启用）：
    //   1) 显式环境变量 BOARD_BACKEND=1；
    //   2) 检测到持久磁盘已挂载到 DATA_DIR（付费实例专属）。
    const backendEnabled = process.env.BOARD_BACKEND === '1' || ds.mounted;
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(`window.BOARD_CONFIG = { enabled: ${backendEnabled}, base: ${JSON.stringify(base)}, storage: 'local', gmapsApiKey: ${JSON.stringify(process.env.GMAPS_API_KEY || '')} };`);
    return;
  }

  // --- API ---
  if (pathname.startsWith('/api/')) {
    // 健康检查
    if (pathname === '/api/health' && req.method === 'GET') {
      const disk = checkStorage();
      let online = 0;
      for (const s of sseClients.values()) online += s.size;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, online, accounts: Object.keys(accounts).length, storage: 'local', disk, persistent: disk.mounted }));
      return;
    }

    // 注册新账号（开放注册）：建独立账号 + 空看板，返回 token
    if (pathname === '/api/register' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { username, password } = JSON.parse(body || '{}');
        const u = safeUser(username);
        if (!u || u.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '用户名需 3–32 位字母/数字/下划线' }));
          return;
        }
        if (!password || String(password).length < 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '密码不能为空' }));
          return;
        }
        if (accounts[u]) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '该用户名已存在' }));
          return;
        }
        fs.mkdirSync(BOARDS_DIR, { recursive: true });
        const boardFile = path.join(BOARDS_DIR, u + '.json');
        const newState = defaultState();
        atomicWrite(boardFile, JSON.stringify(newState, null, 2));
        accounts[u] = { pwHash: pwHash(password), boardFile, createdAt: new Date().toISOString() };
        saveAccounts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token: tokenFor(u, accounts[u].pwHash) }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '请求无效' }));
      }
      return;
    }

    // 解锁/登录：校验 用户名 + 密码 → 返回 token（映射到该用户独立看板）
    if (pathname === '/api/unlock' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { username, password } = JSON.parse(body || '{}');
        const u = safeUser(username);
        const acc = accounts[u];
        if (acc && pwHash(password) === acc.pwHash) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, token: tokenFor(u, acc.pwHash) }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '用户名或密码错误' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '请求无效' }));
      }
      return;
    }

    // 读取看板（需鉴权，按 token 映射到的用户）
    if (pathname === '/api/board' && req.method === 'GET') {
      const username = userFromToken(extractToken(req, urlObj));
      if (!username) { res.writeHead(401); res.end(JSON.stringify({ error: '未授权' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: loadBoardForUser(username) }));
      return;
    }

    // 写入看板（需鉴权）：覆盖式全量写入该用户看板（最后写入获胜）
    if (pathname === '/api/board' && req.method === 'PUT') {
      const username = userFromToken(extractToken(req, urlObj));
      if (!username) { res.writeHead(401); res.end(JSON.stringify({ error: '未授权' })); return; }
      try {
        const body = await readBody(req);
        const state = JSON.parse(body || 'null');
        if (!state || typeof state !== 'object') throw new Error('无效的看板数据');
        await saveBoardForUser(username, state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, updated_at: new Date().toISOString() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // SSE 实时流（需鉴权，仅同账号客户端接收广播）
    if (pathname === '/api/stream' && req.method === 'GET') {
      const username = userFromToken(extractToken(req, urlObj));
      if (!username) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      let set = sseClients.get(username);
      if (!set) { set = new Set(); sseClients.set(username, set); }
      set.add(res);
      res.write(`event: presence\ndata: ${JSON.stringify({ type: 'presence', count: set.size })}\n\n`);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
      req.on('close', () => {
        clearInterval(ping);
        const s = sseClients.get(username);
        if (s) { s.delete(res); if (s.size === 0) sseClients.delete(username); }
        broadcast('presence', username, { type: 'presence', count: (sseClients.get(username) || new Set()).size });
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API 不存在' }));
    return;
  }

  // --- 静态资源 ---
  serveStatic(req, res, pathname);
});

// 旧版「单一共享看板」一次性迁移为账号 owner（密码=原 BOARD_PASSWORD）
function migrateOldBoard() {
  if (Object.keys(accounts).length > 0) return;        // 已有账号，无需迁移
  if (!fs.existsSync(BOARD_FILE)) return;              // 无旧看板，全新启动
  try {
    const old = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
    fs.mkdirSync(BOARDS_DIR, { recursive: true });
    const owner = 'owner';
    const boardFile = path.join(BOARDS_DIR, owner + '.json');
    atomicWrite(boardFile, JSON.stringify(old, null, 2));
    accounts[owner] = { pwHash: pwHash(BOARD_PASSWORD), boardFile, createdAt: new Date().toISOString() };
    saveAccounts();
    console.log('[迁移] 检测到旧版共享看板，已迁移为账号 "owner"（密码=原访问密码）。');
    console.log('        请用 用户名 owner + 原密码 登录；之后可在界面里为家人/朋友注册各自独立账号。');
  } catch (e) {
    console.error('[迁移] 旧看板迁移失败（忽略，将以全新账号启动）：', e.message);
  }
}

async function boot() {
  loadAccounts();
  migrateOldBoard();
  const ds = checkStorage();
  const backendOn = process.env.BOARD_BACKEND === '1' || ds.mounted;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 旅行规划工作台后端已启动： http://localhost:${PORT}`);
    console.log(`   账号模式：每用户独立账号 + 独立看板（开放注册）`);
    if (backendOn) {
      if (ds.mounted) {
        console.log(`   ✅ 永久存储：写入 ${BOARDS_DIR}/<user>.json（已挂载持久磁盘 ${DATA_DIR}，跨部署/重启保留）`);
      } else {
        console.log(`   ⚠️⚠️ 持久化风险：后端已启用，但 ${DATA_DIR} 不是「持久磁盘挂载点」(checkStorage.mounted=false)！`);
        console.log(`      当前写入 ${BOARDS_DIR} 实际位于临时文件系统，每次「重新部署/重启」都会清空 → 数据会丢失。`);
        console.log(`      请在 Render 控制台确认 travel-data 磁盘已「挂载到本服务」且挂载路径为 /data，然后重新部署。`);
      }
    } else {
      console.log(`   本地存储：后端未启用，前端使用浏览器 localStorage（不跨设备、清缓存即丢）`);
    }
    console.log(`   磁盘自检：dataDir=${ds.dataDir} | 已挂载持久磁盘=${ds.mounted} | 可写=${ds.writable}`);
    console.log(`   多人实时：SSE /api/stream（按账号隔离）`);
  });
}
boot();
