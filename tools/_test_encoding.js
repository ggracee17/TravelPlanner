/*
 * 回归测试：中文在「PUT /api/board → 落盘 → GET 回读」全链路不被破坏。
 *
 * 背景（长期乱码 bug 的真正根因）：
 *   server.js 的 readBody 原来写成 `let buf=''; req.on('data', c => buf += c)`。
 *   `buf += c` 会对每一个 chunk 单独做 UTF-8 解码；当一个中文字符的 3 个字节被
 *   TCP 分包切开（body 一大必然发生），两半各自解码成 U+FFFD，中文就永久损坏，
 *   典型现象：「创可贴」→「���可贴」。而且只在写入时坏一次，内存里仍是好的，
 *   所以「重置后看着正常、重新部署/刷新后又出现」。
 *
 * 本测试用两种方式覆盖：
 *   A) 强制分包：手动把请求体在某个中文字符的字节中间切开，分两次 write；
 *   B) 大 body：~300KB 含大量中文，靠真实 TCP 分包触发。
 * 断言回读数据与原始对象完全一致、且不含任何 U+FFFD。
 */
'use strict';
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4000 + Math.floor(Math.random() * 2000);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.log('  FAIL: ' + msg); }
}

function req(method, p, { body, token, splitAt } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const buf = body != null ? Buffer.from(body, 'utf8') : null;
    if (buf) headers['Content-Length'] = buf.length;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    r.on('error', reject);
    if (buf && splitAt != null) {
      // 故意把某个中文字符的字节从中间劈开，分两个 TCP 包发出
      r.write(buf.subarray(0, splitAt));
      setTimeout(() => { r.write(buf.subarray(splitAt)); r.end(); }, 30);
    } else {
      if (buf) r.write(buf);
      r.end();
    }
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

function findCharSplit(jsonStr, ch) {
  // 返回该中文字符 3 字节序列的「中间」字节位置，用于制造跨包切割
  const buf = Buffer.from(jsonStr, 'utf8');
  const target = Buffer.from(ch, 'utf8');
  const i = buf.indexOf(target);
  return i < 0 ? null : i + 1;
}

// 深比较（顺序无关的对象键 + 数组按序）
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

(async () => {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { BOARD_BACKEND: '1', PORT: String(PORT), DATA_DIR: TMP }),
    stdio: 'ignore'
  });
  await wait(1500);

  try {
    const reg = await req('POST', '/api/register', { body: JSON.stringify({ username: 'enctest', password: 'pw' }) });
    assert(reg.status === 200 && reg.json && reg.json.token, '注册测试账号成功');
    const token = reg.json && reg.json.token;

    console.log('\n[测试A] 中文字符被 TCP 分包切开时不损坏');
    {
      const state = {
        checklists: {
          luggage: [
            { id: 'l1', name: '医药包：创可贴、退烧药、肠胃药', checked: false },
            { id: 'l2', name: '万能转换插头（台湾同大陆两脚扁插）', checked: false },
            { id: 'l3', name: '面霜 + 防晒霜 + 唇膏', checked: true }
          ],
          documents: [{ id: 'd1', name: '旅行保险（保单 + 紧急联系人）', checked: false }]
        }
      };
      const body = JSON.stringify(state);
      const splitAt = findCharSplit(body, '创');
      assert(splitAt != null, "定位到「创」字的字节切割点（模拟最坏分包）");

      const put = await req('PUT', '/api/board', { body, token, splitAt });
      assert(put.status === 200, 'PUT /api/board 200');

      const got = await req('GET', '/api/board', { token });
      assert(got.status === 200, 'GET /api/board 200');
      const back = got.json && got.json.data;
      const backStr = JSON.stringify(back);

      assert(!backStr.includes('\uFFFD'), '回读数据不含 U+FFFD 替换符');
      assert(backStr.includes('创可贴'), '「创可贴」完整无损（旧代码此处会变成 ���可贴）');
      assert(backStr.includes('万能转换插头（台湾同大陆两脚扁插）'), '带全角括号的长中文项完整');
      assert(deepEq(back.checklists, state.checklists), '整个 checklists 与写入前完全一致');
    }

    console.log('\n[测试B] ~300KB 大 body（真实 TCP 分包）中文全部完整');
    {
      const words = ['创可贴', '退烧药', '万能转换插头', '防晒霜', '悠游卡', '九份老街', '逢甲夜市', '台北车站', '⼀日游', '行动电源'];
      const spots = [];
      for (let i = 0; i < 3000; i++) {
        spots.push({
          id: 's' + i,
          name: words[i % words.length] + '－第' + i + '项',
          note: '备注：' + words[(i * 7) % words.length] + '，需要提前确认营业时间与交通方式。'
        });
      }
      const state = { destinations: [{ id: 'd1', name: '台湾环岛' }], candidates: spots };
      const body = JSON.stringify(state);
      const bytes = Buffer.byteLength(body, 'utf8');
      assert(bytes > 200 * 1024, `payload 足够大以触发分包（${(bytes / 1024).toFixed(0)} KB）`);

      const put = await req('PUT', '/api/board', { body, token });
      assert(put.status === 200, '大 body PUT 200');

      const got = await req('GET', '/api/board', { token });
      const back = got.json && got.json.data;
      const backStr = JSON.stringify(back);
      assert(!backStr.includes('\uFFFD'), '大 body 回读不含任何 U+FFFD');
      assert(deepEq(back.candidates, state.candidates), `${spots.length} 条含中文记录逐字一致`);
    }

    console.log('\n[测试C] 落盘文件本身是干净 UTF-8');
    {
      const f = path.join(TMP, 'boards', 'enctest.json');
      const raw = fs.readFileSync(f, 'utf8');
      assert(!raw.includes('\uFFFD'), 'boards/enctest.json 磁盘内容无替换符');
      assert(raw.includes('创可贴') || raw.includes('九份老街'), '磁盘内容中文可读');
    }
  } catch (e) {
    failed++;
    console.log('  FAIL: 测试异常 ' + e.message);
  } finally {
    srv.kill();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========\n`);
  process.exit(failed ? 1 : 0);
})();
