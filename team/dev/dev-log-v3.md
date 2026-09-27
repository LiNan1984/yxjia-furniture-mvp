# Dev Log · v3（多品类地基 + 沙发扩容 + 卧室板块「把床搬回家」）

> 开发角色 D · 2026-09-25 · 本会话 = 收尾验证 + 补齐 3 处缺口。B1-B9 / F1-F6 / A1-A2 / 入库工具主体由前序开发 Agent 落在工作区（未提交），本会话逐项复核、修红、补决策 4 兜底。
> 硬线遵守：**未 git commit**（改动全留工作区）；未跑真实入库（`tools/ingest-new.mjs` 只跑 `--dry-run`）；零新依赖；两色调；老人友好。

---

## 1. 实现摘要（对应 spec 逐项落地状态）

### 后端 server.js

| # | 落地状态 | 位置 / 说明 |
|---|---|---|
| B1 | ✅ | `src/server.js:35`(CATEGORIES_FILE) + `:147-158`(ensureDirs 写默认 4 品类 + other) + `:287-296`(loadCategories) + `:2900-2912`(GET /api/categories 只返 enabled，带 room/noun/defaultRoom/badge/sort) |
| B2 | ✅ | `:301-303`(categoryForProduct，`p.category \|\| 'sofa'` 兜底) + `:311-317`(categoryInfo 读 categories.json 的 room/noun/defaultRoom) + `:355-360`(sceneRoomForProduct：bed→卧室、table→餐厅) |
| B3 | ✅ | `:320-343` buildTryonDefaultPrompt(product) 一处成源，`:2715 / :2844 / :3235` 三个试摆路由统一调用（三处历史分叉已收敛） |
| B4 | 🟡 部分 | 主路径已品类化（finalPrompt 全链路透传，见 B6）；**遗留**：`:920 buildTryonPrompt`（硬编码"客厅/沙发/抱枕"，仅 `prompt` 为空时可达，live 路径不可达）、`:889 callPollinations` 空 prompt 兜底句、`:829 callStepImageEdit` 自拼 prompt 仍写死"客厅/沙发"（该路径随阶跃图像 2026-10-10 下线将废弃）。均未改——不冒动已绿的合成 prompt 链路，记为 v4 技术债 |
| B5 | ✅ | `data/presets.json` 5 条预设已中性化（无客厅/沙发/茶几/抱枕）；`src/server.js:138-142` 默认值同步（注：风格卡 scene 字段仍带"客厅"，那是场景图工厂 v2 资产，不属试摆预设） |
| B6 | ✅ | 三路由收 `category`（无则从 productId 反查）→ room/noun/defaultRoom 全按品类走；`callTryonAI`/兜底后端均只吃 finalPrompt |
| B7 | ✅ | `:2711-2713` 成品兜底不再指向已删 `sofa-zhongshi.jpg`：改成诚实报错「请重选」，不用错误品类的图硬拼 |
| B8 | ✅ | `:2411` identifyWithDoubao 的 category 白名单 sofa/cabinet/bed/table/other + `:2513/:2527` hint 透传；入库工具子目录名→category 映射正确 |
| B9 | ✅（确认项） | normalizeProduct 已透出 category；`data/products.json` 7 款全部回填 category（sofa/cabinet/bed） |

### 前端 src/index.html

| # | 落地状态 | 位置 / 说明 |
|---|---|---|
| F1 | ✅ | `:637-665` renderSections() 板块数据驱动循环，删掉 `.slice(0,6)`；空品类/无在售商品不渲染空 section |
| F2 | ✅ | `:218-219`(.take-home-btn 两色调大按钮) + `:659`(卡片按钮，文案按 `cat.noun` → "把这张沙发/床搬回家试试") + `:715+`(点击设 SELECTED_CATEGORY/PRODUCT、切默认图、滚到 #tryon、刷新 renderFurnGrid) |
| F3 | ✅ | `:427`(#catTabs) + `:589`(SELECTED_CATEGORY 状态机) + `:667-676`(渲染「全部 / 沙发 / 卧室·床」大 tab) + renderFurnGrid 按品类过滤 |
| F4 | ✅ | `:864-870` `fd.append('productId'/'prompt'/'preset')` + `:909` `fd.append('sofa')` 登录上传文件分支补齐（X1 消除，不再 400） |
| F5 | ✅ | `:379` heroImg → `/images/sofa-tihua-real.png`（已删图零引用残留） |
| F6 | ✅ | 默认图按钮/房间标签/成功文案按 `cat.room`、`cat.noun` 品类化（`:812/:843/:859` 等） |

### 后台 src/admin/products.html

| # | 落地状态 | 位置 / 说明 |
|---|---|---|
| A1 | ✅ | `:94`(#m-category 品类下拉) + `:180`(回填) + `:211`(PATCH body 带 category) |
| A2 | ✅ | `:144` 列表 meta 显示 `p.status · catLabel(p.category)`（接 categories.json 映射） |

### 入库工具 tools/ingest-new.mjs（新建，21KB）

- `:454` **严格串行** `for (let i = 0; i < pending.length; i += 1)`，全文无 `Promise.all`；每张一写 `tools/.ingested.json` 断点可续跑；新品 PATCH 成「下架」待老板审；失败即停并打印文件名。
- `.gitignore:83/85` 已加 `data/new/`、`tools/.ingested.json`。
- 本会话实跑 `node tools/ingest-new.mjs --dry-run`：23 张候选（沙发 11 + 床 12，含 `未命名.png`），0 张已入，根目录 `.DS_Store` 正确跳过，**不发任何请求**。

### 本会话（D）新增/修复的 4 处

| 项 | 位置 | 内容 |
|---|---|---|
| ① 补 `GET /api/admin/products/:id` | `src/server.js:1640-1649` | CLAUDE.md §4 已文档化但代码缺失（只有 PATCH/POST/DELETE）。requireAdmin + `findProduct`（含下架），`ok(res, product)` 返回 `{success,data}`。修掉 `tests/api-room.test.js` 第 3 条红（2/3 → 3/3） |
| ② X2 残留（admin 侧） | `src/admin/scene.html:307,322` | 兜底图仍指向已删 `sofa-zhongshi.jpg` → 改 `/images/sofa-tihua-real.png`。改后全 `src/` 已无该图的真实引用（仅剩 2 行注释说明） |
| ③ 决策 4 兜底实现 | `src/index.html:263`(禁用态 CSS) + `:801-836`(默认图探测缓存 roomImageCache / 按钮禁用 / 引导文案) + `:860-870`(提交前拦截) | 素材 `default-room-bed.jpg` 未到位时：「用默认图体验」禁用并提示「📷 请上传您家的卧室照片（暂无默认卧室图）」；沙发路径不受影响；上传自家卧室照主路径正常 |
| ④ `tests/test_09_bedroom.py` harness 修复 + 补 1 用例 | 同文件 | 原文件自建 `sync_playwright()` 与 conftest 的 session fixture 嵌套，Python 3.14 + pytest asyncio 下必报 "using Playwright Sync API inside the asyncio loop"（2 条全红）→ 改用 conftest `page` fixture，**断言一字未改**；另新增 `test_default_room_missing_falls_back_to_upload`（TC-B.3）把③固化成回归 |

---

## 2. 测试数字

运行方式（隔离、不打真付费 API）：`env TWO_FISH_API_KEY=sk-fake ARK_API_KEY= OPENAI_API_KEY= STEP_API_KEY=sk-fake CHAT_GUIDE_FAKE_MODEL=1 POLLINATIONS_OFF=1 ./node_modules/.bin/playwright test tests/`；Python 侧另起同环境 server 后 `pytest`。MinIO credential 过期 → 本地 fallback，属预期。

### Node（Playwright，109 用例）

| 套件 | 结果 |
|---|---|
| tests/api-room.test.js | **3/3 绿**（会话前 2/3，①修复后 3/3：品类契约 / 品类化 prompt / admin PATCH+GET） |
| tests/api-v3.test.js | **20/20 绿**（TC-A/B/AD API 层、订单脱敏、whole-home styleId 404 修复等） |
| tests/api-v2.test.js | **15/15 绿**（阶段 0 目标 14/14，实际 15 条全绿） |
| tests/api-v1.test.js | **13/13 绿** |
| tests/serverchan.test.js | **6/6 绿** |
| tests/api.test.js | 41 过 / **11 红** |
| **合计** | **98 过 / 11 红** |

### Python（老人视角，38 用例）

| 套件 | 结果 |
|---|---|
| test_09_bedroom.py | **3/3 绿**（④修复前 0/2；新增 TC-B.3 也绿） |
| test_07_ai_copy.py / test_08_scene.py / test_01~03 | 13/13 绿 |
| test_06_admin_user_system.py | 18 过 / 1 红 |
| test_04_order_flow.py / test_05_api.py | 各 1 红 |
| **合计** | **35 过 / 3 红** |

### 14 条红的归类（结论：**零 v3 相关新回归**）

用 `git worktree add /tmp/yxjia-head HEAD` 拉一份** pristine HEAD**（含 15 款商品 + 未删图片）对照跑，逐一溯源：

- **11 条 Node 红 + 3 条 Python 红 = 14 条，全部同一根因**：`data/products.json` 现在只有 7 款，缺 `sofa-1`、`table-1` 和 6 个 `p-*`（AI 识别沙发）。凡是写死用 `sofa-1` 的用例（商品列表/详情/下单校验/legacy `/api/tryon` stub）一律 `404 商品不存在` 或断言失败。
- **该数据丢失发生在 v3 之前**：`data/products.json.bak-before-imgfix`（09-22 17:02）与 v3 开工时的 `data/products.json.v3-bak-1790314215.json`（09-25 13:30）**都已是 7 款** → 不是 v3 改坏的，属 CLAUDE.md §9「读-改-写整体覆盖」老坑的又一次复发，**老板数据决策范畴，本次未动**。
- **1 条 Node 红是环境红**：`api.test.js` 的 chat-guide SSE 流要真模型才出 `delta/done`；假 key 下 HEAD 同样红（pristine HEAD 跑 api.test.js = 51 过/1 红，唯一的红就是它）→ 与 v3 无关。
- 好消息（给老板）：丢失的 8 款里 7 款图片还在 `src/uploads/products/`，只有 `table-1` 的 `/images/cabinet-wardrobe.jpg` 在被删的三张图里——恢复是一次小合并，不是重建。

### v3 验收 checklist 对照

| spec 验收项 | 状态 |
|---|---|
| 首页沙发板块不再顶格 6、卧室板块可逛、无空 section、无 JS 异常 | ✅（test_09 首条：板块标题含「沙发」「卧室·床」，无 pageerror） |
| 沙发试摆不回归 / 床试摆「把床搬回家」 | ✅（api-room 第 2 条逐字断言 sofa 零回归 + bed→卧室/床；api-v3 20/20） |
| X1 登录上传文件不再 400 | ✅（api-v3 覆盖） |
| X2 无已删图引用残留 | ✅（hero/兜底 + admin/scene.html 全清，grep 双断言） |
| 一套预设两端可用、无品类写死词 | ✅（presets 中性化，api-v3 断言） |
| 后台能改品类并保存、列表显示品类中文名 | ✅（A1/A2 + api-room 第 3 条 GET 反映生效） |
| 入库工具 dry-run / 串行 / 续跑 / 新品下架 | ✅ dry-run 实跑通过；串行为 for-await 实现（TC-I.2~I.5 未在本会话自动化，见下） |
| 两色调 / 零新依赖 / 无框架 / 无数据库 / 既有用例零新增红 | ✅（package.json 未动；回归红集合 ⊆ HEAD 可知的历史红） |
| 不 git commit、team/ 三件套齐全 | ✅ |

---

## 3. 坑与解决

1. **`GET /api/admin/products/:id` 文档承诺了但代码没有** → 测试和 admin 前端都按"存在"写。admin 前端其实走 `/api/products?all=1` 整表、编辑时按 id 找，所以从不调单 GET——纯文档/契约债。已补实现（含下架也返回，admin 要看下架品）。
2. **Python 测试 harness 嵌套坑**：`test_09_bedroom.py` 自建 `sync_playwright()`，而 conftest 的 session 级 `browser` fixture + Python 3.14 的 per-test asyncio 循环会让 Sync API 直接抛错。改成复用 conftest `page` fixture（与 test_01/07/08 一致），断言未动。**教训：新 py 测试不要自起 playwright，一律用 conftest fixture。**
3. **假 key 环境下的 chat-guide 红**：`CHAT_GUIDE_FAKE_MODEL=1` 只放行"缺 key 也开 SSE"，但 step_plan 路径用假 key 仍会 error → 该用例本质是"有真模型才绿"。排回归时用 pristine HEAD 对照即可识别，不必改代码。
4. **决策 4 素材缺席**：`/images/default-room-bed.jpg` 不存在（全项目只有客厅默认图）。若按原实现直接下发，顾客点「用默认卧室图体验」会拿到 404 裂图 + 合成失败。已按 spec 决策 4 做探测→禁用→引导上传的兜底（含提交前二次拦截），主路径零影响。
5. **products.json 8 款丢失（历史坑复发）**：根因是读-改-写非原子覆盖（`server.js:2474-2501` 附近）。本次未动数据；建议老板用 `.bak-before-imgfix` 合并恢复（7 款图还在）。
6. **MinIO credential 过期**：日志 `ensureBucketPublic failed: signature does not match` → 自动本地 fallback，测试与功能不受影响，属预期（待老板更新 MINIO_ACCESS_KEY/SECRET_KEY）。
7. **老规矩仍生效**：改 server.js 后 `node --check` + 重启测试进程才跑回归（本会话两次都遵守）。

---

## 4. 给产品角色的反馈（进 v4 候选池）

1. **B4 遗留（`/v4`）**：`buildTryonPrompt`(`server.js:920`)、`callPollinations`(`:889`) 空 prompt 兜底句、`callStepImageEdit`(`:829`) 自拼 prompt 仍写死「客厅/沙发/抱枕」。live 主路径不可达（finalPrompt 恒非空），step 路径随阶跃图像下线将废——所以**本版不改**，但床品类若走到这两个兜底，话术仍是"客厅/沙发"，建议 v4 一并参数化（把 category 传进 callStepImageEdit 即可，改动很小）。
2. **柜类/桌几已留地基但 `enabled:false`**：`data/categories.json` 里配好了 room/noun/defaultRoom，下一轮只需改 enabled + 补商品，首页零改动。建议 v4 直接开「柜类」。
3. **legacy `tryon.html` + stub `/api/tryon`**：本版按 spec 绕开（卡片按钮改激活页内试摆），但 stub 仍在、且被 1 条老测试覆盖。建议 v4 明确退役（删 stub 或让按钮跳页内），别让它继续当"坏链"存在于代码里。
4. **后台品类编辑只做了下拉，没有"按品类筛选/排序"**：品类一多（沙发 10+、床 10+），老板在 `/admin/products` 找货会累。建议 v4 加品类筛选 tab。

## 5. 给老板的后续（按优先级）

1. **23 张新图还没入库**（只跑了 dry-run）。真入库请跑 `node tools/ingest-new.mjs`（严格串行、新品默认「下架」、断了能续跑）。跑前请先定 `data/new/床/未命名.png` 要不要入（spec 决策①，建议手动删掉明显非商品图）。
2. **`data/products.json` 少了 8 款**（sofa-1 主推、table-1 + 6 个 AI 沙发）。图大多还在 `src/uploads/products/`，建议用 `data/products.json.bak-before-imgfix` 合并恢复后再入库，否则首页/下单链路的 14 条测试红会一直挂着。
3. **MinIO credential 待更新**（signature does not match，当前走本地 fallback，重启服务器后会丢已上传图的在线访问）。
4. **卧室默认图素材**：`/images/default-room-bed.jpg` 缺（决策 4 已做禁用+引导兜底，不影响上线）。补一张店里真实卧室空场照到 `src/images/` 即可自动点亮「用默认卧室图体验」。
5. **入库后上架**：新品全部落在「下架」，需要您在 `/admin/products` 逐款改「在售」才会进顾客货架。
6. `team/STATE.md` 版本状态机更新留给主控；本会话**未 git commit**，所有改动（含 3 处修复 + 1 个测试用例）都在工作区待审。
