# Spec v1：商品文案/卖点自动生成（调研文档 #3）

> 角色 P · 2026-09-17 · 输入：team/marketing/insights-v1.md、docs/AI能力调研.md、team/STATE.md
> 原则：改动面最小、零新依赖、老人友好、两色调、无前端框架、无数据库

## Overview

把现有 `/api/admin/upload-and-identify` 的识别升级为"一次识别出全套售卖信息"：卖点 3 条、适合人群（大白话）、摆放建议、真实尺寸/可到店量尺。字段落 `data/products.json`，顾客端商品详情页直出，后台可见可改。同时清掉 highlights 里"AI 识别于…"机器噪音和 `size:"常规尺寸"` 占位符。**关键补充：该接口目前是 curl-only，必须配一个老板能用的后台 UI 入口，否则功能为零。**

## 现状调研结论（dev 必读）

| 事实 | 位置 | 影响 |
|---|---|---|
| `upload-and-identify` 无任何前端调用方 | src/server.js:1823；grep src/ 无 fetch | 必须新增后台 UI 入口 |
| `admin/product.html` 走的是 `/api/upload/product-image`（手填表单） | src/admin/product.html:95 | 两条上传链路并存，v1 不合并，只加 AI 入口 |
| 识别返回 `category` 但写入 products.json 时丢失 | server.js:1816 vs 1854-1867 | 首页 `renderCatalog()` 按 `p.category` 排序（index.html:589），旧 3 条商品全丢 category。顺手写入 |
| 顾客详情页已条件渲染 size/description/highlights | src/product.html:77,87,91-93 | 新字段照此模式做兜底，天然向后兼容 |
| 首页商品卡只显示 name/price/badge/category | src/index.html:595-603 | 卡片只加一行卖点（有则显示） |
| 后台编辑弹窗已含 size 等，PATCH 接受任意字段 | src/admin/products.html:88,141,151；server.js:1279-1297 | 新字段只需在弹窗加 3 个输入框，后端 PATCH 零改动 |
| 识别 prompt 令 AI 报价格 `"¥Xxxx起"`（编造） | server.js:1796 | 加"不确定报到店询价"约束 |
| API 测试无识别相关用例；`STEP_BASE_URL` 可用环境变量覆盖 | tests/api.test.js、server.js:1759 | 测试可指向本地 mock server，见交接 |

## 数据结构变更（products.json）

商品对象新增 4 个字段（全部可选，旧商品缺省即兜底）：

```json
{
  "id": "p-xxx",
  "name": "浅灰色弧形科技布沙发",
  "subtitle": "科技布高弹海绵填充",
  "category": "sofa",
  "price": "¥2999起",
  "size": "约 2.6 米宽 × 1.0 米深",
  "sellingPoints": ["科技布不怕小孩画，湿布一擦就净", "坐深 60 厘米，老人起身不费劲", "弧形扶手不磕碰"],
  "suitableFor": "适合客厅开间 3.5 米以上的家庭",
  "placementTip": "靠墙摆，沙发前留 60 厘米过道好走路",
  "description": "（AI 重写的顾客向描述，2-3 句大白话，不再以'AI 识别：'开头）",
  "highlights": ["科技布高弹海绵填充"],
  "status": "在售"
}
```

**向后兼容规则（前台兜底，不改数据）**：
- 详情页/商品卡对新字段全部条件渲染：`sellingPoints?.length ? … : ''`，旧商品页面不出现空区块
- `size` 缺失或仍为"常规尺寸"时详情页不显示尺寸角标（product.html:77 已是条件渲染，只需把"常规尺寸"视为无效值过滤）
- GET `/api/products` 读取时顺手过滤 `highlights` 中匹配 `/^AI 识别于/` 的项（一行代码，旧 3 条商品的机器噪音立即消失，无需数据迁移）

## AI 识别 Prompt 修改要求

改 `identifyWithDoubao()`（src/server.js:1785-1821）中的 text prompt（现 1796 行），一次产出全部字段：

1. **产出字段**：在现有 name/price/category/subtitle/color/emoji 基础上追加：
   - `sellingPoints`：恰好 3 条，每条 ≤ 30 字，从照片可见的事实出发（材质/工艺/安全/好打理），不许写"高端大气上档次"这类空话
   - `suitableFor`：≤ 40 字大白话，含具体场景（如"适合客厅开间 3.5 米以上的家庭""家里有小孩的选这个"）
   - `placementTip`：≤ 60 字摆放建议（靠墙/留过道/配什么）
   - `size`：照片能判断就写"约 X 米宽 × X 米深"；判断不了就写 `可到店量尺`（**禁止编造精确尺寸**）
2. **诚实约束（老人友好 + 不说假话）**：
   - 价格：照片判断不了价位就返回 `到店询价`，不许编"¥Xxxx起"；返回值若仍是占位符样式，后端替换为 `到店询价`
   - 所有尺寸带"约"字或回落"可到店量尺"
   - 描述里禁止出现"AI 识别""AI 生成"字样（这是给顾客看的）
3. **解析健壮性**：沿用现有 `content.match(/\{[\s\S]*\}/)` 提取；新字段做防御——`sellingPoints` 非数组或空时回落 `[subtitle]`，各字符串字段 `.slice()` 限长（sellingPoints 每条 40、suitableFor 50、placementTip 80、size 30）
4. **写入**（server.js:1854-1867 product 对象）：新字段直接落；`highlights` 改为 `[...(sellingPoints||[]).slice(0,3)]`，**删除"AI 识别于 …"项**；`description` 改为 AI 生成文案（不再是 `AI 识别：…` 模板）；**补写 `category` 字段**

## 后端改动点

| # | 改动 | 位置 | 说明 |
|---|---|---|---|
| B1 | 识别 prompt + 返回结构 + 写入逻辑（上文） | server.js:1785-1879 | 核心 |
| B2 | GET `/api/products` 过滤 "AI 识别于" highlights | server.js（products 读取处） | 一行，旧数据兜底 |
| B3 | 新端点 `POST /api/admin/products/:id/regenerate-copy`（requireAdmin） | server.js，放在 PATCH 附近 | 给已有商品补文案：按 product.image 从 `uploads/products/`（MinIO 同步目录）读原图 buffer → 复用 `identifyWithDoubao` → 只更新 4 新字段 + description + highlights + size，保留 name/price/status 等老板改过的字段；读不到图返回 404"图片丢失，请重新上传" |
| B4 | `category` 写入 products.json | server.js:1854 区块 | 修首页排序数据源 |

### 范围判断：31 张积压照片

- **UI 逐张上传：纳入 v1**（Phase 2）。老板用 UI 传 31 张约半小时，且每张过一遍 AI 文案，这正是验收路径。
- **批量自动入库脚本：不纳入 v1**。理由：①照片无价格/尺寸标注，AI 编价格风险高，需要人逐张确认；②`upload-and-identify` 的产出依赖人工看一眼再上架，全自动批量反而把"下架待审"流程复杂化；③改动面最小原则。若 dev 顺手，可加一个 `data/` 目录扫描脚本（逐张调用同链路、全部落 `status:"下架"` 待老板后台逐个确认改价），标记为**可选加分项，不进验收**。

## 前台改动点

| # | 改动 | 文件 |
|---|---|---|
| F1 | 新页 `admin/ai-upload.html`："AI 拍照上架"——选图（+可选名称提示）→ 调 `/api/admin/upload-and-identify` → 回显全套生成文案，**每个字段带可编辑输入框**（字号 ≥1.1rem，老人友好），老板改完点"确认上架"→ PATCH 落库 | 新文件，样式复制 admin/product.html（两色调） |
| F2 | admin/index.html 加入口卡片 J："📷 AI 拍照上架 · 拍张照，AI 帮你写好卖点尺寸" | src/admin/index.html |
| F3 | admin/products.html 编辑弹窗加 3 个输入框：适合人群（单行）、摆放建议（单行）、卖点（textarea，一行一条）；保存走现有 PATCH 零后端改动 | src/admin/products.html |
| F4 | 详情页展示四件套：尺寸角标（已有）+ 新 section「这台家具适合谁」`suitableFor` + 「摆家里怎么摆」`placementTip` + 卖点列表 `sellingPoints`（有则渲染）；"商品亮点" section 改为渲染 sellingPoints，兜底旧 highlights；字号沿用现有 .desc/.highlight 规格 | src/product.html |
| F5 | 首页商品卡 meta 行下加一行 `sellingPoints?.[0]`（有则显示，≤1 行不撑破卡片） | src/index.html:595-603 |

## 非目标（v1 明确不做）

- 不做批量自动入库（31 张走 UI 逐张传；扫描脚本仅可选加分项）
- 不做价格 AI 定价（价格默认到店询价/老板手填）
- 不做前端框架、数据库、多图、图片裁剪
- 不动合成图自检（#4）、全屋搭配（#1）、语音导购接入新字段
- 不做 JSON-LD/SEO 结构化（#14，留给后续）
- 不合并 `/api/upload/product-image` 与识别链路两条上传路径
- 不做数据迁移脚本（旧商品靠老板点"重新生成文案"+ 读取时过滤兜底）

## 实施顺序

- **Phase 1（后端，可独立验证）**：B1 prompt/写入 + B2 过滤 + B4 category + B3 regenerate-copy。curl 验证。
- **Phase 2（后台 UI）**：F1/F2/F3。老板可用即为价值点。
- **Phase 3（顾客端展示）**：F4/F5。详情页直出。
- Phase 1-3 各自可独立合入，互不阻塞。

## 验收标准（checklist）

- [ ] curl 上传一张测试图到 `/api/admin/upload-and-identify`，返回 product 含非空 `sellingPoints`(3条)/`suitableFor`/`placementTip`/`size`，且 highlights 无 "AI 识别于"
- [ ] AI 无法判断尺寸时 `size` 为"可到店量尺"而非编造数字
- [ ] GET `/api/products` 中旧 3 条商品 highlights 不含 "AI 识别于"
- [ ] 旧商品详情页（无新字段）渲染无空区块、无 JS 报错
- [ ] 老板在 `/admin/ai-upload` 传图 → 看到生成文案 → 改价格 → 确认上架 → 商品出现在首页且详情页四件套齐全
- [ ] `/admin/products` 编辑弹窗可改适合人群/摆放建议/卖点，刷新后仍在
- [ ] 对旧商品调 `regenerate-copy` 后四件套补齐、name/price/status 不被覆盖
- [ ] 新商品写入 `category`，首页排序按沙发→柜→床生效
- [ ] 全部页面仅两色调，无新依赖，Playwright + pytest 既有 42 测试不红

## 给测试角色（T）的交接

1. **无既有识别测试**：tests/api.test.js 里没有 upload-and-identify 用例，需新建。识别依赖 STEP_API_KEY，但 `STEP_BASE_URL` 是环境变量（server.js:1759）——**起一个本地 mock server 返回固定 JSON 即可整链路测试**，不必打真 API、不花 token。
2. 建议用例（api.test.js）：
   - mock 返回完整 JSON → 断言 product 新字段、highlights 无 "AI 识别于"、category 落库
   - mock 返回缺字段/`sellingPoints` 非数组 → 断言回落不 500
   - mock 返回 markdown 包裹 JSON → 断言仍解析成功
   - regenerate-copy：不存在的 id → 404；图片文件缺失 → 404；成功路径字段保留断言
   - GET /api/products 过滤 "AI 识别于"
3. Python 侧（tests/test_06 或新增 test_07）：后台 ai-upload 页登录可达、上传后 products 列表出现新商品；旧商品详情页打开不报错（兼容性冒烟）。
4. **mock 数据须覆盖"编造尺寸/价格"回归**：mock 返回 size 无"约"字、price 为 "¥Xxxx起" 时，断言后端替换为兜底值（这是诚实性约束的守护测试）。
5. 注意 CLAUDE.md 已知坑：server.js 被 linter 改动后必须重启服务再跑测试。

## 相关文件（绝对路径）

- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/server.js`（识别链路 1750-1879 行，PATCH 1279 行）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/data/products.json`
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/product.html`、`/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/index.html`
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/admin/product.html`、`/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/admin/products.html`、`/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/admin/index.html`
