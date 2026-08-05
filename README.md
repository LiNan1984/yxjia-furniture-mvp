# 银杏家具 MVP

> 面向爸妈能用的家具电商 — 银杏家具 · 时光不负此行

店铺：**陕西省商洛市柞水县乾佑街道 农机路河西**
电话：**13359140982**
主营：沙发 / 柜子 / 床 / 餐桌 / 各类家具

## 一句话定位

「**发张照片，沙发先搬进你家**」——顾客把客厅照片发过来，店家用 AI 把店里沙发合成进顾客家客厅，满意再来店里试坐。

## 技术栈

- 后端：Node.js + Express（纯 JSON 文件存储，零数据库）
- 前端：原生 HTML + CSS + JS（无 React / 无 Tailwind / 无构建步骤）
- AI 试摆：twofishai `gpt-image-2`（multipart/form-data → base64 返回）
- 测试：pytest（23 个）+ Playwright（36 个）= **59 个测试**
- 运行端口：**3000**

## 3 分钟部署

```bash
# 1. 装依赖（一个 express，外加 multer 解析 multipart）
npm install

# 2. 启动（端口 3000）
npm start               # 生产模式
npm run dev             # 开发模式（node --watch，自动重载）

# 3. 跑测试
source .venv/bin/activate && python3 -m pytest tests/   # pytest 23 个
npx playwright test                                       # Playwright 36 个
```

启动后访问：

- 首页：<http://127.0.0.1:3000/>
- 顾客登录：<http://127.0.0.1:3000/login>
- 我的订单：<http://127.0.0.1:3000/my-orders>
- 家具详情：<http://127.0.0.1:3000/product/sofa-1>
- 在线试摆：<http://127.0.0.1:3000/tryon>
- 下单页：<http://127.0.0.1:3000/checkout/sofa-1>
- 订单详情：<http://127.0.0.1:3000/order/O12345678>
- **后台登录**：<http://127.0.0.1:3000/admin>（账号 `admin` / 密码 `123456`）

## 完整功能清单

### A. 公开页面（顾客侧）

| 路径 | 功能 |
|------|------|
| `/` | 首页 + 6 款家具 + 三步流程 |
| `/product/:id` | 家具详情 |
| `/checkout/:id` | 下单页 |
| `/order/:id` | 订单详情 |
| `/tryon` | 在线试摆（旧版占位） |
| `/login` | 顾客手机号 + 验证码登录（验证码固定 123456） |
| `/my-orders` | 我的订单（按登录手机号） |

### B. 后台管理（店主侧）

入口 `/admin`（登录页）：

| 子页 | 功能 |
|------|------|
| `/admin/index` | 后台首页（4 个功能块大字入口） |
| `/admin/product` | A. 上传商品图（商品名 + 价格 + 尺寸 + 分类 + 文件） |
| `/admin/room` | B. 上传顾客客厅图 |
| `/admin/tryon` | C. AI 试摆（选客厅图 + 沙发商品 → 调 twofishai） |
| `/admin/orders` | D. 订单列表（按时间倒序，一键拨号） |

每个按钮 ≥ 64px 高，红色大字错误提示，固定电话栏。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `3000` | 监听端口 |
| `TWO_FISH_API_KEY` | （空） | twofishai 的 gpt-image-2 API key。未设置时 `/api/tryon/ai` 进入兜底分支，保存顾客原图 |
| `ADMIN_USER` | `admin` | 后台账号（MVP，硬编码 `admin/123456`） |
| `ADMIN_PASSWORD` | `123456` | 后台密码（正式上线务必改） |

## API 文档

所有响应使用统一包装 `{success: true, data: {...}}` 或 `{success: false, error: "..."}`。

### 产品

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/products` | 获取所有产品（含 store 元信息） |
| GET | `/api/products/:id` | 获取单个产品 |

### 订单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/orders` | 获取所有订单 |
| GET | `/api/orders/:phone` | 按手机号查询订单（O 前缀自动按 ID 查询） |
| POST | `/api/orders` | 创建订单（需 `name` + `phone` + `productId`） |

### 顾客用户系统

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/send-code` | 入参 `{phone}` 返回 `{ok}`（验证码固定 123456） |
| POST | `/api/auth/login` | 入参 `{phone, code}` 返回 `{ok, token, user}`（首次登录自动创建用户） |
| POST | `/api/auth/logout` | 清 session |
| GET | `/api/auth/me` | 返回当前登录用户 |
| GET | `/api/users/:id/uploads` | 仅本人或 admin 可查 |

### 上传（multipart/form-data）

| 方法 | 路径 | 字段 | 说明 |
|------|------|------|------|
| POST | `/api/upload/room` | `file`（顾客客厅图） | 保存到 `uploads/rooms/{uuid}.{ext}` |
| POST | `/api/upload/product-image` | `file` + `name` + `price` + `size` + `category` | 上传后追加到 products.json |
| POST | `/api/tryon/ai` | `room`（file）+ `sofa`（file）+ `productId` | 调 twofishai gpt-image-2，返回 base64 + 保存到 `uploads/compositions/` |

**`/api/tryon/ai` 响应示例**：

```json
{
  "success": true,
  "data": {
    "ok": true,
    "product": { "..." },
    "compositionUrl": "/uploads/compositions/composition-1234.jpg",
    "compositionBase64": "data:image/jpeg;base64,...",
    "aiError": null,
    "message": "AI 试摆成功"
  }
}
```

失败兜底：`compositionUrl: null`，保存顾客原图到 `uploads/compositions/fallback-*.jpg`。

### 后台登录

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | 入参 `{username, password}` 返回 `{ok, token}`（设 cookie） |

## 数据存储

- 产品：`data/products.json`（`{store, products}`，运行时追加）
- 订单：`data/orders.json`（`{orders}`，POST 时 `unshift` 到头部）
- 用户：`data/users.json`（`{users}`，自动注册）
- 上传文件：`uploads/{products,rooms,compositions}/{uuid}.{ext}`

无数据库，零运维。备份 = `cp data/*.json uploads/ backup/`。

## 部署到 Render.com（推荐，3 分钟）

1. 把仓库推到 GitHub
2. 登录 Render → New → Web Service → 连仓库
3. Render 会自动读 `render.yaml`：
   - Build Command: `npm install`
   - Start Command: `node src/server.js`
   - Health Check: `/`
4. 在 Environment 里填：
   - `TWO_FISH_API_KEY` = 你的 codex key
   - `ADMIN_PASSWORD` = 强密码
5. 等 2 分钟拿到 `https://xxx.onrender.com`

## 部署到 Cloudflare Pages + Workers

`wrangler.toml` 已写好，Pages Functions 跑后端或 Workers 转发 API 都可以。

```bash
npx wrangler pages deploy src
```

## Docker 部署

`Dockerfile` 已写好（node:22-alpine）：

```bash
docker build -t yxjia-mvp .
docker run -p 3000:3000 \
  -e TWO_FISH_API_KEY=sk-... \
  -e ADMIN_PASSWORD=xxx \
  -v $PWD/data:/app/data \
  -v $PWD/uploads:/app/uploads \
  yxjia-mvp
```

## 测试覆盖

```
pytest 23 passed (84s)
playwright 36 passed (0.7s)
─────────────────────────────
59 tests total
```

| 套件 | 用例数 | 覆盖内容 |
|------|--------|----------|
| pytest test_01-05 | 5 | 老人视角原有 5 个核心 flow |
| pytest test_06 | 18 | admin 登录 / 用户注册 / 上传 / AI 试摆 / 权限隔离 |
| Playwright | 36 | 4 个公开 HTML + 6 款商品 + 订单 CRUD + tryon + 静态资源 |

## 目录结构

```
yxjia-mvp/
├── data/
│   ├── products.json     # 6 款产品 + 运行时追加
│   ├── orders.json       # 订单列表
│   ├── users.json        # 用户表
│   └── uploads.json      # 上传元数据表
├── public/
│   └── images/           # 静态图片目录
├── src/
│   ├── server.js         # Express 服务
│   ├── index.html        # 首页
│   ├── product.html      # 家具详情
│   ├── checkout.html     # 下单页
│   ├── order.html        # 订单详情
│   ├── tryon.html        # 在线试摆
│   ├── login.html        # 顾客登录
│   ├── my-orders.html    # 我的订单
│   └── admin/            # 后台管理
│       ├── login.html    # /admin 登录页
│       ├── index.html    # 4 块功能入口
│       ├── product.html  # A. 上传商品
│       ├── room.html     # B. 上传客厅图
│       ├── tryon.html    # C. AI 试摆
│       └── orders.html   # D. 订单列表
├── tests/
│   ├── test_01_browse.py     # 首页可见
│   ├── test_02_call_button.py # 拨号按钮
│   ├── test_03_browse_products.py # 浏览
│   ├── test_04_order_flow.py # 下单 flow
│   ├── test_05_api.py        # API 创建订单
│   ├── test_06_admin_user_system.py # 后台 + 用户 + 上传 + 试摆
│   ├── api.test.js           # Playwright 36 用例
│   └── conftest.py
├── uploads/                  # 运行时上传文件
│   ├── products/
│   ├── rooms/
│   └── compositions/
├── Dockerfile
├── render.yaml
├── wrangler.toml
├── .dockerignore
├── package.json
├── playwright.config.js
├── pytest.ini
└── README.md
```

## 后续路线图

- [ ] 真短信通道替换固定 123456 验证码
- [ ] 后台 admin 密码改环境变量
- [ ] 订单状态机（待联系 / 已联系 / 已下单 / 已完成）
- [ ] 微信扫码直接发图
- [ ] 上传图片 WebP 自动压缩
- [ ] 顾客上传历史可视化