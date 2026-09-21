# QA 交接 · v2 AI 商品场景图（测试角色 Q）

> 2026-09-18 · 输入：team/spec/spec-v2.md（给测试角色的交接）、tests/api-v1.test.js 双进程 mock 模式
> 测试代码：`tests/api-v2.test.js`（Node 14 用例）+ `tests/test_08_scene.py`（Python 5 用例）
> 状态：**TDD 预期红已就位**——api-v2 12 红/3 绿（绿的是守卫用例），test_08 4 红/1 绿（绿的是兼容冒烟）；既有套件零新增红

## 1. 运行方式

```bash
# Node 侧（自包含：自己起 3100 server + 3199 mock，不打真 AI API、不花 token）
./node_modules/.bin/playwright test tests/api-v2.test.js

# Python 侧（跑在 3000 开发实例上，与 test_07 同模式）
source .venv/bin/activate
python3 -m pytest tests/test_08_scene.py -v
```

playwright.config 的 `testDir: './tests'` + 默认 testMatch 已确认会把 api-v2.test.js 收进默认运行（`--list` 可见 15 条）。

## 2. 用例清单（api-v2.test.js）

| # | 用例 | 断言要点 | spec 依据 | 当前状态 |
|---|------|---------|----------|---------|
| A1/A2 | 未登录 POST/DELETE scene-image → 401 | 401（现在路由不存在落 API 兜底 404 → 红） | S5/S7 requireAdmin | 红 |
| B1 | 商品 id 不存在 → 404 | JSON 业务 404、error 含"不存在"（现在恰好被兜底 404 满足 → 绿，S5 落地后仍应绿） | S5 | 绿（守卫） |
| B2 | 商品 image 指向不存在文件 → 404"图片丢失" | error 匹配 /图片丢失/ | S5 readProductImageBuffer | 红 |
| C1 | styleId 非法 → 400 | 400 + success:false | S5 + scene-styles.json | 红 |
| C2 | 同 styleId 已生成且 force=false → 400 | error 匹配 /已生成过/（声明顺序依赖 D1，workers=1 串行保证） | S5 去重拦截 | 红 |
| D1 | 成功路径全断言 | mock 命中；sceneImage 有 styleId/styleName/demoType='ai-composition'/createdAt；url 是 `/uploads/compositions/` 相对路径（fixImageUrl 生效）；products.json 落盘；uploads.json 新增 type='scene' 记录（带 productId/styleId）；**product.image 未变**；url 可 GET 200 | S4/S5/S9 | 红 |
| D2 | force=true 重生成 | 替换不追加（数量不变、同 styleId 唯一）、createdAt 更新 | 数据结构 cap/去重规则 | 红 |
| E1 | 409 并发 | mock slow 3s，首请求进行中第二请求 → 409（error 匹配 /正在生成/），首请求最终 200 | S6 单飞锁 | 红 |
| F1 | 502 失败无脏数据 | mock 500 + POLLINATIONS_OFF=1 → 502；products.json 该商品逐字节不变；uploads.json 无新 type='scene'；试摆兜底缓存（type='composition'）不受影响 | S4 决策 3 | 红 |
| G1 | GET /api/products/:id 返回 sceneImages | 公开 API、url 相对路径、demoType 合法 | S9 | 红 |
| G2 | DELETE 后条目消失、文件不删 | GET 无该 styleId；原 url 仍 200（孤儿文件无害） | S7 | 红 |
| G3 | 无 sceneImages 旧商品 GET 兼容 | 字段缺省或空数组、结构不损坏 | 向后兼容 | 绿（守卫） |
| H1 | **P1 守护**：voice/ask → mock 捕获 chat/completions lastBody，system prompt 含注入商品的 suitableFor/placementTip 值 | 现在商品库行只有 name/price/subtitle/size → 红 | P1 buildVoiceGuideInstructions | 红 |
| H2 | **P1 守卫**：旧商品（无字段）进商品库行不报错、无 undefined/null | 现在即满足，P1 落地后必须仍绿 | P1"字段空则不拼" | 绿（守卫） |

## 3. 用例清单（test_08_scene.py）

| 用例 | 断言要点 | spec 依据 | 当前状态 |
|------|---------|----------|---------|
| admin/scene 页可达 + 5 风格按钮 | 200 +「明亮家居/暖光氛围/夜晚温馨/极简留白/家庭生活」齐全 | F1 + data/scene-styles.json | 红 |
| admin 首页「场景图工厂」入口 | /admin/scene 链接 + 文案 | F3 | 红 |
| 后台商品列表「场景图」入口 | /admin/scene 链接 | F2 | 红 |
| 带 sceneImages 详情页画廊 | 「摆进家里」标题 +「AI 合成场景」小字 + 零 pageerror | F4 + 决策 4 | 红 |
| 旧商品详情页无画廊区块 | 「摆进家里」不出现 + 零 pageerror | F4 条件渲染 | 绿（兼容冒烟） |

Python 侧 sceneImages 注入方式：fixture 临时改 `data/products.json`（备份/还原），对运行中的 3000 实例即时生效（server 每请求重读磁盘）。已验证测试后文件还原干净。

## 4. mock 细节（给开发 D）

1. **进程拓扑**（沿用 v1）：3199 mock、3100 被测 server；`dotenv` 不覆盖已存在环境变量，spawn env 优先于 .env（防真 key 漏进来）。
2. **scene 链路 mock**：spawn env 设 `TWO_FISH_API_KEY='sk-fake-qa-do-not-call-real-api'`（显式非空假值）+ `TWO_FISH_EDITS_URL='http://127.0.0.1:3199/v1/images/edits'`（**依赖 S1**）。mock 对该路径按 `mockScene.mode` 行为：
   - `ok`（默认）→ `200 {"data":[{"b64_json":"<1x1 png>"}]}`，即走通 twofishai 主路径全链路
   - `error` → 500（F1 失败路径）
   - `slow` + `delayMs` → 延迟后 200（E1 并发护栏）
3. **POLLINATIONS_OFF=1 全局加在 spawn env 上**（不只是失败用例）：成功路径 twofishai mock 命中后根本走不到 Pollinations，所以单实例即可同时覆盖成功/失败两条路径，不必起第二个 server。S4 实现该开关时：`process.env.POLLINATIONS_OFF === '1'` 时 twofishai 失败直接 throw、跳过 Pollinations。
4. **mock 图是 1x1 PNG**：spec 交接明确 S4 不要加最小尺寸/分辨率拦截，否则 mock 图过不了。
5. **P1 守护借道 `/api/voice/ask`**：mock 同时接管 STEP 三件套——`/audio/asr/sse`（返回 `data: {"type":"transcript.text.done","text":"有什么沙发推荐"}`）、`/chat/completions`（捕获 `mockAI.lastBody`）、`/audio/speech`（返回伪 mp3）。音频体是 44 字节占位（mock 不校验）。守护断言的是 **system prompt 内容**（包含 suitableFor/placementTip 值），不断言拼接格式——格式由 D 定，值必须出现。
6. **数据污染防护**：beforeAll 备份 products.json / uploads.json / uploads/compositions 快照；fixture 商品图复制为 `qa-scene-src.jpg`；afterAll 全量还原。已跑过一轮验证还原干净。
7. **fixture 商品**：`p-qa-scene`（带导购字段）、`p-qa-scene-noimg`（图缺失）、`p-qa-scene-plain`（无导购字段 + 409/502 用体）。SOURCE_IMAGE 复用 v1 的 `uploads/products/2d484ab70cf1785a.jpg`。

## 5. 转绿顺序建议（对应 spec 实施顺序）

1. **S1**（TWO_FISH_EDITS_URL 环境变量，1 行）→ 解锁 mock 指向；不转绿任何用例但消除"打真上游"风险
2. **S2/S3/S4/S5/S6/S7/S9**（后端主体）→ A/B/C/D/E/F/G 全绿。实现 S4 时务必带上 AbortSignal.timeout(90000) 和 POLLINATIONS_OFF 开关（测试都依赖）
3. **P1**（导购字段，~10 行）→ H1 绿，且 **H2 必须保持绿**（旧商品兜底）
4. **F1-F3**（后台 UI）→ test_08 前 3 条绿
5. **F4**（详情页画廊）→ test_08 第 4 条绿；第 5 条（兼容冒烟）全程应保持绿

## 6. 发现的坑 & 备注

1. **B1 是"意外绿"**：路由不存在时落 API 兜底 404，恰好满足 B1 断言。S5 实现后它应继续绿（业务 404 也是 404 JSON）——它守护的是"错误形状"而非实现。
2. **C2/D2 依赖声明顺序**（D 先执行）：playwright workers=1 + fullyParallel:false 保证同文件串行。若 D 改成并发或乱序需给 C2 自备数据。
3. **当前红全部是"路由不存在 → API 兜底 404"形态**，未触碰任何真上游（成功路径在 S1 落地前也打不到 mock，但 spawn 的假 key 会让真 twofishai 鉴权失败，不会花 token；Pollinations 开关落地前失败路径可能滑向真网络——本次实测未发生，因为端点不存在提前 404 返回了）。
4. **MinIO 状态无关**：本机 MinIO 当前未启动，saveImage 走本地 fallback，`connect ECONNREFUSED 9000` 日志属预期；D1 的"url 可访问"断言对两种存储都成立（本地文件直读 / MinIO 走 /uploads 代理）。
5. **老规矩**：server.js 被 linter 动过必须重启测试进程（api-v2 每次运行自己 spawn 新进程，天然规避；Python 侧跑在长驻 3000 实例上，D 改完 src 需手动重启它）。
6. api.test.js 全量跑出 34 过/14 红，与 STATE.md 记载的基线（47 过/14 红，含 v1 套件）一致，零新增红；api-v1 13/13 绿、test_07 6/6 绿。
