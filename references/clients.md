# 客户端字段对照与导入

## 参数必须自洽

| 字段 | 值 | 错了会怎样 |
|---|---|---|
| 地址 / Address | 部署域名 | 直接连不上 |
| 端口 / Port | 443 | 边缘只开 443（或 80/8080/2052 等 CF 端口） |
| UUID | 32 位 hex | 服务端 `/...` 返回 `why:"bad-key"` |
| 传输 / Network | `ws` | 用 tcp 会握手失败 |
| 路径 / Path | `/` | 服务端接受任意路径，但客户端必须发同一路径 |
| Host（WS header） | 部署域名 | 边缘会 400 / 拒绝 upgrade |
| TLS | 开 | 客户端不发 TLS 会被边缘断开 |
| SNI | 部署域名 | 证书与 SNI 不符 → 握手失败 |
| ALPN | `http/1.1` | 边缘多为 HTTP/1.1 反代，h2 会失败 |

`fp=chrome`（uTLS 指纹）是可选项；某些老客户端不认，去掉即可。`allowInsecure` 不需要开——托管平台证书是正规签发的。

## 各客户端导入方式

| 平台 | 软件 | 导入 |
|---|---|---|
| iOS | Shadowrocket | 首页右上角 `+` → 类型 VLESS → 按上表填；或扫码；或复制链接后「从剪贴板导入」 |
| iOS | 系统相机 | 扫二维码 → 弹出 `vless://` → 选 Shadowrocket 打开 |
| iOS | V2Box / sing-box / Stash / Loon | 均支持 VLESS+WS+TLS；V2Box 有「扫描二维码」 |
| Android | v2rayNG | 右上角 `+` → 「从二维码扫描」或「从剪贴板导入」 |
| Android | NekoBox / sing-box / Hiddify | 同上 |
| Windows | v2rayN | 「服务器」→「扫描屏幕上的二维码」 |
| Windows | NekoRay / Mihomo Party | 支持粘贴 `vless://` |
| macOS | Shadowrocket(M 系) / V2Box / sing-box / Mihomo Party | 粘贴链接或扫码 |

## 判定"真的通了"的唯一标准

1. 客户端测延迟出数字（说明 WS+TLS+VLESS 四层握手过了）。
2. 浏览器开 `https://www.cloudflare.com/cdn-cgi/trace`，`ip=` 等于节点出口 IP。
   —— 页面有缓存风险，加个 `?t=时间戳` 更稳。
3. `https://ip.sb` / `https://ipinfo.io/json` 交叉核对 IP 与地区。

延迟测试用的是客户端内建 ping 目标（多为 `gstatic.com/generate_204`）。所以**只要
`verify-tls.mjs` 或 `curl -x socks5 ... https://www.gstatic.com/generate_204` 能返回 204，
客户端的 ping 就一定不会 timeout**——这是可以离线自证的等价条件。
