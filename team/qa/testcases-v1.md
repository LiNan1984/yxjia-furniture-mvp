# v1 测试用例清单 & 交接（测试角色 Q · 2026-09-17）

> 输入：`team/spec/spec-v1.md`（验收标准 + 给测试角色交接节）
> 产出：`tests/api-v1.test.js`（Node，13 用例）、`tests/test_07_ai_copy.py`（Python，6 用例）
> 状态基线（2026-09-17，TDD 先行，实现未写）：**v1 相关 18 用例 = 17 红 + 1 绿（守护用例）**，符合预期。

## 一、怎么跑

```bash
# Node 侧（13 用例，完全自包含，不依赖 :3000 服务器）
./node_modules/.bin/playwright test tests/api-v1.test.js

# Python 侧（6 用例，依赖 :3000 服务器在跑）
source .venv/bin/activate
python3 -m pytest tests/test_07_ai_copy.py

# 全量 Node（两个文件一起，无互相干扰，已验证）
./node_modules/.bin/playwright test
```

## 二、Mock 机制（开发 D 必读）

**不打真 AI API、不花 token、不依赖外网。** `tests/api-v1.test.js` 在 `beforeAll` 里自起两个进程：

1. **mock STEP server**（`127.0.0.1:3199`）：一个 20 行的 `http.createServer`，对 `POST /chat/completions` 返回 `{choices:[{message:{content: mockAI.content}}]}`。每个测试把 `mockAI.content` 设成任意 JSON 字符串（完整 JSON / 缺字段 / 非数组 / markdown 包裹），即可控制"AI 的回答"。`mockAI.hit` 断言请求确实打到了 mock（A1 用）。
2. **独立 yxjia server 实例**（`127.0.0.1:3100`）：`spawn('node', ['src/server.js'])`，env 里 `PORT=3100`、`STEP_BASE_URL=http://127.0.0.1:3199`、`STEP_API_KEY=qa-mock-key`。**dotenv 不覆盖已存在的环境变量**，所以 spawn env 优先于 `.env`——server.js 第 1759 行的 `process.env.STEP_BASE_URL` 就指向 mock。这条链路是 spec 交接第 1 条预定的做法，验证过可行。

数据污染防护：`beforeAll` 备份 `data/products.json` 原文 + `uploads/products/` 目录快照；`afterAll` 杀进程、还原文件、删除测试产生的商品图。已验证跑完后 `git status` 与跑前一致。

## 三、用例清单

状态图例：🔴 红（等实现）· 🟢 绿（当前已满足，守护用例）

### Node：tests/api-v1.test.js

| 编号 | 覆盖点 | 前置 | 关键断言 | 状态 |
|---|---|---|---|---|
| A1 | upload-and-identify 完整链路（spec 验收 #1） | admin 登录(3100) + mock 返回完整 JSON | `sellingPoints` 恰 3 条、`suitableFor`/`placementTip` 非空、`size` 含"约"、`highlights` 无 `/^AI 识别于/`、**`category` 落库（响应 + products.json 磁盘双查）**、`mockAI.hit` 为 true（证明确实走的 mock） | 🔴 |
| A2 | 诚实性·价格（验收 #2 前半） | mock 返回 `price:"¥Xxxx起"` | `product.price === '到店询价'`，且整个响应不含 "Xxxx" | 🔴（现为 "¥Xxxx起" 直通） |
| A3 | 诚实性·尺寸（验收 #2 后半） | mock 返回无"约"字的编造尺寸 `2.62 米宽 × 0.98 米深` | `product.size === '可到店量尺'` | 🔴（现为 "常规尺寸"） |
| A4 | 描述诚实性：description 不含"AI 识别/AI 生成" | mock 完整 JSON | description 非空且不含两字样 | 🔴（现为 "AI 识别：…" 模板） |
| A5 | 健壮性：mock 只回 `{name}` | 缺全部新字段 | 不 500；`sellingPoints` 回落为数组；`size` 回落 "可到店量尺" | 🔴 |
| A6 | 健壮性：`sellingPoints` 是字符串 | mock 给非数组 | 不 500；回落数组且含 `[subtitle]` | 🔴 |
| A7 | 健壮性：markdown ```json 包裹 | mock 内容带围栏 | 照常 200 解析成功 | 🟢（现有 `content.match(/\{[\s\S]*\}/)` 已处理；守护用例） |
| A8 | 鉴权：未登录调 upload-and-identify | 不带 cookie | 401 | 🔴（**现状 200：该路由目前没挂 requireAdmin**，见坑 #1） |
| B0 | regenerate-copy 未登录 | 不带 cookie | 401 | 🔴（端点不存在 → 404） |
| B1 | regenerate-copy id 不存在（验收 #7） | admin cookie | 404 且 `error` 匹配 /不存在/ 且**不是** "API 不存在" 兜底 | 🔴 |
| B2 | regenerate-copy 图片文件缺失 | 注入 image 指向不存在文件的商品 | 404 且 `error` 含 "图片丢失" | 🔴 |
| B3 | regenerate-copy 成功路径（验收 #7） | 注入"老板改过字段"的商品 + 真实图片文件 `uploads/products/qa-copy-source.jpg` | `name`/`price`/`status` **不被覆盖**（mock 故意返回不同 name/price）；四件套补齐；description 无 "AI 识别"；highlights 换新 | 🔴 |
| C1 | GET /api/products 过滤噪音（验收 #3） | 直接注入一条带 "AI 识别于" highlight 的商品 `p-qa-legacy` | 列表所有商品 highlights 无 `/^AI 识别于/`；其他 highlight 保留 | 🔴 |

### Python：tests/test_07_ai_copy.py

| 编号 | 覆盖点 | 前置 | 关键断言 | 状态 |
|---|---|---|---|---|
| P1 | `/admin/ai-upload` 页可达（验收 #5） | admin 登录 | 200 + 含 "AI 拍照上架" | 🔴（现 404） |
| P2 | ai-upload 页流程闭环 | 同上 | 含 file 控件 + "确认上架" 按钮 + 调 `/api/admin/upload-and-identify` | 🔴 |
| P3 | admin 首页入口卡片（spec F2） | admin 登录 | `/admin/index` 含 `/admin/ai-upload` 链接与 "AI 拍照上架" 文案 | 🔴 |
| P4 | 旧商品详情页兼容冒烟（验收 #4） | Playwright page fixture | 打开 `/product/p-msbx4qb0-s2i`：**无 pageerror**、商品名渲染出、页面无 "AI 识别于" 噪音 | 🔴（JS 无报错✓；仅噪音断言红） |
| P5 | 旧商品 API 向后兼容 | 无 | `/api/products/:id` 200、结构完整 | 🟢（守护用例） |
| P6 | 商品列表无噪音（同 C1，:3000 视角） | 无 | 所有 highlights 无 "AI 识别于" | 🔴 |

## 四、当前红/绿基线（精确数字）

| 范围 | 通过 | 失败 | 说明 |
|---|---|---|---|
| `tests/api-v1.test.js` 单跑 | 1（A7） | 12 | 12 红全是设计内 |
| `tests/test_07_ai_copy.py` 单跑 | 1（P5） | 5 | 5 红全是设计内 |
| `playwright test`（全量 Node） | 35 | 26 | = v1 的 12 红 + **既有 14 红** |

**既有 14 红与 v1 无关、跑 v1 之前就存在**：`data/products.json` 里现在只有 3 条 AI 识别入库的商品（p-msbx…），没有 `sofa-1/sofa-2/sofa-3/cabinet-1/bed-1/table-1` 六款预填商品，导致 api.test.js 里 14 条依赖它们的用例红（Products API 5 条 + Orders 6 条 + TryOn 3 条）。HEAD 提交里的 products.json 也一样。**这是数据问题不是代码问题**——把 6 款预填商品补回 products.json 即可全绿。建议产品/D 角色确认：是数据被覆盖了，还是测试断言过时。

## 五、发现的坑 & 给 D 的交接

1. **`/api/admin/upload-and-identify` 目前没挂 `requireAdmin`**（server.js:1823，与 CLAUDE.md 鉴权表"admin"不符，也是安全洞：任何人可上传图+烧识别 token）。A8 就是这个守护。D 实现 B1 时顺手补 `requireAdmin`，A8/B0 即转绿。
2. **regenerate-copy 的 404 要区分"业务 404"和 API 404 兜底**：server.js:2878 有 `app.use('/api', ...)` 兜底返回 `{success:false,error:'API 不存在'}`（404）。所以 B1/B2 断言了 error 文案。D 实现：商品查不到 → `fail(res,404,'商品不存在')`；图片读不到 → `fail(res,404,'图片丢失，请重新上传')`。
3. **regenerate-copy 读图的路径约定**：测试把 `product.image` 设为 `/uploads/products/qa-copy-source.jpg` 并在本地 `uploads/products/` 放了真实文件（MinIO 未起时 server 走本地 fallback，测试环境就是这条路）。D 实现"按 product.image 从 uploads/products/ 读 buffer"时注意：image 可能是 `/uploads/products/xxx` 相对路径或 MinIO 完整 URL，两种都要能解析（参考 server.js:410 `fixImageUrl` 的逆操作）。
4. **"常规尺寸" 是现存占位符**：识别写入时 `size:'常规尺寸'`（server.js:1859）。A3 断言编造尺寸→"可到店量尺"，D 替换逻辑别把"常规尺寸"也当成有效尺寸；spec 前台部分（F4）要求把"常规尺寸"当无效值过滤，那是前端的事，但后端写入时直接给"可到店量尺"更好。
5. **诚实性替换的判定式**（供 D 参考）：price 匹配 `/^¥\s*X+x+.*$/i` 或不含数字 → "到店询价"；size 不含"约"且不是"可到店量尺" → "可到店量尺"。mock 里故意用了 `¥Xxxx起`（X 大写）和 `2.62 米宽 × 0.98 米深`，判定别写死只匹配小写 x。
6. **server 是每请求重读 products.json**（`loadStore()` 每次走磁盘），所以测试直接改文件就能生效，D 写批量/迁移类代码时也利用这一点，别引入内存缓存。
7. **环境修复**：本机 Python Playwright 的 chromium headless shell 原来没装（**所有** Python 浏览器测试都起不来，包括 test_01~05）。我已跑 `python3 -m playwright install chromium` 修好（v1155 / Chromium 133）。如果 CI/其他机器复现，先装浏览器。
8. **MinIO 未在本地运行**：测试上传全走本地 fallback（server.js:417 `saveImage`），无副作用，afterAll 会清本地文件。D 如果在 MinIO 开着的环境跑，测试上传会往 bucket 写几个对象，属预期。
9. **测试自起 3100 端口 server**：如果 3100 被别的进程占了，beforeAll 会失败——先 `lsof -iTCP:3100` 查一下。端口常量在 tests/api-v1.test.js 顶部（QA_PORT/MOCK_PORT）。
10. **转绿顺序建议**（对应 spec Phase）：① B2/C1（读过滤，一行代码）→ A1-A7（识别 prompt+写入+诚实性替换）→ ② P1-P4（ai-upload 页 + 入口）→ ③ B0-B3（regenerate-copy）。每步跑 `playwright test tests/api-v1.test.js` + `pytest tests/test_07_ai_copy.py` 验证。

## 六、约束遵守情况

- 未改 `src/` 任何文件；未执行 git commit
- 全部测试不打真 AI API：Node 侧靠 mock server（`mockAI.hit` 断言兜底），Python 侧只测页面可达与既有数据
- 既有测试未被搞红：全量 Node 跑前跑后失败集完全一致（14 条，与 v1 无关）
- 测试产生的数据（products.json、uploads/）已验证完全还原
