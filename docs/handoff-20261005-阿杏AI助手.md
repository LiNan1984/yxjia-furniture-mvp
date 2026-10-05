# 交接 · 阿杏 AI 家居导购助手（2026-10-05）

> 范围：分支 `feat/axing-ai-assistant` 的全部改动（3 笔 commit）+ 摸清的运行/部署方式。
> 安全加固 / 旧页面详情见 `HANDOFF.md` 与 `docs/handoff-20260921-首页三入口.md`，总览见 `CLAUDE.md` §16。
> 本文档**不含任何密码 / API key / MinIO 密钥**。

---

## 1. 本次改了什么

新增一个**独立的 AI 助手单页 App「阿杏」**：`/axing`。人设 =「提前把家具搬到你家的 AI 助手」，
入口形态是移动端 App（底部 5 Tab + 顶部返回）， phases 为：聊天 → 挑家具 → 拍照 → 试摆 → 3D → 方案 → 预约。

| Commit | 说明 |
|---|---|
| `c7c2d9e` | **feat: 单页壳 + three.js vendor + 现有后端扩展**（`src/axing/index.html`、`css/axing.css`、`js/api.js`、`js/ui.js`、`js/app.js`、`vendor/three/*`、server.js 加 2 个接口、`tests/axing.test.js`） |
| `da915a4` | **feat: 10 个 view 全量落地**（`view-*.js` 9 个由 3 个并行 agent 按契约写，`view-3d.js` 主会话写） |
| `d443e90` | **docs: CLAUDE.md §16 阿杏** + three vendor `.min` 文件名注意事项 |

相对 `main` 基线（`927ad54`）：**26 files, +6480 行，无删除行**（server.js 纯新增，未动任何旧路由/页面）。

### 1.1 为什么这么落地（与 Spec 有出入，是刻意的）

Spec（`docs/阿杏_AI家居导购助手_完整Spec_开发方案_v1.1_技术资料完善版.md`）建议 Next.js + R3F + PostgreSQL。
本仓库硬规则（CLAUDE.md §7）禁止前端框架、禁止数据库，且用户明确要求「**改造落地用现有后端，再起一个新的端口**」。
最终方案：

| Spec 设想 | 实际落地 |
|---|---|
| Next.js App Router | 原生 ES Module SPA 壳（`app.js` 按需 `import('./view-*.js')`） |
| R3F 3D | 本地 three.js r180 + 手写程序化家具模型（`furniture.js` 生成网格，无外部 glb 依赖） |
| Postgres | JSON 文件容器（`data/appointments.json` / `data/scenes.json`，gitignore） |
| 新后端服务 | 复用现有 Express（server.js 仅新增 4 条路由 + 2 条页面路由） |

**3D 台不上传 glb 模型**是刻意的：店里没有建模资产，用程序化几何体按品类（三人位/转角/单人位/茶几/电视柜/床）
+ 真实商品尺寸（从 `products.json` 的「3.2 米 × 1.8 米」文案解析）+ 颜色/材质换装，测试里验证过三角面数
（sofa3 3104 / sofaL 3720 / coffee 832 / tvCabinet 656 / bed 2060）与尺寸解析正确。

---

## 2. 怎么跑

```bash
cd /Users/linan/Desktop/aicode/peilian/yxjia-mvp
PORT=3400 node src/server.js        # 新端口，避开被占用的 3000
# 打开 http://127.0.0.1:3400/axing
```

- **同一份 src，任何端口都能访问 `/axing`**：生产 3300、本地 3000 的旧实例重启后同样可用，不需要单独部署一份。
- 首次运行需要 MinIO（9000）在跑，与主站一致；`/axing` 本身是纯静态页 + 现有 API，不依赖新环境变量。
- `window.AXING` 挂在全局（= ctx），调试可直接 `AXING.go('view-3d')` / `AXING.state.productId`；地址栏 `#view-3d` 可直入。

---

## 3. 架构契约（改 view 前必读）

### 3.1 文件结构与 view 契约

```
src/axing/
├── index.html          # 壳：importmap + 10 个 <section class="view" id="view-xxx" data-title> + 5 Tab
├── css/axing.css       # 设计语言（见 3.4）
└── js/
    ├── app.js          # 路由 + 跨 view 状态(localStorage axing-state-v1) + Tab/返回 + 全局 ctx
    ├── api.js          # 全部后端调用封装（统一抛 ApiError）
    ├── ui.js           # el()/productCard()/axingSay()/mdToNodes()/事件总线/toast/humanError
    ├── view-*.js       # 每个 view 一个模块，约定 export function mount(root, ctx) { ...; return cleanup? }
    ├── furniture.js    # 程序化家具网格 + COLOR_SWATCHES + MATERIALS
    └── three-viewer.js # createViewer(container) → OrbitControls/光影/尺寸标注/截图/WebGL 兜底
```

**view 模块契约**（agent 并行开发时写死在 prompt 里的，后续加 view 照这个来）：

```js
export function mount(root, ctx) { /* 渲染 root；可用 ctx.api/ui/state/setState/on/emit/go/back/toast/humanError/pickProduct */ }
```

- 只 mount 一次（`mounted` Map），返回的函数会在再次挂载前调用（清理 timer/listener）。
- **路径必须写绝对**（`/axing/js/app.js`、`/axing/css/axing.css`）：`/axing` 无尾斜杠，相对路径会解析到 `/js/...` 404。

### 3.2 ctx 与状态

```js
ctx = { api, ui, state, setState, on, emit, go, back, toast, humanError, pickProduct }
```

- `state`（localStorage `axing-state-v1`）：`productId/productName/productPrice/productImage/roomUrl/roomName/phone/lastTryonUrl`。
- 跨 view 通行证：`ctx.pickProduct(p)` 写 state 并发 `product:selected`；`view-3d` 存方案后发 `scene:style`。
- **注意 `ctx.api` 是 `api.js` 里导出的 `api` 对象本身**，不是模块 namespace（`ctx.api.api.xxx` 是错的，早期改坏过一次）。

### 3.3 后端响应封套的坑

`api.js` 的 `parse()` 已处理，但**以后加端点要搞清楚再往上加**：

- 绝大多数：`{success:true, data:{...}}` → `parse()` 取 `body.data`。
- **例外：`/api/tryon/presets` 直接返回 `{presets:[...]}`，没有 data 层** → `parse()` 回退成 `body` 本身。
  改这个老端点会波及 `tryon.html`，当时没动它，选择在前端兜底。

### 3.4 设计语言（CSS 类清单，加新样式前先看有没有能复用的）

两色调：`#2C2C2C`（炭）+ `#F7F4EF`（奶）+ 强调 `#E8B27D`（杏），辅 `#D9D4CD`/`#77726C`。
手机壳：`max-width:480px` 居中，`overflow` 内含滚动。可用类：

`.btn .btn--primary .btn--ghost .btn--apricot .btn--lg .btn--block` ·
`.card .card__body` · `.p-card .p-card__img/__badge/__body/__name/__attr/__price/__ops` · `.p-grid` ·
`.chip .chip-row .chip-scroll` · `.stage .stage__hint` · `.swatch .swatches` · `.mic-btn` ·
`.ax-avatar(--lg/--sm) .ax-row .ax-bubble` · `.bubble .chat` · `.spec-row` · `.field` · `.toast` ·
`.topbar .topbar__title/__back/__right .tabbar .tab .tab__ico` · `.sec-title .sec-eyebrow .sec-desc` ·
`.stack .stack--sm .row .row--between .center .grow .empty .muted .tiny .loading-line .skeleton`

> ⚠️ 三色以上即越界：**不许引红/绿/蓝/黄原色，不许引前端框架**（CLAUDE.md §7，与 Spec 无关，是项目铁律）。

### 3.5 three.js vendor 的坑（最容易踩）

`src/vendor/three/` 是本地副本（不引 CDN，离线可用）：

- `three.module.min.js`（338KB）、`three.core.min.js`（381KB）、`addons/controls/OrbitControls.js`
- **文件名必须带 `.min`**：min 构建内部 `import ... from './three.core.min.js'`，改名 404 → 整个 App 白屏。
  （本次真的踩过：复制过来时去了 `.min`，表现为「Failed to fetch dynamically imported module」。）
- importmap 写在 `index.html`：`{"three": "/vendor/three/three.module.min.js", "three/addons/": "/vendor/three/addons/"}`
- 版本 r180（`package.json` 加了 `three@0.180.0` 仅作版本记录，**运行时用的是 vendor 副本，不走 node_modules**）。
- WebGL 不可用时 `three-viewer.js` 走 `makeStub()` + `opts.onError` → 图片兜底，不会白屏。

---

## 4. 后端新增接口（复用现有 Express，0 新依赖）

两个都写 JSON 文件容器（`data/appointments.json` / `data/scenes.json`，已加 `.gitignore`），
结构仿现有 `orders.json`。**都没有 admin 鉴权**——面向顾客匿名使用，靠校验 + IP 限额兜底。

### 4.1 `POST /api/appointments`（预约到店）

| 字段 | 规则 |
|---|---|
| `name` | 必填（空 → 400「怎么称呼您？」） |
| `phone` | 必填，复用现有 `isValidPhone()`（11 位、`1[3-9]` 开头）→ 400 |
| `date` | 必填 `YYYY-MM-DD`，**不得早于今天**（用 UTC 日期比较）→ 400 |
| `slot` | 必填，**仅 3 个值**：`上午 9:00-12:00` / `下午 12:00-18:00` / `晚上 18:00-20:00` → 400 |
| `productIds[]` | 可选；逐个 `findProduct()`，**不存在 → 404**（并回商品名快照 `productNames`） |
| `note` | 可选，截 500 字 |

响应 `{success:true, data:{ok:true, appointment}}`，`appointment.id` 形如 `A` + 时间戳后 8 位 + 随机 3 位，
初始 `status:'待到店'`。已 `console.log('[axing] appointment ...')`，与订单日志同流（`/var/log/yxjia.log` 可捞）。

### 4.2 `GET /api/appointments/by-phone/:phone` 和 `GET /api/scenes/by-phone/:phone`

- 未登录可查，**IP 限额 20 次/天**（`APPT_QUERY_LIMIT`，超了 429「今天查询次数已用完，请登录后再查」）。
- **登录用户只能查自己手机号**（`myPhone !== phone` → 403），防遍历。

### 4.3 `POST /api/scenes`（保存「我家的方案」）

| 字段 | 规则 |
|---|---|
| `items[]` | 必填非空（400「方案里还没有家具」），**最多 20 件**（400） |
| `items[].productId` | 必填 → 404 if 商品不存在；存 `productName/productImage` 快照 |
| `items[].color/materialId/transform/dims` | 可选，各截断 20 字；3D 台的换装状态由此持久化 |
| `name` | 可选，默认「我的家 · 今天」；`phone` 可选（填了校验格式） |
| 容量 | 容器上限 1000 条，超出从头截断 |

`view-plans` 读它渲染「我的方案」，`view-3d` 的「存到我的方案」写它。

---

## 5. 测试

```bash
# 仅阿杏（8 个，自带独立端口 3100 服务器，不碰 3000 的旧实例）
./node_modules/.bin/playwright test tests/axing.test.js

# 全量回归
./node_modules/.bin/playwright test        # 107 passed（本次跑过，54.2s）
```

`tests/axing.test.js` 覆盖：① 壳/静态资源（importmap + 10 个 view 容器 + three vendor 可达）；
② appointments CRUD + 全部 400/404 校验分支；③ scenes CRUD + 空/坏商品校验；
④ **黄金路径**（选家具 → 点示例房间 → 直接去试摆 → 立即生成 → 等阿杏确认话术，120s 超时，出图或诚实报错都算过）；
⑤ 浏览器冒烟（10 个 view 全挂载 + 3D canvas/兜底 + 已知噪音白名单：`/api/auth/me` 401、卧室示例图 404）。

> 端口说明：测试文件自己 `spawn('node', ['src/server.js'], {PORT:3100})` 并轮询 `/api/products` 健康检查。
> 写新测试沿用这个模式，**不要复用 playwright.config.js 的 3000**（用户本地常驻旧服务，会打出假红）。

---

## 6. 验证证据（本次实测）

- **真实黄金路径**：本地 3100 实例 → 选沙发 → 示例房间 → 立即生成 → **11s 出图**。
- **合成链路 trace（诚实降级链按设计工作）**：本地 `.env` 的 TWO_FISH_API_KEY 已失效 →
  twofishai `502` → step-image `503` → **Pollinations 兜底成功**（带水印图）。
  前端拿到的是 `aiError` 说明 + 兜底图，没有假装成功。**生产 key 是另一套**（见 §7）。
- 截图 QA：首页/商品/3D 三屏目视正确；3D 台尺寸标注「3.2 × 1.8 × 0.85 m」来自真实商品数据解析。
- `node --check src/server.js` 过；无 console.log 残留（server 侧是有意留的 `console.log('[axing] ...')` 日志行）。

---

## 7. 已知问题 & 下一步

| # | 问题 | 状态 / 下一步 |
|---|---|---|
| 1 | **本地 `.env` 的 TWO_FISH_API_KEY 失效**（twofish 502） | 本地仅影响体验，走兜底出图。**上线前查生产 `/root/yxjia-mvp/.env` 的 key**：失效时上游回 `403 {"code":"GROUP_DELETED"}`，试摆会静默退化成侧边预览（CLAUDE.md §9 同款坑） |
| 2 | `data/categories.json` 引用了不存在的 `/images/default-room-bed.jpg`（卧室示例房间图） | 数据债。上传页已会自动隐藏坏缩略图；补齐方式：后台上传一张卧室图作品类示例图 |
| 3 | 阿杏**尚未部署到生产**（72.60.193.189:3300） | 需要时按 CLAUDE.md §8：**rsync 只同步 `src/`**（不碰 `data/` `.env`，别加 `--delete`）+ `systemctl restart yxjia`。SSH 必须 `dangerouslyDisableSandbox: true` + sshpass 密码认证（沙箱会拦数据流）。部署后 `curl -s -o /dev/null -w "%{http_code}" http://72.60.193.189:3300/axing` 应为 200 |
| 4 | 登录仍是「任意手机号 + 123456」（CLAUDE.md §7 / 安全记忆里的固有弱点） | 阿杏的预约/方案查询靠登录态 + IP 限额缓解；根本解是 v2.2 真短信验证码，未做 |

### 建议的接手顺序

1. 本地 `PORT=3400 node src/server.js` 打开 `/axing`，按 5 个 Tab 走一遍（重点试 3D 换装 + 存方案）。
2. 若要上线：先按 §7-1 确认生产 twofish key，再按 §7-3 部署 `src/`。
3. 若要继续加 view：照 §3.1 契约（`mount(root, ctx)`）+ §3.5 vendor 注意事项 + 派 agent 并行（文件边界不重叠）。
