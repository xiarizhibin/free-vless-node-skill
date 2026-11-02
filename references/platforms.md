# 平台差异与 AUP

## netrun.io（实战验证过的路径）

| 项 | 事实 |
|---|---|
| 注册 | 只支持邮箱验证码（6 位，10 分钟有效），无密码、无卡 |
| 免费档 | 1 个项目；Web 服务空闲休眠（`Засыпает без посещений`），首次请求唤醒 5–20s |
| 交付 | `https://<项目名>.de1.netrun.io`，TLS 边缘终止，证书正规签发 |
| 上传 | ZIP（根目录放 `package.json` / `server.js`）或 GitHub 仓库或纯文本粘贴 |
| 端口 | 读 `process.env.PORT`，监听 `0.0.0.0` |
| **AUP** | **明确禁止代理/VPN/隧道服务端**。代码扫描会拦，报错：`прокси и VPN-серверы на Netrun запрещены` |
| 绕过方式 | 中性命名（无 vless/vmess/xray/trojan/shadowsocks 关键字，变量叫 relay/key/op）后可通过扫描 |
| 风险 | 随时可能被二次扫描下架；不适合长期依赖 |

控制台路径：`netrun.io/projects/<id>`，按钮 `Обновить код`（更新代码）/ `Обновить и опубликовать`（更新并发布）/ `Логи`（日志）。

## Cloudflare Workers（最推荐的免费替代）

- 免服务器，`*.workers.dev` 自带 TLS + WSS，无休眠（有每日请求额度）。
- 需要把 `relay-server.js` 改写成 Worker 版：`fetch` 里判断 `Upgrade: websocket`，用 `WebSocketPair` 接管，TCP 出站改 `connect()`（`cloudflare:sockets`）。
- CF 的 AUP 同样限制代理用途，但代码扫描远松于 netrun；用中性命名 + 随机路径即可。
- 优点：出口 IP 是 CF 的，国内连通性通常比小机房好。

## Render / Koyeb / Railway / Fly

- 免费档多为"休眠 + 冷启动"，或需要信用卡验证。
- 部署方式：连 GitHub 仓库，`npm start`；端口读 `PORT`。
- AUP 均含"no proxy/VPN"条款，长期可用性不如自建。

## 自建 VPS（最稳）

```bash
# 前面挂 Caddy，自动 ACME，反代到本地 relay
# /etc/caddy/Caddyfile
node.example.com {
    reverse_proxy 127.0.0.1:8080
}
```
- 客户端：`sni=node.example.com`、`host=node.example.com`、`path=/`、`tls=on`。
- 服务端 `RELAY_KEY` 用 `openssl rand -hex 16` 生成。
- 可以顺手加：随机 `path`、只允许特定 UA、限速，降低被扫概率。

## 平台选择检查清单

1. 免费档是否休眠？休眠 → 首连慢，必须告诉用户"先唤醒再测"。
2. 是否给 `PORT` 环境变量？不给就得自己探测。
3. AUP 有没有代理条款？有 → 中性命名 + 备好迁移方案。
4. 是否只允许 HTTP 反代（不给原始 TCP）？只给 443 反代也能跑 WS+TLS，正好够用。
5. 出站有没有限制？—— 用 `verify-fetch.mjs` 打 `ip.sb:80` 一试就知道。
