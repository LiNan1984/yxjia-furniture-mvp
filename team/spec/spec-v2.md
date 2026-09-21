# Spec v2：AI 商品场景图生产（调研文档 #12）

> 角色 P · 2026-09-18 · 输入：team/marketing/insights-v2.md、team/dev/dev-log-v1.md、team/STATE.md、docs/AI能力调研.md、CLAUDE.md
> 原则：改动面最小、零新依赖、老人友好、两色调、无前端框架、无数据库；图像合成只走 twofishai gpt-image-2 主路径 + Pollinations 兜底（阶跃图像接口 2026-10-10 已下线，勿用）
> v2 一句话验收：**老板能从在售商品里任选一款，两分钟内得到一张能直接发朋友圈的场景图（含"AI 合成场景图，仅供参考"的复制文案）。**

## Overview

复用已跑通的试摆合成链路（`callTryonAI` 里的 twofishai `/v1/images/edits` 调用 + Pollinations 兜底 + MinIO 写入），新增"商品场景图"能力：取商品主图 → 按专用风格卡生成 1 张"摆进真实家庭场景"的写实图 → 存 MinIO compositions → 落 `products.json` 新字段 `sceneImages`。产出三吃：① 老板后台一键下载/复制文案发朋友圈小红书（解 0 曝光）；② 商品详情页"摆进家里是什么样"画廊（解图不对版顾虑）；③ 每款商品营销素材从 1 张实拍图裂变到最多 5 张。

## 现状调研结论（dev 必读）

| 事实 | 位置 | 影响 |
|---|---|---|
| twofishai 调用块（FormData + `image[]` + b64/url 双返回处理）可直接抽出复用 | src/server.js:536-568 | 场景图只需 1 张输入图（商品主图），比试摆的 room+sofa 双图更简单 |
| Pollinations 兜底：tmpfiles.org 传图 → `image.pollinations.ai` image-to-image | src/server.js:673-702 | 可复用，但 prompt 拼法要改成"场景保留 + 商品置入"（而非"替换沙发"） |
| `readProductImageBuffer()` 已能按 product.image 拿原图 buffer（本地/MinIO/外链三路兜底） | src/server.js:1923-1942 | 场景图端点零新增取图逻辑，regenerate-copy 同模式 |
| `saveImage(buffer, 'compositions', filename)` 一行完成 MinIO 写入 + 本地 fallback | src/server.js:421-434 | 场景图存 compositions 目录，复用 /uploads/* 代理 |
| `normalizeProduct()` 读取时对 `images` 数组做 fixImageUrl，但只认 `image`/`images` 字段 | src/server.js:164-174 | 新字段 `sceneImages` 需在 normalizeProduct 补一行 fixImageUrl，否则顾客端拿到 127.0.0.1:9000 绝对地址 |
| `pickCachedCompositionForProduct` 按 uploads.json `type==='composition'` 匹配 tryon 兜底缓存 | src/server.js:444-470 | 场景图记录必须用独立 type（如 `'scene'`），**不能**写 type='composition'，否则会污染试摆兜底缓存 |
| 预设机制参考：data/presets.json 5 风格 + `loadPresets/savePresets` + GET/PUT admin presets + presets.html 编辑页 | src/server.js:212-223, 2438-2460 | 结构可照抄，但**不复用同一份文件**（见"风格从哪来"） |
| twofishai 调用目前**无超时**（fetch 无 AbortSignal） | src/server.js:545 | 场景图端点补 `AbortSignal.timeout(90000)`，防后台请求吊死 |
| `TWO_FISH_EDITS_URL` 是硬编码 const | src/server.js:48 | 改为 `process.env.TWO_FISH_EDITS_URL \|\| 默认值`（1 行），测试可指向本地 mock |
| 商品主图多为白底/展厅实拍（products.json 3 条 image 均为 /uploads/products/*.png） | data/products.json | edits 单图输入即可，无需双图 |
| 后台商品卡操作区现有 编辑/上下架/删除 三按钮 | src/admin/products.html:134-138 | 加"场景图"入口按钮，跳独立页面（老人友好：大按钮大字，不塞弹窗） |
| 详情页 section 全部条件渲染（suitableFor/placementTip 模式现成） | src/product.html:95-104 | 画廊照此模式，无场景图不出现空区块 |
| **dev-log-v1 反馈池 #4 已过时**："regenerate-copy 无后台按钮"——当前 products.html:97 已有 `btn-regen`（m-regen handler 157-174） | src/admin/products.html:97 | 该反馈项**已完成**，v2 只需补回归测试，不再排开发 |
| 语音导购人设的 catalogLines 只拼 name/price/subtitle/size | src/server.js:1134-1153（buildVoiceGuideInstructions） | 顺手件：加 suitableFor/placementTip 两字段 |
| 全局并发参考：VOICE_RT_MAX_SESSIONS / CHAT_GUIDE_LIMIT 均为模块级变量限额 | src/server.js:866-878, 2906 | 场景图并发护栏照此模式 |

## 关键设计决策

### 决策 1：风格从哪来 → 新建 `data/scene-styles.json`，不复用 presets.json

理由：
1. **语境不同**：presets.json 的 5 条 prompt 全是"客厅+沙发"句式，写死品类；场景图要服务 bed/cabinet/table，prompt 必须品类中性 + 按商品 category 选房间。
2. **受众和编辑权不同**：presets.json 是顾客试摆下拉框选项，老板在 `/admin/presets` 改它会影响顾客页文案；营销素材风格卡是运营资产，耦合在一起会互相误伤。
3. **改动面相同**：新建文件的 ensureDirs 默认写入 + loader 共 ~30 行，与复用 presets 相当。

`data/scene-styles.json`（ensureDirs 自动创建，结构照抄 presets）：

```json
{
  "styles": [
    { "id": "daylight",  "name": "明亮家居", "scene": "客厅", "prompt": "白天自然光，窗外光线柔和，家具摆在采光好的位置，画面干净通透" },
    { "id": "warmlight", "name": "暖光氛围", "scene": "客厅", "prompt": "傍晚暖黄灯光，家具表面有温暖光斑，氛围温馨" },
    { "id": "night",     "name": "夜晚温馨", "scene": "客厅", "prompt": "夜晚室内，暖色台灯照明，家具在柔和灯光下显得安稳" },
    { "id": "minimal",   "name": "极简留白", "scene": "客厅", "prompt": "极简风格空间，大量留白，家具居中突出，背景干净" },
    { "id": "family",    "name": "家庭生活", "scene": "客厅", "prompt": "有生活气息的家庭环境，茶几上有茶杯书本，地面有地毯，真实住家的样子" }
  ]
}
```

`scene` 字段按商品 category 覆盖：`bed→卧室`、`table→餐厅`、其余用默认。阶段 3 可选：照抄 presets.html 做一个 `/admin/scene-styles` 编辑页（默认 5 条够用，不进 v2 验收）。

### 决策 2：同步端点 + 前端计时器，不做异步 job 队列

现有 regenerate-copy（10-20s）和试摆链路全部是同步请求 + 前端禁用按钮/读秒。异步 job 需要任务表、状态机、轮询端点，改动面翻倍且与项目模式不一致。15-60s 的同步 HTTP 在 Express 下没有实际障碍。**批量生成不做后端队列**，用前端顺序循环（见阶段 3）。

### 决策 3：失败不兜底 demo 图（诚实性硬线）

试摆链路失败时会回落 side-by-side/商品原图/历史缓存——对顾客体验合理。**场景图绝不能这样**：老板拿到一张"不是场景图"的图发出去就是事故。场景图链路只有两级：twofishai 成功 → 返回；twofishai 失败 → Pollinations；都失败 → 502 明确报错"生成失败，请再试一次"。无第四级兜底。

### 决策 4："AI 合成"标注用文字不烧图

- **不**把水印烙进图片（sharp 烧字既丑又不可逆，老板可能要发原图质量的素材）；
- 后台"复制发圈文案"按钮生成的文案**末尾固定带**"（AI 合成场景图，仅供参考，实物以到店为准）"；
- 顾客详情页画廊下方显示小字"AI 合成场景，仅供参考"。
与营销交接第 4 条及项目"不说假话"原则一致。

## 数据结构变更（products.json，向后兼容）

商品对象新增 1 个可选字段：

```json
{
  "id": "p-xxx",
  "image": "/uploads/products/xxx.png",
  "sceneImages": [
    {
      "url": "/uploads/compositions/scene-p-xxx-daylight-1726xxxx.jpg",
      "styleId": "daylight",
      "styleName": "明亮家居",
      "demoType": "ai-composition",
      "createdAt": "2026-09-18T12:00:00.000Z"
    }
  ]
}
```

兼容规则：
- 旧商品无 `sceneImages` → 前台条件渲染，零迁移
- `demoType` 只允许 `'ai-composition'`（twofishai 或 Pollinations 成功），失败即 502 不落库（决策 3）
- `normalizeProduct()` 补一行：`if (Array.isArray(out.sceneImages)) out.sceneImages = out.sceneImages.map(s => ({...s, url: fixImageUrl(s.url)}))`
- 每商品 `sceneImages` 上限 = 风格数（5）；同 styleId 去重（force 重生成 = 替换原条目，不追加）
- 删除场景图 = 从数组移除条目，**不删 MinIO 文件**（省一条 MinIO 删除链路，孤儿文件无害）

uploads.json 记录（type 用独立值 `'scene'`，勿用 `'composition'`）：

```json
{ "id": "up-xxx", "type": "scene", "url": "...", "filename": "scene-...", "productId": "p-xxx", "styleId": "daylight", "size": 123456, "createdAt": "..." }
```

## 后端改动点

| # | 改动 | 位置 | 说明 |
|---|---|---|---|
| S1 | `TWO_FISH_EDITS_URL` 改环境变量可覆盖（1 行） | server.js:48 | 默认值不变；测试可指向本地 mock |
| S2 | ensureDirs 创建 `data/scene-styles.json` 默认 5 风格 + `loadSceneStyles()`（照抄 loadPresets 模式）+ `SCENE_STYLES_FILE` 常量 | server.js:111-122 附近 | ~25 行 |
| S3 | `buildScenePrompt(product, style)` | 新函数，放 buildTryonPrompt（:704-731）旁边 | 见下方 prompt 规范 |
| S4 | `callSceneImageAI({ productBuffer, prompt })`：① twofishai edits 单图输入（复用 :536-568 的 FormData/b64/url 处理，size 1024x1024，**补 AbortSignal.timeout(90000)**）→ ② Pollinations（复用 callPollinations 的 tmpfiles 传图模式，prompt 改为"保留输入图的商品不变、生成它所处的场景"）→ ③ 都失败 throw。返回 `{ buffer, demoType }` | 新函数，放 callTryonAI 附近 | **不做** side-by-side/缓存兜底（决策 3） |
| S5 | `POST /api/admin/products/:id/scene-image`（requireAdmin，JSON body `{ styleId, force? }`） | 放 regenerate-copy（:1306-1346）之后 | 流程：找商品 404 → readProductImageBuffer 404"图片丢失" → 校验 styleId 400 → 已有同 styleId 且 !force → 400"该风格已生成过" → 单飞锁（见 S6）→ callSceneImageAI → saveImage(buffer,'compositions', `scene-${id}-${styleId}-${ts}.jpg`) → 写 uploads.json（type 'scene'）→ 更新 product.sceneImages（unshift，去重替换，cap 5）→ saveContainer → 返回 `{ sceneImage, product }`。失败 502"场景图生成失败，请再试一次" |
| S6 | 并发护栏（模块级，照 chatGuideHits 模式） | server.js 顶部常量区 | `let sceneJobRunning = false`（全局单飞，gpt-image-2 上游别并发打）+ 每商品进行中 Set；进行中再请求 → 409"有场景图正在生成，请等它完成"。finally 释放。**不做每日配额**（后台 admin 操作、非公开端点，滥用面小） |
| S7 | `DELETE /api/admin/products/:id/scene-image`（requireAdmin，body `{ styleId }`） | S5 之后 | 只从 sceneImages 数组移除条目，不删文件 |
| S8 | `GET /api/admin/scene-styles`（requireAdmin） | admin presets（:2438）旁边 | 返回 `{ styles }` 供后台页渲染按钮 |
| S9 | normalizeProduct 补 sceneImages fixImageUrl | server.js:164-174 | 1 行 |
| P1（顺手件） | 语音导购 + 聊天导购商品库行加 suitableFor/placementTip | server.js:1134-1153（buildVoiceGuideInstructions）+ src/chat-guide-agent.js 同类位置 | dev-log 反馈池 #3；字段空则不拼（旧商品兜底） |

### buildScenePrompt 规范（S3）

```
【任务】以第二段风格要求，为图中这件家具生成一张"摆在真实家庭场景里"的写实照片。
【商品】{name}，{subtitle}。必须保持商品的外观、轮廓、材质、颜色与图中完全一致。
【场景】{scene}，{style.prompt}。
【硬性要求】
1. 商品是画面主角，按真实透视与投影摆放，光照方向一致
2. 禁止修改商品的颜色/材质/图案；禁止添加品牌标志、水印、文字
3. 场景里其他陈设自然合理，符合中国家庭
4. 输出实拍照片级别，无 AI 痕迹
【输出】1024x1024 单张图。
```

兜底：product.name/subtitle 缺失时只保留通用句（不编造商品属性——沿用 v1 诚实性原则）。Pollinations prompt 用同内容的英文紧凑版（"keep the product from the input image exactly unchanged... place it in a real {scene}"）。

## 后台 UI 改动点

| # | 改动 | 文件 |
|---|---|---|
| F1 | 新页 `src/admin/scene.html?productId=xxx`："场景图工厂"——顶部商品大图 + 名称；5 个风格大按钮（已生成过的标注 ✅ 已生成）；点风格 → 按钮禁用 + 文案"AI 正在摆场景，约 15-60 秒，别关页面…"（老人友好读秒提示，参考 tryon 前端计时器）；成功 → 缩略图 + 两个操作：`⬇ 下载图片`（`<a href download>`，URL 同源走 /uploads/* 代理）+ `📋 复制发圈文案`（navigator.clipboard 写入"{商品名}，{价格}。看这个摆放效果…到店更多惊喜！门店：{address}，电话 {phone}（AI 合成场景图，仅供参考，实物以到店为准）"）；`↻ 重新生成`（force=true，confirm 二次确认）；已生成图可删除。server.js 加页面路由 `app.get('/admin/scene', ...)`（:756-768 区块） | 新文件，样式复制 admin/presets.html（两色调、字号 ≥1.05rem） |
| F2 | products.html 商品卡 actions 区加第 4 个按钮 `🖼 场景图`（onclick 跳 `/admin/scene?productId=${p.id}`）；卡片 meta 区有 sceneImages 时显示 `n 张场景图` 小标 | src/admin/products.html:126-139 |
| F3 | admin/index.html 加入口卡片："🖼 场景图工厂 · 一键把商品图变成发朋友圈的场景图" | src/admin/index.html |

## 顾客端改动点

| # | 改动 | 文件 |
|---|---|---|
| F4 | product.html 详情页"详细介绍" section 之前插入条件渲染 section：「摆进家里是什么样」——sceneImages 横向缩略图（每张 `<a href="${s.url}" target="_blank">` 点开看大图），section 底部固定小字"AI 合成场景，仅供参考"。无 sceneImages 整块不渲染 | src/product.html:91 之前 |

## 批量生成（阶段 3，改动面小但依赖阶段 2）

后端零新增——前端在 scene.html 加"按顺序补齐全部商品"入口：读 `/api/products?all=1` → 逐商品调 S5（每商品只补缺失风格）→ 进度条"第 3/34 款…"。单飞锁天然保证串行；中途失败即停并报哪款失败，老板手动重跑该款。**34 款 × 5 风格 = 170 张的量级，建议老板分批跑（spec 验收只要求单款），防上游连续失败浪费等待。**

## 非目标（v2 明确不做）

- 不做异步 job 队列/任务表（同步 + 前端计时器，见决策 2）
- 不做合成失败 demo 兜底图（决策 3）
- 不做图片水印烧录（决策 4）
- 不做多图输入 / mask 局部重绘 / upscale（#6 精修套件，v3）
- 不做自动定时批量生成（cron/队列都不引）
- 不动试摆 presets.json 及其编辑页（两套风格卡完全独立）
- 不碰阶跃图像模型（官方 2026-10-10 下线）
- 不做视频/短视频（#13）、AR（#11）、JSON-LD（#14）
- 31 张积压图入库是**运营动作不进 dev 排期**；批量扫描脚本维持 spec-v1 定性（可选加分项，v3 再议）
- 不删 MinIO 孤儿场景图文件

## v1 反馈池三件小活的判定

| 反馈池项 | 判定 | 依据 |
|---|---|---|
| #1 31 张积压图入库 | **运营 KPI，不写代码**（与营销一致）；批量扫描脚本不做 | ai-upload 已可用，dev 介入反而拖慢 |
| #4 regenerate-copy 后台按钮 | **已完成，无需开发**——dev-log-v1 反馈池 #4 信息过时，当前 src/admin/products.html:97 已有"🤖 AI 重写文案"按钮。v2 只补：①一条回归测试 ②运营动作：老板对旧 3 款各点一次补齐四件套 | 本次代码核实 |
| #3 导购接入 suitableFor/placementTip | **排进 v2 顺手件**（后端 P1，~10 行） | 一行 prompt 改动，导购话术立刻更具体 |

## 实施顺序（各阶段可独立合入）

- **阶段 1（后端，~半天）**：S1-S9 + P1。curl 全链路验证（设置 TWO_FISH_API_KEY 真跑 1 张确认画质，再决定是否调 prompt）。
- **阶段 2（后台 UI，~半天）**：F1-F3。老板可用即为价值点（v2 北极星在这里）。
- **阶段 3（顾客端 + 批量，~半天）**：F4 画廊 + 前端批量循环；可选：/admin/scene-styles 风格编辑页。

## 验收标准（checklist）

- [ ] 后台对任一在售商品点风格按钮，≤90s 拿到一张场景图，商品本体（颜色/材质/轮廓）与主图一致，无品牌标/水印/文字
- [ ] `⬇ 下载图片` 保存的文件可直接发微信；`📋 复制发圈文案` 内容含商品名/价格/门店电话，且末尾含"AI 合成场景图，仅供参考"
- [ ] 同风格重复点"生成"被拦截（400），勾选重新生成后替换原条目（sceneImages 不超 5 条）
- [ ] 生成期间再点其他商品生成 → 409 提示；商品主图 `image` 字段始终不被覆盖
- [ ] 生成失败（mock 上游 500）→ 明确 502 报错，products.json 无脏数据、uploads.json 无 type='scene' 之外的污染、试摆兜底缓存不受影响
- [ ] 顾客详情页有场景图时显示画廊 + "AI 合成场景，仅供参考"小字；无场景图的旧商品无空区块、无 JS 报错
- [ ] 未登录调 POST/DELETE scene-image → 401；不存在的商品/丢失的图 → 404
- [ ] 导购（语音 + 聊天）回答包含适合人群/摆放建议内容（旧商品不报错）
- [ ] 全部页面两色调、零新依赖；既有 61 Node + 7 Python 用例零新增红

## 给测试角色（T）的交接

1. **mock 策略**（沿用 api-v1.test.js 的双进程模式：3100 起 yxjia server、3199 起 mock）：
   - scene 链路主路径是 twofishai。spawn server 时设 `TWO_FISH_API_KEY='sk-fake'`（**显式设非空**，防 .env 真值漏进来）+ `TWO_FISH_EDITS_URL='http://127.0.0.1:3199/v1/images/edits'`（依赖 S1 改动）。mock 对该路径返回 `{ data: [{ b64_json: '<1x1 png base64>' }] }` 即走通全链路（S4 不要加最小尺寸拦截，否则 mock 图过不了）。
   - **失败路径**：mock 返回 500 时链路会滑向 Pollinations → 真网络。给 S4 加一行测试开关：`process.env.POLLINATIONS_OFF === '1'` 时跳过 Pollinations 直接 throw（1 行，只影响显式设置的测试环境）。失败用例 spawn 时带上这个环境变量，断言 502 + 无脏数据。
2. 商品图 fixture：复用 api-v1.test.js 的做法（备份/还原 products.json + 用 uploads/products/ 里已存在的真实图片；SOURCE_IMAGE 需确认存在，否则测试 setup 里先落一张）。
3. 建议用例（新建 tests/api-v2.test.js）：
   - 鉴权：无 cookie POST/DELETE scene-image → 401
   - 404：商品 id 不存在；商品 image 指向不存在文件 → 404"图片丢失"
   - 400：styleId 不在 scene-styles；同 styleId 重复且 force=false
   - 409：mock 里 sleep 模拟慢生成，期间第二个请求 → 409
   - 成功：200 → sceneImages[0] 有 url/styleId/styleName/demoType；url 是 `/uploads/compositions/...` 相对路径（fixImageUrl 生效）；products.json 落盘；uploads.json 出现 type='scene' 记录；**product.image 未变**；type!=='composition'（试摆兜底缓存不受污染）
   - force=true 重生成 → 替换不追加，createdAt 更新
   - 502：mock 500 + POLLINATIONS_OFF=1 → 502 且 products.json 无脏数据
   - GET /api/products/:id 返回 sceneImages；DELETE 后再 GET 无该条
4. Python 侧（新增 test_08）：/admin/scene 页面登录后可达且渲染风格按钮；带 sceneImages 的商品详情页打开无 JS 报错且含"AI 合成场景"字样；无 sceneImages 的商品详情页不出现画廊区块（兼容性冒烟）。
5. P1（导购字段）守护用例：mock step chat/completions 返回前断言 lastBody 的 system prompt 含 suitableFor 字段值（api-v1.test.js 的 mockAI.lastBody 现成可用）。
6. 老规矩：server.js 被 linter 动过必须重启测试进程；MinIO 未启动时 saveImage 走本地 fallback，日志 `connect ECONNREFUSED 9000` 属预期。

## 相关文件（绝对路径）

- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/server.js`
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/data/products.json`、`/Users/linan/Desktop/aicode/peilian/yxjia-mvp/data/scene-styles.json`（新建）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/admin/scene.html`（新建）、`src/admin/products.html`、`src/admin/index.html`
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/product.html`（F4 画廊）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/chat-guide-agent.js`（P1）
- `/Users/linan/Desktop/aicode/peilian/yxjia-mvp/tests/api-v2.test.js`（新建）
