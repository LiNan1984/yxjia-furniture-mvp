# 银杏家具 MVP · 银西 ZHA‐SHUI · 1973

> 实体店地址：陕西省商洛市柞水县乾佑街道 农机路河西
> 店铺电话：13359140982
> 营业：9:00 – 20:00 全年无休

---

## 1. 项目一句话

为柞水县银杏家具店做的家具电商 MVP + AI 试摆。
**顾客发客厅照 → AI 把店里沙发合成进客厅 → 满意来店下单。**
爸妈能直接用的老人友好界面。

---

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Node 22 + Express 4 | 单进程，0 数据库 |
| 对象存储 | MinIO (9000/9001) | 用户上传图、合成图、试摆结果 |
| 元数据 | 本地 JSON | `data/products.json` `orders.json` `users.json` `uploads.json` |
| 视觉合成 | `twofishai.com /v1/images/edits` (gpt-image-2) | 写真合成核心 |
| 视觉识别 | 阶跃 `step-3.7-flash`（Step Plan 路径） | 商品识别 + 全屋分析；方舟 doubao 兜底 |
| 语音导购 | 阶跃 **StepAudio 3 Realtime**（限免，开放平台路径 `/v1`）+ StepAudio 2.5 ASR/TTS 兜底（Step Plan） | `/api/voice/realtime` 实时全双工（默认，env `STEP_RT_MODEL`）；`/api/voice/ask` 一次性兜底 |
| 前端 | 单 HTML + 原生 CSS | 不引任何前端框架 |
| 设计 | Apple HIG + 极简两色调 | 深咖 #3a2818 + 奶白 #faf6ef |
| 测试 | Playwright (Node 48 + Python 23) | 共 71 测试 |

---

## 3. 启动（3 分钟）

```bash
cd yxjia-mvp
npm install

# MinIO（对象存储）
brew install minio  # 首次
minio server ~/minio-data --address :9000 --console-address :9001 &
# 用环境变量覆盖：MINIO_ROOT_USER=xxx MINIO_ROOT_PASSWORD=xxx

# 主服务（key 从 .env 或部署环境变量读，不要写死在 shell history）
export TWO_FISH_API_KEY="sk-xxx-from-your-account"
export ARK_API_KEY="ark-xxx-from-your-account"
node src/server.js
```

| 入口 | URL | 凭证 |
|------|-----|------|
| 顾客 | http://127.0.0.1:3000/ | — |
| 后台 | http://127.0.0.1:3000/admin | admin / 123456 |
| MinIO 控制台 | http://127.0.0.1:9001 | 见 .env（MINIO_ACCESS_KEY / MINIO_SECRET_KEY） |

> 验证码 MVP 固定 `123456`（生产请接真短信）

---

## 4. 关键 API 端点

### 顾客端

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/products` | 否 | 商品列表（默认仅"在售"） |
| GET | `/api/products/:id` | 否 | 商品详情 |
| POST | `/api/orders` | 否 | 创建订单（手机号必填） |
| GET | `/api/orders/by-phone/:phone` | 否 | 按手机号查 |
| POST | `/api/upload/room` | 否 | 顾客上传客厅（存 MinIO） |
| POST | `/api/tryon/ai-custom` | **是（用户）** | 写真合成 + 自定义 prompt |
| POST | `/api/tryon/ai-history` | **是（用户）** | 写真合成（URL 模式） |
| GET | `/api/tryon/presets` | 否 | 5 个预设 prompt |
| GET | `/api/tryon/history?phone=xxx` | 否 | 用户历史 |
| POST | `/api/auth/send-code` | 否 | 发验证码（固定 123456） |
| POST | `/api/auth/login` | 否 | 登录（自动注册） |
| GET | `/api/auth/me` | 否 | 当前用户 |
| POST | `/api/auth/logout` | — | 退出 |
| POST | `/api/voice/ask` | 否 | 语音导购（一次性）：录 WAV → ASR → 商品库问答 → TTS mp3 |
| GET | `/api/voice/realtime` | 否（WS） | 语音导购（实时）：stepaudio-2.5-realtime 全双工代理，服务端注入商品库人设，并发上限 3 |
| GET | `/api/voice/status` | 否 | 语音导购就绪状态（排障用） |

### 后台端

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/admin/login` | 否 | 后台登录（admin/123456） |
| POST | `/api/admin/upload-and-identify` | admin | 上传图 + doubao AI 命名 |
| GET | `/api/admin/products/:id` | admin | 取单个商品（含下架） |
| PATCH | `/api/admin/products/:id` | admin | 改商品字段 |
| POST | `/api/admin/products/:id/toggle` | admin | 上下架（在售/下架） |
| POST | `/api/admin/products/:id/retake-image` | admin | 重新拍照换主图（multer 单文件） |
| POST | `/api/admin/products/batch` | admin | 批量改商品（multi-select） |
| DELETE | `/api/admin/products/:id` | admin | 删商品 |
| GET | `/api/admin/rooms` | admin | 列出已上传顾客客厅图 |
| DELETE | `/api/admin/rooms/:id` | admin | 删除顾客客厅图 |
| GET | `/api/admin/tryon-results` | admin | 列出试摆合成结果 |
| GET | `/api/admin/presets` | admin | 读 5 个试摆预设 prompt |
| PUT | `/api/admin/presets` | admin | 写预设 prompt |
| GET | `/api/admin/feature-flags` | admin | 读运行时开关 |
| PUT | `/api/admin/feature-flags` | admin | 写运行时开关 |
| GET | `/api/admin/backup` | admin | 导出 data/*.json 备份 |

### 公开配置

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/feature-flags` | 否 | 读运行时开关（前端用） |
| GET | `/api/tryon/presets` | 否 | 5 个预设 prompt（公开） |

---

## 5. 文件结构

```
yxjia-mvp/
├── src/
│   ├── server.js              # Express 后端主入口（路由 + 鉴权 + MinIO）
│   ├── index.html             # 顾客首页（hero + 试摆 + 6 款家具 + 联系）
│   ├── product.html           # 商品详情
│   ├── checkout.html          # 下单页
│   ├── order.html             # 订单确认
│   ├── tryon.html             # 试摆表单（公开入口）
│   ├── my-orders.html         # 我的订单（登录后）
│   ├── login.html             # 顾客登录
│   ├── admin/                 # 后台管理
│   │   ├── login.html         # /admin 登录页
│   │   ├── index.html         # 4 块功能入口
│   │   ├── product.html       # A. 上传商品图（单条）
│   │   ├── products.html      # 商品管理列表（编辑/上下架/删除/批量）
│   │   ├── room.html          # B. 上传顾客客厅（单条）
│   │   ├── rooms.html         # 客厅图管理列表
│   │   ├── presets.html       # 试摆预设 prompt 编辑
│   │   ├── tryon.html         # C. AI 试摆（手动选）
│   │   ├── tryon-results.html # 试摆历史结果浏览
│   │   ├── orders.html        # D. 订单列表
│   │   └── feature-flags.html # 运行时开关编辑
│   └── images/                # 静态图（构建时就有，不上传）
├── data/
│   ├── products.json          # 商品（含 status 字段：在售/下架）
│   ├── orders.json            # 订单（gitignore 排除）
│   ├── users.json             # 用户（gitignore 排除）
│   ├── uploads.json           # 上传历史（gitignore 排除）
│   ├── presets.json           # 5 个试摆预设 prompt
│   └── feature-flags.json     # 运行时开关（如 tryonRequirePhone）
├── uploads/                   # MinIO 同步目录（gitignore 排除）
│   ├── products/
│   ├── rooms/
│   └── compositions/
├── tests/                     # 42 个 E2E 测试
│   ├── api.test.js            # Node Playwright 36
│   ├── conftest.py
│   ├── test_01_browse.py ~ test_05_api.py  # Python 5（老人视角）
│   └── test_06_admin_user_system.py        # Python 1（后台 + 用户 + 上传 + 试摆）
├── docs/方案.md               # 营销方案
├── prompts/                   # GPT-Image2-Skill prompt 库
├── integrations/              # 4 个克隆的 OSS 项目（参考用）
├── ROADMAP.md                 # v1.1→v3.x 升级路线
├── Dockerfile                 # 容器化
├── docker-compose.yml         # MinIO + server
├── render.yaml                # Render.com
├── wrangler.toml              # Cloudflare Pages
├── package.json
├── playwright.config.js
├── pytest.ini
└── CLAUDE.md                  # 你正在读
```

---

## 6. 商品数据流

```
预填 6 款（手工）: sofa-1, sofa-2, sofa-3, cabinet-1, bed-1, table-1
   ↓
AI 识别新增（v2 标识 p-xxx）: 顾客上传图 → doubao 命名 → 自动加进 products.json
   ↓
试摆调用: /api/tryon/ai-custom?productId=p-xxx&room=...
   ↓
合成图存 MinIO: yxjia-uploads/compositions/comp-{ts}.jpg
   ↓
URL 直接返: http://127.0.0.1:9000/yxjia-uploads/compositions/comp-{ts}.jpg
```

---

## 7. 关键设计原则（不可违反）

1. **两个色调**：`#3a2818`（深咖）+ `#faf6ef`（奶白）。不引红/绿/蓝/黄原色
2. **不引前端框架**（React/Vue/Next.js 都不用），纯 HTML + CSS
3. **真实家具图为卡片**，不用 emoji 占位
4. **不引数据库**（Postgres/MongoDB 都不用），所有数据 JSON
5. **写真合成**强制**用户登录**（防 Token 滥用）
6. **后台上传**走 multer 内存存储 + 异步写 MinIO（不写本地磁盘）
7. **HTTP 优先 HTTPS**：生产部署必须配 TLS

---

## 7.5 运行时配置

| 文件 | 作用 | 谁改 |
|------|------|------|
| `data/feature-flags.json` | 运行时开关（如 `tryonRequirePhone`：试摆前是否强制手机号门控） | 后台 `/admin/feature-flags` |
| `data/presets.json` | 5 个试摆预设 prompt（自然/暖光/夜晚/极简/家庭） | 后台 `/admin/presets` |

修改 → 写回 JSON → server.js 立即生效，无需重启。两文件前端通过 `/api/feature-flags` 与 `/api/tryon/presets` 公开读。

---

## 8. 部署

> **⚠️ 实际生产 = systemd 源码部署 + rsync（不是 Docker / GitHub）。** 下面 Docker / Cloudflare / Render 是历史规划，当前都没用；上新品/新照片还要单独灌生产 MinIO（见 §9）。

### 生产部署（systemd + rsync —— 真正在用的）
- 服务器 `72.60.193.189`（**真服务器，非蜜罐**——早前笔记误判 T-Pot，已证伪），应用目录 `/root/yxjia-mvp`（纯文件树、非 git，push GitHub **不**自动上线）
- systemd 单元 `yxjia`：`NODE_ENV=production PORT=3300 MINIO_ENDPOINT=127.0.0.1 TRUST_PROXY=1`；MinIO 是独立容器 `yxjia-minio`；宿主机端口 **3300**（3000 被 new-api 占）
- 日志在**文件** `/var/log/yxjia.log`（不在 journald）：`grep -iE "twofish|\[ai\]" /var/log/yxjia.log`
```bash
node --check src/server.js                 # 语法门禁
# 1) 远端留回滚点
SSHPASS='<pw>' sshpass -e ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no root@72.60.193.189 'cd /root/yxjia-mvp && cp src/server.js src/server.js.bak-$(date +%Y%m%d-%H%M%S)'
# 2) 只同步 src/（绝不碰 data/ 和 .env；别加 --delete）
SSHPASS='<pw>' sshpass -e rsync -av -e "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no" src/ root@72.60.193.189:/root/yxjia-mvp/src/
# 3) 重启 + 冒烟 + 真跑一次试摆验证出图
SSHPASS='<pw>' sshpass -e ssh ... root@72.60.193.189 'systemctl restart yxjia && systemctl is-active yxjia'
curl -s -o /dev/null -w "%{http_code}\n" http://72.60.193.189:3300/
```
- ⚠️ **Claude Code 沙箱会拦 SSH 数据流**：ssh/rsync 必须带 `dangerouslyDisableSandbox: true`；root 走密码认证（本机有 `sshpass`），密码运行时提供、**勿写文件/记忆**
- ⚠️ **合成用的 twofishai key = 生产 `.env` 的 `TWO_FISH_API_KEY`**：它是**运行时 dotenv 从生产 .env 读**的（systemd `Environment` 里没有、`/proc/<pid>/environ` 也看不到；**rsync 从不同步 .env**）→ **改本地 .env 的 key 不影响生产**。key 失效时上游回 `403 {"code":"GROUP_DELETED"}`，试摆会**静默退化成侧边预览**（见 §9）。可用模型 `gpt-image-1 / 1.5 / 2`（**没有 2.5**），`/v1/images/generations` 与 `/v1/images/edits` 均返回 `b64_json`。

### Docker（历史 / 未用）
```bash
docker build -t yxjia-mvp .
docker run -d --name yxjia \
  -p 3000:3000 \
  -e TWO_FISH_API_KEY="sk-..." \
  -e ARK_API_KEY="ark-..." \
  -e MINIO_ENDPOINT=minio \
  -e MINIO_ACCESS_KEY=... \
  -e MINIO_SECRET_KEY=... \
  -v $(pwd)/data:/app/data \
  yxjia-mvp
```

### Cloudflare Pages
项目根有 `wrangler.toml`，但 server.js 是 Node 风格。需要先重写为 Cloudflare Workers（`fetch` 事件模型）才能用 Pages Functions 部署。

### Render.com
项目根有 `render.yaml`：
- 选 Docker runtime
- 配 TWO_FISH_API_KEY / ARK_API_KEY / MinIO 环境变量

### 警告
- ✅ `72.60.193.189` 是**真服务器**（早前笔记误当 T-Pot 蜜罐，已证伪）；现用 systemd + rsync 源码部署，见上「生产部署」

---

## 9. 已知坑 & 修复

| 现象 | 原因 | 解决 |
|------|------|------|
| 写真合成 0 字节 | linter 把 `multer` import 删了 | 已修（重新 import） |
| doubao 返回 `¥¥` 双符号 | AI 输出不规范 | server 剥掉前缀 `¥` |
| 写真合成偶发超时 | gpt-image-2 网络 15-30s | 前端大读秒计时器缓解 |
| multipart 大文件解析失败 | 自写 parseMultipart 有边界 bug | 已用 multer memoryStorage 替代 |
| 旧 SSH 部署卡住 | ssh+弱密码 | 改用 GitHub push + Docker rebuild |
| linter 频繁改 server.js | 自动格式化工具 | Edit 后必须重启测试 |
| StepAudio 3 在订阅路径调不通 | 3 系列只在**开放平台路径** `/v1` 限免开放，Step Plan 订阅路径 404 | Realtime 走 `wss://api.stepfun.com/v1/realtime?model=stepaudio-3-realtime-preview`（`STEP_RT_MODEL`/`STEP_RT_BASE_URL` 可切回 2.25）；一次性兜底走 Step Plan 的 2.5 asr/tts。限免到期需换正式版 |
| 阶跃图像接口（生图/改图） | 官方公告 2026-10-10 全线下线 | 试摆合成保持 twofishai 主路径 + Pollinations 兜底，勿迁到阶跃图像模型 |
| 服务器重建 yxjia-mvp 容器后 MinIO 解析失败 | 容器必须在 `yxjia-net` 网络里才能解析 `yxjia-minio` | `docker network connect yxjia-net yxjia-mvp`，宿主机端口是 **3300**（3000 被 new-api 占用） |
| **源码部署时进程绑到 3000** | `server.js` 第 18 行读 `PORT` 在 dotenv 加载 `.env` **之前** | systemd 单元显式 `Environment=PORT=3300`（已配好：`systemctl status yxjia`，日志 /var/log/yxjia.log） |
| 语音导购点话筒没反应 | 重构遗留坏引用（`voiceLastAudioUrl`/`stopVoiceCapture`/`rtStopCapture` 未定义），点击第一行就抛 ReferenceError | 已修（2026-09-18）；改语音前端代码后必须用 Playwright 点一遍验证 |
| 商品列表只剩 AI 识别的几款 | admin 上传流程整体覆盖了 products.json，把 6 款手工核心商品冲掉 | 已从 git 历史（5b9f0c6）找回合并；以后改 products.json 走合并不要整体覆盖 |
| 试摆提示「AI 暂不可用」只给侧边预览、却没报错 | 生产 `.env` 的 `TWO_FISH_API_KEY` 失效，上游回 `403 {"code":"GROUP_DELETED"}`，step/Pollinations 两级兜底也失败 | 换生产 `.env` 的 key：`sed -i.bak-<ts> -E 's#^TWO_FISH_API_KEY=.*#TWO_FISH_API_KEY=<新key>#' /root/yxjia-mvp/.env && systemctl restart yxjia`。**rsync 不同步 .env**，别指望改本地生效 |
| 生产首帧合成很慢（实测 ~130s）| twofishai 冷启 + 生产网络出口 | 后端会等（fetch 无超时）；但**反代 / 前端超时（常见 60s）会掐断**，需把 `proxy_read_timeout` 与前端读秒调到 >130s |
| 从 `~/.codex/auth.json` 取到的 key 是空 | 该文件是 ChatGPT OAuth 登录（`OPENAI_API_KEY` 是空串），不是 twofishai 代理 key | twofishai key 一律取项目 `.env` 的 `TWO_FISH_API_KEY` |

---

## 10. 测试

```bash
# Node Playwright（48 个 API 测试）
cd yxjia-mvp
./node_modules/.bin/playwright test tests/api.test.js

# Python 老人视角（23 个流程测试）
source .venv/bin/activate
python3 -m pytest tests/test_01_browse.py tests/test_02_call_button.py tests/test_03_browse_products.py tests/test_04_order_flow.py tests/test_05_api.py tests/test_06_admin_user_system.py -v
```

测试覆盖率：API 100%，UI 关键流程（浏览/拨号/下单/查询订单/后台+用户系统）100%。
语音导购：接通后导购先打招呼（response.create 内联 instructions，~1.7s 首包）；
挂断后文字版对话记录保留在面板里可回看（气泡式，参考 OpenAI Realtime Console）。

---

## 11. 升级路线

| 版本 | 计划 | 优先级 |
|------|------|--------|
| v1.1 | 后台编辑 UI（web 表单直接改商品，不需要 curl） | 高 |
| v1.2 | 多结果预览（同时跑 2 个 prompt 出 2 张图，用户选） | 中 |
| v1.3 | 写真合成并发 3 张 | 中 |
| v2.0 | 微信小程序（同套商品数据） | 高 |
| v2.1 | Server酱推送（新订单→老板微信） | 中 |
| v2.2 | 短信验证码（替换固定 123456） | 高 |
| v3.0 | fork `SamurAIGPT/ai-real-estate-stager` 升级 Next.js SaaS | 中 |
| v3.1 | 部署到 Render.com / Cloudflare Pages | 高 |

---

## 12. 联系方式

- **店铺**：银杏家具（柞水县乾佑街道农机路河西）
- **电话**：13359140982
- **开发者**：林安

---

## 13. 完整业务流程（5 步）

```
1. 顾客打开 http://127.0.0.1:3000/
   → 看 hero 「沙发 / 搬进你家 / 再决定」
   → 选 6 款家具之一

2. 选「🪄 没有照片？用默认客厅图体验一下」
   或上传自家客厅照
   → 选预设 prompt（自然/暖光/夜晚/极简/家庭/自定义）

3. 点「立即生成」
   → 读秒计时器开始（0.0 → 12.3 → 28.7）
   → 调 /api/tryon/ai-custom
   → 写真合成（gpt-image-2）

4. 出图（~15-30s）
   → 右侧显示「写实合成图」
   → 满意 → 点「我想要这个」→ 下单
   → 不满意 → 点「↻ 重新生成」

5. 下单流程
   → 称呼 + 手机号 + 地址
   → 提交 → 写 orders.json + 写 MinIO 上传记录
   → 跳成功页（订单号 + 拨号按钮）
```

---

## 14. 调试常用命令

```bash
# 看 server 启动日志
tail -f /tmp/yxjia-mvp-3000.log

# 看 MinIO 状态
curl http://127.0.0.1:9000/minio/health/live

# 看 MinIO bucket 内容
node -e "
const Minio=require('minio');
const c=new Minio.Client({endPoint:'127.0.0.1',port:9000,useSSL:false,accessKey:process.env.MINIO_ACCESS_KEY,secretKey:process.env.MINIO_SECRET_KEY});
c.listObjectsV2('yxjia-uploads','',true).then(r=>r.objects.forEach(o=>console.log(o.key, o.size)));
"

# 写真合成手测
curl -X POST http://127.0.0.1:3000/api/tryon/ai-custom \
  -F 'room=@/path/to/room.jpg' \
  -F 'sofa=@/path/to/sofa.jpg' \
  -F 'productId=sofa-1' \
  -F 'prompt=暖光氛围' \
  -o /tmp/r.json -w "HTTP %{http_code} | %{size_download} bytes\n"
cat /tmp/r.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['data']['compositionUrl'])"

# 强制注册测试用户
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800138000","code":"123456"}'
```

---

## 15. 部署检查清单

- [ ] Node 22 装好
- [ ] MinIO server 启动（9000 端口）
- [ ] `yxjia-uploads` bucket 创建
- [ ] TWO_FISH_API_KEY / ARK_API_KEY 环境变量设好
- [ ] `npm install` 成功
- [ ] `node src/server.js` 启动无错
- [ ] 42 个测试全绿
- [ ] DNS 域名解析到服务器
- [ ] HTTPS 证书（Let's Encrypt）
- [ ] 防火墙开放 3000/9000/9001 端口

---

## 16. 阿杏 AI 家居助手（`/axing`，分支 `feat/axing-ai-assistant`）

> 产品定位：**「我是提前把家具搬到你家的 AI 助手，阿杏～」**
> 完整产品/技术 Spec：`docs/阿杏_AI家居导购助手_完整Spec_开发方案_v1.1_技术资料完善版.md`（Spec 里的 Next.js/R3F 是远期形态；本仓库铁律「不引前端框架」→ **落地版用原生 ES module + three.js，跑在现有 Express 后端上**）。

### 入口与端口

| 入口 | 说明 |
|---|---|
| `/axing`、`/axing/` | 阿杏单页壳（`src/axing/index.html`），与主站 `/` 并存同一进程 |
| `PORT=3400 node src/server.js` | 阿杏独立端口实例（同一套代码 + 同一份 `data/`，主站继续跑 3300/3000） |

### 结构

```
src/axing/
├── index.html        # importmap(three) + 10 个 <section class="view"> 容器 + 底部 Tab 壳
├── css/axing.css     # 设计语言对齐 docs/index.html：炭黑#2C2C2C/奶白#F7F4EF/石灰#D9D4CD/灰#77726C + 杏色#E8B27D
└── js/
    ├── app.js        # 路由壳：按需 import view-*.js；ctx = { api, ui, state, go, pickProduct… }
    ├── api.js        # 现有后端封装（products/chat/guide/voice/upload/tryon-anon/orders/appointments/scenes）
    ├── ui.js         # el()/productCard/axingSay/mdToNodes(防XSS)/parsePrice 等共享件
    ├── three-viewer.js  # three.js 舞台（OrbitControls 360°/换色/换材质/缩放/尺寸标注/截图）
    ├── furniture.js     # 程序化家具库（sofa3/sofaL/sofaSingle/coffee/tvCabinet/bed + 色板 + 材质）
    └── view-*.js     # 10 个 view：home/voice/upload/products/tryon/3d/material/booking/plans/me
```

**view 契约**：每个 `view-*.js` 导出 `mount(root, ctx)`，首次进入该 view 时调用；跨页状态走 `ctx.state`（localStorage 持久化：productId/roomUrl/phone…），跨页事件 `ctx.emit/on('product:selected'|'scene:style'|'plan:changed')`。

### three.js（本地 vendor，不依赖 CDN / 不新增运行时依赖）

- `src/vendor/three/three.module.min.js` + `three.core.min.js` + `addons/controls/OrbitControls.js`（npm 包 `three` 的构建产物拷贝；版本记录在 package.json。注意 min 构建内部引用兄弟文件 `./three.core.min.js`，**别改成不带 .min 的名字**）
- 裸导入 `import * as THREE from 'three'`、`'three/addons/controls/OrbitControls.js'`，由 index.html 的 **importmap** 解析 → 生产 rsync `src/` 即可用，无需在服务器 `npm install`
- WebGL 失败自动降级为商品图片预览（view-3d 的 `onError` 兜底）

### 复用现有后端 + 新增轻量接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/products`、`/api/tryon/presets`、`/api/categories` | 真实商品/预设/示例房间 |
| POST | `/api/chat/guide` | 阿杏文字导购（Markdown） |
| POST | `/api/voice/ask` | 录音 → ASR → 导购 → TTS |
| POST | `/api/upload/room` | 客厅照 → MinIO |
| POST | `/api/tryon/ai-anon` | 2D AI 试摆（每 IP 每天 3 次） |
| POST | `/api/appointments` / GET `/api/appointments/by-phone/:phone` | **新增**：到店预约 → `data/appointments.json` |
| POST | `/api/scenes` / GET `/api/scenes/by-phone/:phone` | **新增**：保存方案 → `data/scenes.json`（items 含 `compositionUrl`/`roomUrl`） |
| GET | `/api/admin/appointments` / PATCH `/api/admin/appointments/:id` | **新增**：店主看预约 + 改状态（`requireAdmin`）。顾客约了店主要能看见，否则闭环是断的 |

`data/appointments.json`、`data/scenes.json` 含手机号，已加 .gitignore；写入沿用现有 `loadContainer/saveContainer` + `ok/fail` 模式，未登录按手机号可查但加 IP 限额（仿 `/api/tryon/history`）。

### 聊天链路（2026-10-05 交互规范落地）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/chat/guide` | 阿杏文字导购（一次性，Markdown） |
| POST | `/api/chat/guide/stream` | **SSE 流式**（前端默认走这条）：`status/thinking/tool/delta/done/error` 五类事件，底层是 Agents SDK `runner.run({stream:true})` |
| GET | `/api/chat/guide/status` | 导购模型就绪状态 |

**常驻对话中枢 `src/axing/js/chat-core.js`**：聊天气泡不再归 `view-home.js` 的本地变量（那正是「在别页发消息、自己那条落进 `display:none` 容器里」的根因）。时间线由 app shell 级中枢持有，`send()` 第一步就是「不在 `view-home` 就先切回去」，消息存自己的数组，`attachTimeline` 渲染进 view-home 给的 host。

**Markdown 渲染 `src/axing/js/markdown.js`**：vendor 了 ynet-render-markdown 的 H5 ESM 源文件，对外暴露 `renderMarkdown` / `createMarkdownStream`。**禁止调用上游 `injectMarkdownStyle()`**（它注入 `#2F7CF6` 蓝 / `#B42318` 红，违反两色调铁律），样式全走 `css/markdown.css` 的 `.md-*` 类；上游的 `ynet-md-*` 类名在渲染层改写成 `md-*`。上游解析器丢掉有序列表序号，所以**没有 `.md-ol`**。

**上传客厅照是底部浮窗不是全屏页**（`sheet-upload.js`，交互规范 §1-2）：底部推入 0.15s、最高 724px、蒙版/Esc/把手上滑取消。`view-upload.js` 只剩 20 行适配器，路由保留（hash 直入 + 其它 view 的 `ctx.go('view-upload')` 兜底）。

**CSS 拆四个模块文件**，别都往 `axing.css` 里塞：`axing.css`=token+壳+通用件，`markdown.css`=`.md-*`，`chat.css`=对话层，`cards.css`=阿杏卡片。并行开发时按文件边界分工。

**交互规范全文**：`docs/阿杏交互规范.md`（参照《喜豆AI银行交互规范.pdf》写的）；`docs/需求记录-阿杏交互规范.md` 记实测坐实的问题；`docs/阿杏交互规范-落地契约.md` 是 agent team 的唯一契约。

### 测试

```bash
./node_modules/.bin/playwright test tests/axing.test.js              # 8 个（自带 3100 端口实例）
./node_modules/.bin/playwright test tests/axing-ui.test.js           # 23 个（3412）
./node_modules/.bin/playwright test tests/axing-admin.test.js        # 11 个（3420）
./node_modules/.bin/playwright test tests/axing-interaction.test.js  # 17 个（3430）：A1~A10 交互验收 + B1~B6 第二波实测洞
./node_modules/.bin/playwright test tests/axing-journey.test.js      # 14 个（3460）：四条真实顾客旅程 + 浮窗模态与出路
./node_modules/.bin/playwright test tests/markdown.spec.js           # 5 个（3425）：Markdown 渲染
node src/axing/tests/markdown.smoke.mjs                              # 45 断言（不在 playwright testDir 里，要手跑）
./node_modules/.bin/playwright test                                  # 全量
```

**全量一定要加 `--workers=1`**：这棵树是多会话共享的，`playwright.config.js` 的 webServer 抢 3000 端口，并行跑会互相打死对方的 server（报 `Process from config.webServer was not able to start` / `ERR_CONNECTION_REJECTED` 的假失败）。跑之前先 `node --check src/server.js`——别会话改出的语法错误会造一批假红。

**Axing 五件套 = 8 + 23 + 17 + 14 + 11 = 73 条**（另有 D/E/F 组的 `tests/e2e-customer-*.test.js` 是别组交付的，跑全量时一起过）。`tests/api.test.js` 早前那 10 条红是 `data/products.json` 被整体覆盖丢掉 `sofa-1`/`table-1` 的数据债，已由 `1a51d0d`/`9e90327` 修好——**判别是不是数据债的方法：`git stash` 后单跑同样红，就是债不是回归**。

### 阿杏改前端必须知道的四个坑

1. **量坐标前必须等动画真的播完。** `is-open` 是「先加 class 再播 0.15s 过渡」，class 一加上那一帧面板还在屏幕外（实测 `panelTop=634/844`）。所以判据不能是「把手 top >= 0」或「top < innerHeight」——滑行途中总有一刻满足，随后 `mouse` 起始点落在没升上来的面板上，整条手势静默失效。**等 `getComputedStyle(panel).transform` 收敛到 `none` / `matrix(1,0,0,1,0,0)`**。同类坑：`elementFromPoint` 用视口坐标，折叠线下面的元素要先 `scrollIntoView` 再取点，否则测的是「在不在屏上」而不是「有没有被盖住」；流式气泡是懒建的，第一个 delta 前没有 `.ax-msg--streaming`，只用「没有 streaming」判断答完会立刻 resolve（必须同时等 streaming 和 typing 都消失）。

2. **固定栏挡底部的是 Composer 不是 Tab。** Tab 64px，但 Composer 71px 紧贴在它上面，`#views` 的可见区只到 Composer 顶。任何「主按钮 / 可点 chip 必须在首屏」的断言都要以 Composer 为基准，以 Tab 为基准会漏 71px。

3. **可点高度 44px 的下限不只管 `button`/`.tile`。** `tests/axing-ui.test.js` F1 只量 `.ax-quick__tile / .ax-ucard / #view-home .chip / .tab`，把 `div` 手柄整个漏了——上传浮窗的把手原来只有 **4px 高**，而它是顾客拖掉浮窗的手势出口（蒙版只露顶部一条、Tab 在浮窗开着时被 `pointer-events:none` 挡着），对粗手指等于没有。现在把手是「`::after` 画 4px 可见条 + 本体撑 44px 命中区 + `-24px` 负 margin 把占位高度压回 20px」。注意 `*{box-sizing:border-box}`，padding 撑不了命中区。

4. **`touch` 的隐式指针捕获会遮住鼠标/触控板的 bug。** 拖把手的 `pointermove` 监听挂在 `panel` 上，手指一旦拖出浮窗体，事件 target 就变成蒙版；触屏有隐式捕获所以看着是好的，笔记本触控板下完全失效。修法是 `setPointerCapture`（Playwright 的 `page.mouse` 正好走无隐式捕获那条路，能当回归用）。

**首页是「聊天优先」单屏**（视觉基准 `docs/最新首页图.png`）：阿杏 hero → 上传客厅照卡（第一 CTA，带阿杏头像）→ 上次试摆 → 四大功能 → **对话时间线** → 你可以这样问（沉底）→ 打给店里。时间线必须**贴在 Composer 上方**——chat-core 每次新消息都 `views.scrollTop = scrollHeight`，时间线排在 hero 旁边时滚到底看到的是拨打按钮和 chips，最新气泡反而在屏幕外。`#views` 是唯一滚动区，Composer + Tab 是固定底栏；Composer 只在 `view-voice` 让位。CSS 里给会互相切换显隐的元素必须显式写 `[hidden]{display:none}`——`img{display:block}` / `display:flex` 都会盖掉 UA 规则（返回键常显、发送/图片按钮同显、浮窗里漏出「我的客厅」alt 文字都踩过）。

**产品经理批判**：`docs/pm-critique-20261005-阿杏v2.1.md`（17 条 / 5 个 🔴）。最重要的一条：店主原先在后台**看不见任何预约**，闭环是断的——已补 `/api/admin/appointments` + `/admin/appointments.html`。剩下的排在 `docs/handoff-20261005-阿杏AI助手.md` §8.6。

---

*最后更新：2026-10-05 · 阿杏 AI 家居助手分支（交互规范落地 + 第二波真实顾客实测：上传浮窗把手 44px / Composer 相册键直达 / 试摆主按钮上移 / 追问 chip 回归）*

