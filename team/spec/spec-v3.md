# Spec v3：多品类地基 + 沙发扩容 + 卧室板块「把床搬回家」

> 角色 P · 2026-09-25 · 输入：team/marketing/insights-v3.md、team/spec/spec-v2.md、team/HANDOFF.md、CLAUDE.md，以及主控 3 个并行研究 agent 对 server.js/index.html/products.json 的实测复核（含线上复现 bug）。
> 原则：改动面尽量小、零新依赖、老人友好、两色调、无前端框架、无数据库；图像合成只走 twofishai gpt-image-2 主路径 + Pollinations 兜底（勿迁阶跃）；**不 git commit**，改动留工作区给老板审。
> v3 一句话验收：**首页有「沙发板块」（≥10 款、不再顶格 6）和「卧室板块」（床可逛、可「把床搬回家」合成）；沙发试摆与床试摆同一套机制、各自默认房间图；两个活的试摆 bug 不再复现；后台能改品类；23 张新图经可复用的串行工具入库。**

## Overview

本版是"从单品货架 → 多品类家具体验"的**结构性升级**，三条主线：
- **主线 A｜品类/板块地基**：商品补 `category` 字段 + 新增 `data/categories.json` 板块配置；首页从"写死 6 款"改为**按板块数据驱动循环渲染**（去掉 `.slice(0,6)`）。这是"再进来 N 个品类也不用改首页结构"的唯一做法，必须先做。
- **主线 B｜沙发扩容 + 卧室板块**：`data/new/沙发`(11 张)入库成沙发；`data/new/床`(11 张)入库成床；把试摆从"沙发/客厅"**通用化**（默认 prompt/预设/默认房间图/文案按 `category` 走），让「把床搬回家」与「把沙发搬回家」同机制。
- **配套｜可复用串行入库工具 + 必修 bug**：补上 spec-v1 当年推迟的"批量入库"（严格串行），顺手修 2 个让旗舰试摆断掉的活的 bug。

## 现状调研结论（dev 必读，已 grep/实测复核）

| 事实 | 位置 | 对 v3 的影响 |
|---|---|---|
| 商品**无 `category` 字段**（7 款全无），品类只能靠 id 前缀/emoji 猜 | data/products.json | 板块渲染、试摆通用化都要先补 category |
| 已有**三套互不兼容的类别词表**：英文白名单 `['sofa','cabinet','bed','table','other']`（server.js:2408）、中文塞 subtitle（server.js:2262 + admin/product.html:46）、前端读英文（index.html:610 sort、613/621/636 渲染）— 需统一 | 见各处 | category 取值必须定死为**英文 id**，中文名只放板块配置层 |
| `sceneRoomForProduct()` 已把 `bed→卧室`，但因无 category 成**死代码** | server.js:299-303 | 补活它即可驱动"床→卧室"默认房间/prompt |
| 试摆"客厅+沙发"硬编码散落 6 处：prompt 串 server.js:2649/2778/3152（同一串）、buildTryonPrompt 869-885、step edits 799、presets 默认 125-128（+ data/presets.json） | server.js + data/presets.json | 通用化 = 把这些 `客厅/沙发` 换成按 category 取出的 `${room}/${noun}` |
| 合成机制**本就品类无关**（gpt-image-2 edits 吃 room+商品两张图；`bed-1` 实测能合成） | callTryonAI server.js:687 | "把床搬回家"不需要新合成逻辑，只改 prompt/默认图/文案/选择 |
| `DEFAULT_ROOM_URL='/images/default-room.jpg'`，**只有客厅默认图**，无卧室默认图 | index.html:721 | 床的"用默认图体验"需一张卧室空场图（见决策 4，非阻塞：顾客上传自家卧室照为主路径） |
| 首页"6 款"写死 `.slice(0,6)` | renderCatalog index.html:616 | 去掉 slice，改板块循环，否则新上架沙发/床顾客看不见 |
| **活 bug 1**：登录用户上传**文件**分支只 `fd.append('room')`，没带 sofa/productId/prompt → `/api/tryon/ai-custom` 400（线上复现） | index.html:807-809 | 必修：该分支补齐与 anon 相同的 FormData 字段 |
| **活 bug 2**：`/images/sofa-zhongshi.jpg` 已被删（git `D`），仍被 hero 主图(370)、hero 回落(600)、商品兜底(server.js:2647) 引用 → 404 | index.html:370,600 + server.js:2647 | 必修：改指向未删图或按 category 取默认图 |
| products.json 追加是**读-改-写、非原子**，并发上传互相覆盖 | server.js:2474-2501 | 入库工具**必须严格串行**（await，禁 Promise.all），可续跑 |
| 后台商品编辑弹窗**无品类输入**，PATCH 也不收 category | admin/products.html:86-98,193-201 | 补一个品类下拉（老板痛点 2） |
| 线上 /api/products 只有 **3 款沙发**，本地 7 款；核心手工商品疑似线上被覆盖/未同步 | 线上 + CLAUDE.md 第 9 节 | 部署以本地为唯一事实源、覆盖前备份（见"给老板决策"②，属部署非 dev） |
| spec-v2（场景图工厂）代码写完但**停在收尾验证**（429 打断） | HANDOFF.md 第 3 节 | v3 开工前先跑 v2 测试落定水位，避免新旧缠架（见实施顺序阶段 0） |

## 关键设计决策

### 决策 1：品类建模 → `category`(英文 id) + `data/categories.json`(板块配置)，中文名只在配置层
**推荐**。商品加 `category`，取值限定 server.js:2408 已有白名单 `sofa/bed/cabinet/table/other`。新增 `data/categories.json`（对齐 presets/scene-styles 先例，ensureDirs 自动建默认），结构：
```json
{ "categories": [
  { "id":"sofa",  "name":"沙发",   "room":"客厅", "noun":"沙发", "defaultRoom":"/images/default-room.jpg", "badge":"主推", "sort":1 },
  { "id":"bed",   "name":"卧室·床", "room":"卧室", "noun":"床",   "defaultRoom":"/images/default-room-bed.jpg", "sort":2 },
  { "id":"cabinet","name":"柜类",  "room":"客厅", "noun":"柜子", "defaultRoom":"/images/default-room.jpg", "sort":3, "enabled":false },
  { "id":"table", "name":"桌几",   "room":"餐厅", "noun":"桌子", "defaultRoom":"/images/default-room.jpg", "sort":4, "enabled":false }
]}
```
- `room` 驱动 `sceneRoomForProduct` 的默认房间与试摆 prompt；`noun` 驱动 prompt 里的"沙发/床/柜子"名词；`defaultRoom` 驱动"用默认图体验"；`enabled:false` = 品类有数据但暂不在首页开板块（柜/桌下一轮再开，**本版只 sofa/bed 开**）。
- 备选（否决）：把中文当 key、或每品类一个 JSON——都更脆、与现有英文白名单冲突。用英文 id + 中文名分层，是兼容既有三处词表的最小统一。
- **Why**：品类会一批批来；这是未来零首页改动的唯一地基。

### 决策 2：首页板块渲染 → 数据驱动循环，删 `.slice(0,6)`
将 `renderCatalog()`(index.html:606) 推广为 `renderSection(cat)`，对 `/api/categories` 里 `enabled && 有在售商品` 的品类各生成一个 `<section>`（板块标题=cat.name + badge + 该品类商品网格）。商品卡片保留真实图 + 名称 + 价格 + **「🛋/🛏 把这款搬回家」按钮**（点按钮=激活页内试摆并带入 category+product，见决策 3）。网格仍两色调、真实图、大按钮。**去掉 slice 上限**。
- **Why**：直接解"首页顶格 6 款"，且新品类零前端改动。

### 决策 3：旗舰试摆通用化 → 页内试摆带 `category` 上下文
页内 `#tryon` 增加品类上下文（`SELECTED_CATEGORY`）：选品类(或从板块卡片按钮带入)后，① 默认房间图取 `cat.defaultRoom`；② `#furnGrid`(index.html:628 renderFurnGrid)过滤为该品类商品；③ 预设/自定义 prompt 名词按 `cat.noun/cat.room`；④ 提交时把 `category` 一并带给后端。**不跳转 legacy tryon.html**（它忽略 `?product=` 且打到 stub `/api/tryon`，属坏链，本版让卡片按钮改为激活页内试摆，不修 tryon.html 本身）。
- backend 收到 `category`（或从 productId 反查商品 category）后：默认 prompt 用 `${room}/${noun}`，预设按 `room` 选，兜底默认图用 `cat.defaultRoom`。
- **Why**：同一套已验证合成链路，两个品类共用；新增品类只是多一份板块配置。

### 决策 4：卧室默认图 → 数据字段 + 非阻塞兜底
`cat.defaultRoom` 数据驱动。床的 `/images/default-room-bed.jpg` 是**新增必需素材**，两条获取途径（其一即可）：① 老板传一张店里真实卧室空场照；② 用现有合成/场景图链路一次性生成一张中性空卧室。**代码兜底**：若某品类 `defaultRoom` 缺失，该品类"用默认图体验"按钮禁用并提示"请上传您家的照片"，**主路径（顾客上传自家卧室照）不受影响**，故素材未就绪也不阻塞上线。
- **Why**：把"必需品"从代码里解耦成素材，避免为等一张图卡住整个版本。

### 决策 5：预设中性化 → `data/presets.json` + 默认值(server.js:125-128)改成品类无关句式
5 个预设（自然/暖光/夜晚/极简/家庭）文案去掉"客厅/沙发/茶几/抱枕"等写死词，改为光影/氛围/整洁度的中性描述（如"午后暖阳光洒入，家具表面有温柔光斑"）。这样一套预设两个（乃至 N 个）品类共用。房间词由后端按 `cat.room` 注入，不再写死在预设里。
- **Why**：解"预设写死客厅"，且运营在 `/admin/presets` 改一次两端生效。

### 决策 6：可复用串行入库工具 → `tools/ingest-new.mjs`
一个 Node 脚本，作为当年欠下的"批量入库"的正式实现：读目录（默认 `data/new`，子目录名→品类 hint，如 `沙发→sofa`、`床→bed`）→ admin 登录取 cookie → **严格串行 for-await** 调 `/api/admin/upload-and-identify`（AI 命名）→ 新入库品 PATCH `status="下架"` 待老板审。带 `--dry-run`、断点续跑（按已存在 product 的图片 hash / 或工具自记的 `.ingested.json` 跳过）、失败即停报哪张。`data/new` 加入 `.gitignore`。
- **Why**：库存会一批批来，这是老板侧最省时的单点投入；也正面回答"是不是又上传 skill"——**没有现成 skill，本版把它做成一个能反复用的工具**。

## 数据结构变更（向后兼容，零迁移）

- `data/products.json`：每个商品新增可选 `category`（英文 id）。**补数据脚本**按 id 前缀回填既有 7 款（`sofa-*`→sofa、`bed-*`→bed、`cabinet-*`→cabinet、`table-*`→table、`p-*`(AI 沙发)→sofa）。旧商品无 category 时前端/后端按 `'sofa'` 兜底（不报错）。
- `data/categories.json`（新建）：见决策 1。经 `GET /api/categories` 公开读（前端用），未来可照 presets 做后台编辑（本版只读，不做编辑页）。
- `data/presets.json` + server.js:125-128：预设文案中性化（决策 5）。
- `uploads.json`：入库工具走既有 upload-and-identify 落库逻辑，不新增 type。

## 后端改动点（server.js）

| # | 改动 | 位置 | 说明 |
|---|---|---|---|
| B1 | ensureDirs 建 `data/categories.json` 默认 4 品类 + `loadCategories()`（照抄 loadPresets）+ `GET /api/categories` 返回 `{categories}`（只返 `enabled`） | ~111-122 + 公开端点区 | ~30 行；默认 sofa/bed enabled、cabinet/table disabled |
| B2 | `sceneRoomForProduct`/默认房间改**读 category**（不再只认 'bed'）；`categoryForProduct(p)` 用 `p.category||'sofa'` | server.js:299-303 | 用 categories.json 的 `room` 覆盖，缺省 '客厅' |
| B3 | 试摆默认 prompt 通用化：把 2649/2778/3152 同一串的 `客厅…沙发` 换成 `${room}…${noun}`（room/noun 由 B2 + categories.json 取） | server.js:2649,2778,3152 | 抽一个 `buildTryonDefaultPrompt(product, {room,noun})`，三处调用，杜绝再次分叉 |
| B4 | buildTryonPrompt(869-885)、step edits(799)、Pollinations(852-853) 的客厅/沙发写死词一并中性化/参数化 | server.js:799,869-885,852-853 | 与 B3 同一组 room/noun |
| B5 | presets 默认值(125-128)中性化 + `/api/tryon/presets` 支持按 `?category=` 注入 room（或前端注入，取其一， spec 建议**后端注入**，与 prompt 同源） | server.js:125-128 + presets 端点 | 5 条预设文案去掉品类词 |
| B6 | 试摆端点(ai-custom/ai-history/ai-anon)接受并透传 `category`（无则从 productId 反查商品 category） | 三端点 | 兜底默认图用 `cat.defaultRoom` |
| B7 | **修 bug**：成品兜底图(server.js:2647)不再指向已删的 `sofa-zhongshi.jpg`，改按 category 取 `cat.defaultRoom` 或在售商品图 | server.js:2643-2647 | 消除 404 兜底 |
| B8 | upload-and-identify 已写 `category`(2408/2481) —— 确保 hint/中文子目录名→英文 category 映射正确（沙发→sofa、床→bed…）| server.js:2408,2481 | 供入库工具产出正确品类 |
| B9 | `normalizeProduct` 已会 fixImageUrl；补：读时确保 `category` 字段透出（无需改，确认即可） | server.js:164-174 | 确认项 |

## 前端/顾客端改动点（index.html 为主）

| # | 改动 | 位置 | 说明 |
|---|---|---|---|
| F1 | `renderCatalog` → `renderSection(cat)` 板块循环，去 `.slice(0,6)`；对 `enabled` 品类各出一 section | index.html:606-626 | 数据来自 `/api/categories` + `/api/products` |
| F2 | 商品卡加「把这款搬回家」按钮 → 设 `SELECTED_CATEGORY`+`SELECTED_PRODUCT`、切默认图、滚到 `#tryon`、刷新 `renderFurnGrid` | index.html:616 模板 + tryon 区 | 大按钮、两色调 |
| F3 | `#tryon` 品类上下文：`SELECTED_CATEGORY` 状态机 + 品类切换器（沙发/卧室 tab，老人友好大 tab）；`renderFurnGrid` 按品类过滤 | index.html:628-641 + tryon 375-469 | 默认房间/prompt 随品类 |
| F4 | **修 bug**：登录上传**文件**分支补 `fd.append('sofa'/'productId'/'prompt'/'preset'/'category')`，与 ai-history 分支对齐 | index.html:807-809 | 消除 400 |
| F5 | **修 bug**：hero 主图(370)/hero 回落(600)不再用已删 `sofa-zhongshi.jpg`，改指向未删在售主图（如 sofa-tihua-real.png）或 heroImg 直接取首个在售沙发图 | index.html:370,596-600 | 消除首页裂图 |
| F6 | 首屏文案：`搬回家`相关 copy 品类化（沙发搬回家/床搬回家），steps/hero/tryon 文案去"只沙发"暗示 | index.html:365-366,377,408,445,474,497,532,789 | 逐处品类化，两色调不变 |

## 后台改动点（admin）

| # | 改动 | 文件 | 说明 |
|---|---|---|---|
| A1 | 商品编辑弹窗加**品类下拉**（读 `/api/categories` 或写死白名单），PATCH body 带 `category` | src/admin/products.html:86-98,193-201 | 老板痛点 2 的正解；admin 页现有 --red/--green 不改（顾客端仍两色调） |
| A2 | products 列表 meta 区显示 `category` 中文名（已有 `p.category||'家具'`，接入 categories.json 映射） | src/admin/products.html:134 | 让后台看懂品类 |

## 入库工具（tools/ingest-new.mjs，决策 6）

- 输入：`node tools/ingest-new.mjs [--dir data/new] [--base http://127.0.0.1:3000] [--dry-run]`
- 流程：admin 登录(admin/123456)→ 列 `--dir` → 子目录名映射品类(`沙发→sofa,床→bed`，其余跳过并 warn)→ **for-await 串行**：跳过 `.ingested.json`/hash 已记录的 → `upload-and-identify`(带 hint=中文子目录名) → 拿返回 id PATCH `status:"下架"` → 记 `.ingested.json` → 下一张。`--dry-run` 只列不传。
- 硬线：**串行**（并发会触发 products.json 读-改-写覆盖，见 2474-2501）；失败即停并打印失败文件，便于老板处理后重跑续传。
- `.gitignore` 追加 `data/new/` 与 `tools/.ingested.json`。

## bug 修复清单（旗舰试摆链路，必修）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| X1 | 登录顾客上传文件试摆必 400 | index.html:807-809 只带 room，缺 sofa/productId/prompt | F4 |
| X2 | hero/兜底图 404 | sofa-zhongshi.jpg 已删仍被引 | F5 + B7 |

## 实施顺序（各阶段可独立合入/回滚）

- **阶段 0（收尾 v2，非本版功能但必须先）**：跑 `tests/api-v2.test.js`(目标14/14) + `tests/test_08_scene.py`(目标5/5) + 全量回归，把 v2 水位写进 STATE；`tests/` 全量若红，先判断是否 v2 遗留。**不重写 v2**。
- **阶段 1（地基，主线 A，~半天）**：B1、B2、B3、B8、B9 + category 补数据脚本（本地跑一次）+ A1/A2。此阶段结束首页仍可只显示沙发，但 category 已就位、后台可管品类。
- **阶段 2（前端板块，主线 A，~半天）**：F1、F2、F3、F6。首页出"沙发板块/卧室板块"两块（床此时可能还没入库，卧室板块为空则 F1 不渲染该 section）。
- **阶段 3（试摆通用化 + bug，主线 B，~半天）**：B4、B5、B6、B7、F4、F5。沙发/床两品类试摆打通，X1/X2 消除。
- **阶段 4（入库 + 素材，主线 B，半天~运营）**：tools/ingest-new.mjs 写好 → **dry-run** 给老板过目 → 串行入库 data/new(先沙发后床，可分批) → 决策 4 的卧室默认图到位 → 老板在后台把想上架的品 `下架→在售`。
- **阶段 5（部署同步，主控/老板）**：以本地 products.json 为唯一事实源，**覆盖前备份线上 data/*.json**，合并推送（见"给老板决策"②）。dev 不 git commit。

## 验收标准（checklist）

- [ ] 首页有「沙发」板块（≥10 款、**不再顶格 6**）与「卧室·床」板块（床入库后可逛）；无 enabled 品类/空品类不渲染空 section、无 JS 报错
- [ ] 顾客在沙发品类试摆：默认客厅图 + 沙发 prompt，合成成功（与改动前一致）
- [ ] 顾客在床品类试摆：默认卧室图（缺失则有友好提示、上传自家卧室照为主路径仍成功）+ 床 prompt，合成成功（"把床搬回家"）
- [ ] X1（登录上传文件试摆）不再 400；X2（首页/兜底裂图）不再出现
- [ ] 一套预设（自然/暖光/夜晚/极简/家庭）沙发/床两端都可用，文案无品类写死残留
- [ ] 后台能改商品品类并保存生效；products 列表显示品类中文名
- [ ] 入库工具：`--dry-run` 正确列出待入库名单；**串行**入库、重复跑跳过已存在、新品默认"下架"、失败即停可续跑
- [ ] 全部页面两色调、零新依赖、无前端框架、无数据库；既有 61 Node + Python 用例**零新增红**
- [ ] （本版不 git commit）改动全部留在工作区，`team/` 三件套（spec/qa/dev-log）齐全待老板审

## 给测试角色（T）的交接

1. 沿用 api-v1/api-v2 双进程 mock：被测 server(3100) + mock AI(3199)；`TWO_FISH_API_KEY='sk-fake'`（显式非空防 .env 真值漏入）+ `TWO_FISH_EDITS_URL` 指向 mock；失败路径用 `POLLINATIONS_OFF=1`（mock 500 → 断言 502 无脏数据）。
2. 建议用例（新建 `tests/api-v3.test.js` + Python `test_09_bedroom.py`）：
   - `GET /api/categories` 只返 enabled；sofa/bed 在、cabinet/table 不在
   - 试摆通用化：category=sofa → prompt 含"客厅/沙发"；category=bed → prompt 含"卧室/床"（断言发给 mock 的 lastBody）
   - 默认房间图：bed 品类下发 `defaultRoom=/images/default-room-bed.jpg`；缺失时主路径（上传自家图）仍 200
   - 兼容：无 category 的旧商品按 'sofa' 兜底，不报错；首页/试摆不裂图
   - X1 回归：登录 + 上传文件 + productId → ai-custom 200（不再 400）
   - X2 回归：hero/兜底图指向的路径 `HEAD` 都 200（无 sofa-zhongshi.jpg）
   - 首页渲染：≥10 款在售沙发全部露出（去 slice）；空 enabled 品类不渲染 section
   - admin：PATCH `/api/admin/products/:id` 带 `category:"bed"` 后 GET 反映生效；无 cookie → 401
   - 入库工具：可对临时目录 `--dry-run` 断言名单；串行（断言非并发——可在脚本里加一个运行中计数器或用时间戳间隔证明）；重复跑第二次跳过全部
3. Python（老人视角）：首页出现"沙发""卧室"板块标题；床试摆页品类切换器可达、按钮够大；两色调抽查（无明显红/绿/蓝原色块）。
4. 老规矩：server.js 被 linter 动过必须重启测试进程；MinIO 未启动 saveImage 走本地 fallback、`ECONNREFUSED 9000` 属预期；mock 1x1 png 不得被最小尺寸拦截。

## 非目标（v3 明确不做）

- 不做异步任务队列/任务表（同步 + 前端计时器，沿用 spec-v2 决策 2）；不做场景图失败 demo 兜底（诚实性硬线）。
- **不动 spec-v2 场景图工厂本体**（v2 资产，仅阶段 0 落定其测试水位，不回退）。
- 不引任何新依赖/新模型；不碰阶跃图像模型；不修 legacy `tryon.html`/stub `/api/tryon`（本版用页内试摆绕开，另记技术债）。
- 柜/桌/椅/餐厅板块**内容不做**（地基留好、`enabled:false`，下一轮再开）。
- 不做 `/api/categories` 的后台编辑页（本版只读；照 presets 模式将来可加）。
- 不做并发上传优化/原子写改造（只保证工具串行；真要改原子性是 v4 数据层议题）。
- **不 git commit**（团队规则：改动留工作区给老板审）。

## 给老板的两处决策（不阻塞开发，spec 标注）

1. `data/new` 里的**非商品图**（如 `床/未命名.png`、可能的截图/杂物图）：是否入库？**建议**：老板先手动清掉明显非商品图，或入库工具加 `--skip` 名单；不确定的图入库默认"下架"待审，不影响在售货架。
2. **线上 3 款 vs 本地 7 款**以哪份为准？**建议**：本地 products.json 为唯一事实源，部署合并时**先备份线上 data/*.json 再覆盖**（CLAUDE.md 第 9 节坑）。此项属阶段 5 部署动作，由主控/老板执行，dev 不碰。

## 相关文件（绝对路径）

- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/server.js`（B1-B9）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/index.html`（F1-F6）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/admin/products.html`（A1-A2）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/data/products.json`（补 category）、`data/categories.json`（新建）、`data/presets.json`（中性化）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/tools/ingest-new.mjs`（新建）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/data/new/{沙发,床}`（待入库素材）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/tests/api-v3.test.js`、`tests/test_09_bedroom.py`（新建）
- `team/spec/spec-v3.md`（本文件）、`team/qa/testcases-v3.md`（待 T）、`team/dev/dev-log-v3.md`（待 D）
