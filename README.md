# Linewatch · 价格线提醒

独立网页：选择 Binance USDT 现货交易对 → 点击图表放置水平线 → 选择向上突破／向下跌破 → Telegram 收到消息。

后台持续读取 Binance aggregate-trade WebSocket，与浏览器是否打开无关。支持 BTC、ETH、SOL、BNB、XRP、DOGE。图表提供 1分、15分、1时、4时、1天 K 线，滚轮或按钮缩放、移动模式平移、拖动已有线调整价格。也可用「添加」直接输入价格。K 线每 20 秒刷新，最新成交价每 2 秒显示；后台逐条处理收到的成交推送。

## Railway 部署

1. 在 Railway 新建 Project → Deploy from GitHub repo → 选择 `teewei99/tradingview`，使用 `main` 分支。
2. 给服务添加 **Volume**，挂载路径 **`/data`**。SQLite 数据库与待发送队列保存在这里，不能仅保存在容器临时文件系统。代码在生产环境缺少 Volume 时拒绝启动。
3. 在服务的 **Variables** 设置下表。不要把 Token 提交到 GitHub。
4. 在服务 Settings 关闭 **Serverless / App Sleeping**；保持 **1 个副本**。不要启用多副本，此版本使用单机 SQLite 与单个行情消费者。
5. Settings → Networking → Generate Domain。Dockerfile 使用 Node 24，Railway 自动提供 PORT；健康检查 `/healthz` 检查进程，不代表 Binance / Telegram 已联网。
6. 部署成功后打开网址，用 APP_PASSWORD 登录。点击「发送测试」，在手机确认收到 Telegram 消息，再设置提醒。
7. 检查网页显示「行情在线」。若 Binance 返回区域限制或连接失败，需选择 Binance 允许服务的部署区域，并遵守其服务限制；不要把健康检查通过当成行情已可用。

| Variable | 设置 |
|---|---|
| `APP_PASSWORD` | 自己生成的长随机密码，至少 16 个字符，用于网页登录 |
| `TELEGRAM_BOT_TOKEN` | BotFather `/newbot` 返回的 Token |
| `TELEGRAM_CHAT_ID` | 机器人给你发私信时使用的数字 Chat ID |
| `DATA_DIR` | `/data`（Dockerfile 已设置） |

### Telegram Chat ID

在 Telegram 打开你创建的机器人并点击 Start，然后发一句消息。在 Railway 服务 Shell 中运行 **`node scripts/chat-id.mjs`**（或本机设置 `TELEGRAM_BOT_TOKEN` 环境变量后运行同一命令）。脚本只打印可选会话的名称与数字 ID，不输出 Token。将你自己的私聊 ID 填到 Railway Variables 的 `TELEGRAM_CHAT_ID`。不要选其他人的会话。此脚本需要该机器人没有被其他程序使用 webhook / getUpdates；建议为本工具创建独立机器人。

### 触发规则与运行限制

- 向上突破：上一笔价格 < 目标价，当前价格 >= 目标价。向下跌破反之。等于目标价后继续同方向移动，不重复触发。
- 建立或拖动线本身不发送提醒。如果当前已经处于目标的另一侧，等待下一次真正按指定方向穿越。
- 每条提醒只触发一次。触发状态与 Telegram 待发送消息在同一 SQLite 事务中保存；失败按退避重试，最长间隔 5 分钟。前端显示投递状态。
- 断线自动重连；重新连接、服务重启或行情超过 30 秒无更新时，重新建立价格基准。**不补算中断期间的穿线**，因此短暂行情可能漏报。页面明确显示连接状态；本工具不是保证送达的交易系统。
- Telegram 已收到消息但后台未收到响应，或进程在送达后、记账前崩溃，重试可能重复投递。消息带提醒编号，方便识别。
- Railway 暂停、账单限额停机、Volume 丢失、Binance 区域限制或 Telegram 网络故障都会影响提醒。需要持续运行的付费资源，具体费用由 Railway 使用量决定。
- 登录会话 24 小时有效，服务重启后需要重新登录，不影响已存提醒。Token 只在服务器环境变量中。网页不提供交易或 Binance API Key 功能。
- 这是单用户工具，所有登录者共享提醒。妥善保管 APP_PASSWORD 和 Volume 备份。

## 本机开发

要求 Node.js 24+，不需要安装第三方依赖。

复制 `.env.example` 为 `.env`，填入设置，然后：

```sh
node --env-file=.env server.mjs
```

打开 `http://localhost:3000`。本地运行时电脑必须保持开机，关闭终端会停止后台；只有部署到持续运行的 Railway 服务后才可关机。

```sh
npm test
```

测试覆盖方向与边界、一次触发、修改与取消、无效输入、重启持久化、失败重试、登录和跨站防护、离线不创建提醒。自动化测试使用模拟 Telegram，**不会向真实账户发送消息**。

## 文件

- `server.mjs`：HTTP、登录、行情代理、提醒 API。
- `lib/market.mjs`：WebSocket 与重连。
- `lib/store.mjs`：SQLite 事务与穿线判断。
- `lib/telegram.mjs`：Telegram 发送与重试。
- `public/`：中文响应式网页与 Canvas 图表。
- `Dockerfile` / `railway.toml`：部署与健康检查。
