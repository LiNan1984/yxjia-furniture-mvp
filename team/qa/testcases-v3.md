# 测试案例 v3（角色 Q · 2026-09-25）

> 依据 team/spec/spec-v3.md。沿用团队双进程 mock（被测 server :3100 + mock AI :3199）、`TWO_FISH_API_KEY='sk-fake'`、`TWO_FISH_EDITS_URL` 指向 mock、失败路径 `POLLINATIONS_OFF=1`、mock 1x1 png 不加最小尺寸拦截、server.js 被 linter 动过重启测试进程、MinIO 未启动走本地 fallback（`ECONNREFUSED 9000` 属预期）。
> 目标水位：本版既有用例**零新增红**（新红即缺陷）；新增用例全绿；X1/X2 两条回归由红转绿。

## 0. 阶段 0（收尾 v2，非本版功能，先落水位）
- TC-0.1 `tests/api-v2.test.js` 目标 14/14；TC-0.2 `tests/test_08_scene.py` 目标 5/5；TC-0.3 全量回归记录基线（红集合与 v2 收尾一致，无新增）。任何 v2 红先判定是否遗留，**不重写 v2**。

## 1. 品类/板块地基（主线 A）
- TC-A.1 `GET /api/categories` 返回 `{categories}` 且**只含 enabled**；sofa、bed 在，cabinet、table 不在（200）。
- TC-A.2 试摆默认 prompt 品类感知：category=sofa → 发给 mock 的 lastBody/prompt 含「客厅」「沙发」；category=bed → 含「卧室」「床」。（断言链路 server.js buildTryonDefaultPrompt/三处 defaultPrompt）
- TC-A.3 兼容兜底：无 `category` 的旧商品 → 按 `sofa` 兜底，`/api/products` 与试摆均不报错、不裂图。
- TC-A.4 category 补数据脚本：跑一次后 `data/products.json` 7 款 `category` 与 id 前缀一致（sofa-*→sofa、bed-1→bed、p-*→sofa…）。
- TC-A.5 admin PATCH `category`：有 cookie PATCH `/api/admin/products/:id` body `{category:"bed"}` → 200，再 GET 反映生效；无 cookie → 401。

## 2. 首页板块渲染（主线 A / F1-F3）
- TC-F.1 去 slice：在售沙发 ≥10 款时，首页「沙发」板块渲染全部（不再 6 款封顶）。（Python：数卡片数 == 在售沙发数）
- TC-F.2 「卧室·床」板块：有 enabled=bed 且有在售床时渲染该 section 与床卡；无在售床/品类 disabled 时**不渲染空 section**、无 JS 报错。
- TC-F.3 卡片「把这款搬回家」按钮：点击 → 页内 `#tryon` 品类上下文=该商品品类、默认房间图=对应 `cat.defaultRoom`、`#furnGrid` 过滤为该品类、选中该商品。

## 3. 试摆通用化 + 默认房间（主线 B / B3-B7、F3-F4）
- TC-B.1 沙发试摆不回归：category=sofa + 上传客厅文件 → mock 成功 → 200 + compositionUrl；prompt/默认图与改动前语义一致。
- TC-B.2 床试摆「把床搬回家」：category=bed + 上传卧室文件 → mock 成功 → 200 + compositionUrl；prompt 含「卧室/床」。
- TC-B.3 默认房间图：bed 品类下发 `defaultRoom=/images/default-room-bed.jpg`；若该素材缺失 → 「用默认图体验」禁用并提示，但**上传自家卧室照主路径仍 200**（非阻塞）。
- TC-B.4 presets 中性化：`/api/tryon/presets` 5 条文案**不含**「客厅/沙发/茶几/抱枕」等品类写死词；沙发、床两端都可选同一套预设。

## 4. 必修 bug 回归（X1 / X2）
- TC-X.1（原红）登录 + 上传 room 文件 + productId → `/api/tryon/ai-custom` **不再 400**、走到 mock 200。（修 index.html:807-809 只带 room 的缺陷）
- TC-X.2（原红）hero 主图 / hero 回落 / 商品兜底图引用的路径 `HEAD` 均 200，**无 `sofa-zhongshi.jpg` 引用残留**（grep 源码 + HTTP HEAD 双断言）。

## 5. 后台（A1-A2）
- TC-AD.1 商品编辑弹窗含品类下拉，保存后 PATCH 生效（同 TC-A.5 的 API 层 + Python 点一遍 UI）。
- TC-AD.2 products 列表 meta 显示品类中文名（沙发/卧室·床/…），接入 categories.json 映射。

## 6. 入库工具 tools/ingest-new.mjs（决策 6）
- TC-I.1 `--dry-run`：对临时目录仅列出待入库名单（子目录名→品类 沙发→sofa/床→bed），不发起上传、不写 `.ingested.json`。
- TC-I.2 **串行**：脚本内串行处理（实现加运行中并发计数器=1 或时间戳间隔；断言全程无并发上传 → 防 products.json 读-改-写覆盖）。
- TC-I.3 跳过已存在：重复跑第二次 → 全部跳过（`.ingested.json`/hash 命中），无新增 product。
- TC-I.4 新品默认「下架」：入库后 PATCH status=下架 生效（老板审后在后台上架）。
- TC-I.5 失败即停可续：mock/断网时停在失败张并打印文件名；重跑从断点续（不重复已入）。

## 7. 全局红线
- TC-G.1 两色调：改动到的顾客页无红/绿/蓝/黄原色块（抽查 index.html/admin 顾客可见区；admin 既存 --red/--green 不算新增）。
- TC-G.2 零新依赖（package.json diff 为空）、无前端框架、无数据库。
- TC-G.3 全量回归既有用例零新增红。

## 用例→文件映射（D 落）
- Node：`tests/api-v3.test.js`（TC-A.*、TC-B.*、TC-X.*、TC-AD.* API 层、TC-I.* 用子进程跑脚本）
- Python：`tests/test_09_bedroom.py`（TC-0.3 回归、TC-F.*、TC-AD.1 UI、TC-G.* 两色调、老人视角：品类 tab/卡片按钮可达够大）
