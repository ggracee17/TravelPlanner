#!/usr/bin/env bash
# 后端集成测试：改密码 + owner 重置他人密码
# 启动临时 DATA_DIR 的本地后端，用 curl 实测新接口，结束清理。
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT=$((4000 + RANDOM % 2000))
cd "$DIR"
BOARD_BACKEND=1 PORT=$PORT DATA_DIR="$TMP" node server.js >/tmp/srv_auth.log 2>&1 &
SRV=$!
sleep 1.5
B="http://localhost:$PORT"
BF=/tmp/body_auth.$$

# P <path> <json> [token]    G <path> [token]
P(){ if [ -n "${3:-}" ]; then curl -s -o "$BF" -w "%{http_code}" -X POST "$B$1" -H 'Content-Type: application/json' -H "Authorization: Bearer $3" -d "$2"; else curl -s -o "$BF" -w "%{http_code}" -X POST "$B$1" -H 'Content-Type: application/json' -d "$2"; fi; }
G(){ if [ -n "${2:-}" ]; then curl -s -o "$BF" -w "%{http_code}" -H "Authorization: Bearer $2" "$B$1"; else curl -s -o "$BF" -w "%{http_code}" "$B$1"; fi; }
TOK(){ node -e "let s=require('fs').readFileSync('$BF','utf8');try{process.stdout.write(JSON.parse(s).token||'')}catch(e){process.stdout.write('')}"; }

pass=0; fail=0
ok(){ if [ "$1" = "$2" ]; then echo "  PASS: $3"; pass=$((pass+1)); else echo "  FAIL: $3 (got $1 want $2)"; fail=$((fail+1)); fi; }

# reg <name> <username> <email> <password>
#   注册（含邮箱）→ 取 devCode → /api/verify-email → 捕获 token
#   （新注册账号需邮箱验证才能拿到 token，dev 模式由响应回传 devCode）
reg(){
  local name="$1" u="$2" e="$3" pw="$4" st dev
  st=$(P /api/register "{\"username\":\"$u\",\"email\":\"$e\",\"password\":\"$pw\"}"); ok "$st" 200 "$name 注册 200"
  dev=$(node -e "let s=require('fs').readFileSync('$BF','utf8');try{process.stdout.write(JSON.parse(s).devCode||'')}catch(e){}")
  st=$(P /api/verify-email "{\"username\":\"$u\",\"code\":\"$dev\"}"); ok "$st" 200 "$name 邮箱验证 200"
  printf -v "${name}TOK" '%s' "$(TOK)"
}
echo "[register]"
reg OWNER owner owner@example.com opw
reg ALICE alice alice@example.com apw
reg BOB   bob   bob@example.com   bpw
OTOK=$OWNERTOK; ATOK=$ALICETOK; BTOK=$BOBTOK
# 重名注册应 409（此前缺失）
st=$(P /api/register '{"username":"alice","email":"dup@example.com","password":"other"}'); ok "$st" 409 "重名注册 409"

echo "[change-password]"
st=$(P /api/change-password '{"oldPassword":"apw","newPassword":"apw2"}' "$ATOK"); ok "$st" 200 "alice 改密码(旧正确) 200"; ATOK2=$(TOK)
st=$(P /api/change-password '{"oldPassword":"wrong","newPassword":"x"}' "$ATOK2"); ok "$st" 400 "alice 改密码(旧错误) 400"
st=$(P /api/change-password '{"oldPassword":"apw2","newPassword":"y"}' "$ATOK");   ok "$st" 401 "改密码后旧 token 失效 401"
st=$(P /api/change-password '{"oldPassword":"apw","newPassword":"y"}');            ok "$st" 401 "未带 token 改密码 401"

echo "[login after change]"
st=$(P /api/unlock '{"username":"alice","password":"apw2"}'); ok "$st" 200 "alice 新密码登录 200"
st=$(P /api/unlock '{"username":"alice","password":"apw"}');  ok "$st" 401 "alice 旧密码登录 401"

echo "[admin]"
st=$(G /api/admin/users "$OTOK");  ok "$st" 200 "owner 列用户 200"
st=$(G /api/admin/users "$ATOK2"); ok "$st" 401 "alice(非管理员) 列用户 401"
st=$(G /api/admin/users);          ok "$st" 401 "未带 token 列用户 401"

echo "[admin reset]"
st=$(P /api/admin/reset-password '{"target":"bob","newPassword":"bpw2"}' "$OTOK");  ok "$st" 200 "owner 重置 bob 密码 200"
st=$(P /api/unlock '{"username":"bob","password":"bpw2"}');                         ok "$st" 200 "bob 新密码登录 200"
st=$(P /api/unlock '{"username":"bob","password":"bpw"}');                          ok "$st" 401 "bob 旧密码登录 401"
st=$(P /api/admin/reset-password '{"target":"bob","newPassword":"z"}' "$ATOK2");    ok "$st" 401 "alice 越权重置 401"

kill $SRV 2>/dev/null
rm -rf "$TMP" "$BF" 2>/dev/null
echo "========== $pass passed, $fail failed =========="
[ "$fail" -eq 0 ]
