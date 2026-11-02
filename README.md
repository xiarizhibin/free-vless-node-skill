# free-vless-node

一个 **Agent Skill**：从"帮我搞个免费节点"到"扫码就能用的可验证节点"，全流程可复用。

覆盖 **临时邮箱 → 免费托管平台部署 → VLESS+WS+TLS 服务端 → 三级验证 → 链接/二维码 → 真机排障**，每条命令都跑过，每个坑都来自实战。

## 为什么值得复用

这套流程里最贵的不是部署，是**验证**。典型的翻车现场：

- 服务端把 VLESS 响应头写进了上游 socket → 所有真客户端 `ping timeout`，而自写的明文测试照样返回 200（假阳性）。
- 握手包"只解析一次"的标志位漏了 → 响应头发两遍、请求体发两遍，TLS 直接握手失败。
- 托管平台的内容审查把代理代码拦了 → 换中性命名才发布得出去。

所以这个 skill 附带三个验证脚本，其中 `verify-tls.mjs` 是唯一算数的通过标准：它真的在 WebSocket 流上跑一次 TLS 1.3 握手并取回 HTTPS 页面。它通过 = 客户端一定能连上。

## 安装

作为 Agent Skill 放到你的 skills 目录即可（Claude Code / Cursor / Codex / DSH 等通用）：

```bash
git clone https://github.com/xiarizhibin/free-vless-node-skill.git \
  ~/.claude/skills/free-vless-node
# 或
cp -r free-vless-node-skill ~/.agents/skills/free-vless-node
```

脚本依赖（仅二维码相关步骤需要）：

```bash
cd free-vless-node-skill && npm install
```

## 目录

```
SKILL.md                     # 流程主体：7 个阶段 + 硬约束 + 失败矩阵
scripts/
  relay-server.js            # 修好的 VLESS-over-WS 服务端（含 /_status 诊断端点）
  verify-tls.mjs             # 级别1：响应头 + 真 TLS 穿透（唯一算数的标准）
  verify-fetch.mjs           # 级别2：明文抓取探针（辅助，会假阳性）
  gen-link.mjs               # 链接 + Base64 订阅 + 二维码 + 回读校验
  mailtm.mjs                 # 临时邮箱：new / list / read / wait
  make-zip.ps1 / make-zip.sh  # 打包上传
  xray-client.json           # 级别3：真客户端模板
references/
  platforms.md               # 各平台 AUP / 休眠 / 端口差异
  clients.md                 # 客户端字段对照与导入方式
```

## 30 秒上手

```bash
# 1. 临时收件箱
node scripts/mailtm.mjs new

# 2. 打包服务端，上传到托管平台（见 SKILL.md 第 4 节）

# 3. 验证（改 wss:// 成你的域名）
node scripts/verify-tls.mjs wss://YOUR-HOST/ www.cloudflare.com 443

# 4. 出链接和二维码
node scripts/gen-link.mjs --host YOUR-HOST --uuid <你的UUID> --name My-Node --out ./out
```

## 验证判读

| 输出 | 含义 |
|---|---|
| `relay header: 0000 (OK)` + `TLS handshake OK` + `ip=...` | 节点可用 |
| `relay header: 4854 (HT)` | 服务端没发响应头（模板坑 1） |
| header 出现两次 / `wrong version number` | 握手包被解析两次（模板坑 2） |
| `TIMEOUT` | 实例休眠或出站被拦，先 HTTP 打开域名唤醒 |

## 服务端诊断端点

`GET https://<你的域名>/_status` 返回最近连接事件：

- `ok:true` + `target:"host:port"` → 客户端握手成功并连上了目标
- `why:"bad-key"` → 客户端 UUID 填错
- `why:"link:ECONNREFUSED"` → 出站被拒
- 没有新事件 → 请求没到服务端（本地网络/运营商拦）

远程给用户排障时，这是最快的抓手。

## 许可与用途

MIT。面向自建、内网穿透、CTF/靶场、所在地区合法的隐私网络用途；部署前请确认目标平台的 AUP 与当地法规，账号与节点的合规责任由使用者承担。
