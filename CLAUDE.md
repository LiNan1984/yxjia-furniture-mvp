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

### Docker
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
- ❌ **不要**用 `ssh root@72.60.193.189` 蜜罐 IP 部署！改用本仓库的 GitHub push + 自己的真服务器
  （CLAUDE.md 这条历史警告是把 `72.60.193.189` 当成 T-Pot 蜜罐；用户已确认这是他的真服务器，
  但 ssh+弱密码的部署方式已废，迁移到 GitHub + Docker image rebuild 流程）

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

*最后更新：2026-09-18 · 语音导购修复迭代版（打招呼 + 文字记录 + 6 款核心商品找回 + 71 测试全绿）*
