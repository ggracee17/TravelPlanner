/*
 * 回归测试：注册邮箱验证 + 邮箱/账号双登录。
 *
 * 用真实 server.js（spawn 启动）+ 进程内 mock Resend（HTTP 服务）覆盖：
 *   A) 注册带邮箱 → needsVerification + mock 收到邮件 + 落盘 email 小写化/verified=false
 *   B) 正确验证码 → 200 + token；重复用同码 → 400；错误码 → 400
 *   C) 邮箱登录 → 200 + token；用该 token 读看板 200；用户名登录同账号 200
 *   D) 未验证账号登录被拦截 + 不存在邮箱不泄露（401）
 *   E) 邮箱唯一：两不同用户名绑同邮箱（大小写不同）→ 409
 *   F) 重发验证码限流 429
 *   G) 过期验证码（第二个 server 实例 + 极短 TTL）→ 400
 */
'use strict';
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4000 + Math.floor(Math.random() * 2000);
const MOCK_PORT = 4100 + Math.floor(Math.random() * 2000);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emailauth-'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

function req(port, method, p, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const buf = body != null ? Buffer.from(body, 'utf8') : null;
    if (buf) headers['Content-Length'] = buf.length;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (buf) r.write(buf);
    r.end();
  });
}
const post = (port, p, body, token) => req(port, 'POST', p, { body: JSON.stringify(body), token });
const get = (port, p, token) => req(port, 'GET', p, { token });

const wait = ms => new Promise(r => setTimeout(r, ms));

// 进程内 mock Resend：把收到的邮件 push 到 mails[]，监听 RESEND_API_BASE 指向的端口
function startMock() {
  const mails = [];
  const srv = http.createServer((rq, rs) => {
    const cs = [];
    rq.on('data', c => cs.push(c));
    rq.on('end', () => {
      try { mails.push(JSON.parse(Buffer.concat(cs).toString('utf8'))); } catch (e) {}
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ id: 'mock_' + mails.length }));
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, mails, port: srv.address().port })));
}
function lastCodeTo(mails, email) {
  for (let i = mails.length - 1; i >= 0; i--) {
    const to = mails[i].to;
    const tos = Array.isArray(to) ? to : [to];
    if (tos.indexOf(email) >= 0) {
      const m = (mails[i].html || '').match(/\b(\d{6})\b/);
      return m ? m[1] : null;
    }
  }
  return null;
}
function readAccounts(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8'));
}
function spawnServer(env) {
  const port = 4000 + Math.floor(Math.random() * 2000);
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { BOARD_BACKEND: '1', PORT: String(port), DATA_DIR: TMP, EMAIL_MODE: 'resend', RESEND_API_KEY: 'testkey' }, env),
    stdio: 'ignore'
  });
  return { srv, port };
}

(async () => {
  const mock = await startMock();
  const { srv, port } = spawnServer({ RESEND_API_BASE: 'http://127.0.0.1:' + mock.port });
  await wait(1500);

  try {
    const email = 'Alice@Example.com'; // 故意大小写混合，测试归一化

    console.log('\n[测试A] 注册带邮箱 → needsVerification + 收到邮件');
    const reg = await post(port, '/api/register', { username: 'alice', password: 'apw', email });
    assert(reg.status === 200 && reg.json && reg.json.needsVerification === true, '注册返回 needsVerification（不签发 token）');
    assert(!reg.json.token, '注册响应不含 token（未验证前不能登录）');
    assert(mock.mails.length === 1 && mock.mails[0].to[0] === 'alice@example.com', 'mock Resend 收到 1 封发给归一化小写邮箱的信');
    const accA = readAccounts(TMP);
    assert(accA.alice && accA.alice.email === 'alice@example.com', '落盘 accounts.json 中 email 已小写归一化');
    assert(accA.alice.verified === false, '新账号 verified=false（待验证）');
    assert(typeof accA.alice.verifyCode === 'string' && accA.alice.verifyCode.length === 6, 'verifyCode 为 6 位');
    const codeA = lastCodeTo(mock.mails, 'alice@example.com');
    assert(!!codeA, '能从 mock 邮件里解析出 6 位验证码');

    console.log('\n[测试B] 错误验证码 → 400；正确验证码 → token；已验证后幂等');
    const wrongCode = await post(port, '/api/verify-email', { username: 'alice', code: '000000' });
    assert(wrongCode.status === 400, '未验证时错误验证码 → 400');
    const verify = await post(port, '/api/verify-email', { username: 'alice', code: codeA });
    assert(verify.status === 200 && verify.json && verify.json.token, '正确验证码 → 200 + token');
    const tokenA = verify.json.token;
    const verifyAgain = await post(port, '/api/verify-email', { username: 'alice', code: codeA });
    assert(verifyAgain.status === 200 && verifyAgain.json.token, '已验证后再次验证 → 200（幂等，直接发 token）');
    const accB = readAccounts(TMP);
    assert(accB.alice.verified === true && accB.alice.verifyCode === '', '验证成功后 verified=true 且 verifyCode 已清空');

    console.log('\n[测试C] 用 token 读看板 + 邮箱/用户名双登录');
    const board = await get(port, '/api/board', tokenA);
    assert(board.status === 200, '用验证后的 token 读 /api/board → 200（token 等价有效）');
    const loginEmail = await post(port, '/api/unlock', { email: 'alice@example.com', password: 'apw' });
    assert(loginEmail.status === 200 && loginEmail.json.token, '邮箱 + 密码登录 → 200 + token');
    assert(loginEmail.json.username === 'alice', '邮箱登录响应回传正确 username');
    const loginUser = await post(port, '/api/unlock', { username: 'alice', password: 'apw' });
    assert(loginUser.status === 200 && loginUser.json.token, '用户名 + 密码登录同一账号 → 200 + token');

    console.log('\n[测试D] 未验证账号登录被拦截 + 不存在邮箱不泄露');
    const reg2 = await post(port, '/api/register', { username: 'bob', password: 'bpw', email: 'bob@example.com' });
    assert(reg2.status === 200 && reg2.json.needsVerification, 'bob 注册成功（待验证）');
    const bobLogin = await post(port, '/api/unlock', { username: 'bob', password: 'bpw' });
    assert(bobLogin.status === 403 && bobLogin.json.needsVerification === true, '未验证账号登录 → 403 needsVerification（不发 token）');
    const ghostLogin = await post(port, '/api/unlock', { email: 'nobody@example.com', password: 'x' });
    assert(ghostLogin.status === 401, '不存在的邮箱登录 → 401（与密码错同态，防枚举）');

    console.log('\n[测试E] 邮箱唯一：两不同用户名绑同邮箱（大小写不同）→ 409');
    const regCarol = await post(port, '/api/register', { username: 'carol', password: 'cpw', email: 'dup@example.com' });
    assert(regCarol.status === 200 && regCarol.json.needsVerification, 'carol 用 dup@example.com 注册成功');
    const regDave = await post(port, '/api/register', { username: 'dave', password: 'dpw', email: 'DUP@example.com' });
    assert(regDave.status === 409, 'dave 用同邮箱（大小写不同）注册 → 409（邮箱唯一）');

    console.log('\n[测试F] 重发验证码限流');
    const resend1 = await post(port, '/api/resend-verification', { username: 'bob' });
    assert(resend1.status === 200, '首次重发 → 200');
    const resend2 = await post(port, '/api/resend-verification', { username: 'bob' });
    assert(resend2.status === 429, '60s 内再次重发 → 429（限流）');

    console.log('\n[测试G] 过期验证码（第二个 server 实例 + 极短 TTL）');
    const mock2 = await startMock();
    const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'emailauth2-'));
    const s2 = spawnServer({ DATA_DIR: TMP2, RESEND_API_BASE: 'http://127.0.0.1:' + mock2.port, EMAIL_CODE_TTL_MS: '1' });
    await wait(1500);
    try {
      const rg = await post(s2.port, '/api/register', { username: 'frank', password: 'fpw', email: 'frank@example.com' });
      assert(rg.status === 200, 'frank 注册成功');
      const code = lastCodeTo(mock2.mails, 'frank@example.com');
      assert(!!code, '从第二个 mock 解析出验证码');
      await wait(50); // 让 TTL(1ms) 过期
      const v = await post(s2.port, '/api/verify-email', { username: 'frank', code });
      assert(v.status === 400, '过期验证码 → 400');
    } finally {
      s2.srv.kill(); mock2.srv.close();
      try { fs.rmSync(TMP2, { recursive: true, force: true }); } catch (e) {}
    }
  } catch (e) {
    failed++;
    console.log('  FAIL: 测试异常 ' + e.message + '\n' + (e.stack || ''));
  } finally {
    srv.kill();
    mock.srv.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========\n`);
  process.exit(failed ? 1 : 0);
})();
