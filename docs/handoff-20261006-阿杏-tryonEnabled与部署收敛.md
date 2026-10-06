# 交接文档 · 2026-10-06 阿杏 tryonEnabled 到站引导 + 部署收敛

> 分支 `feat/axing-interaction-spec` · 生产 `72.60.193.189:3300`（systemd `yxjia`）
> 本文件记「本轮做了什么、prod 现状、还卡什么、下一步」。前一版见 `docs/handoff-20261005-阿杏AI助手.md`。

## 1. 本轮上线了什么（prod 现状，md5 实证）

| 项 | 状态 | 证据 |
|---|---|---|
| 聊天出家具图（eeb52d0）+ `.ax-chat-products` 样式（c8e91e1） | ✅ 上线 | prod `chat-core.js` md5 `e1b94a19…`（**修复版**，`onTool:(n,products)` 两参、有 `appendProductCards`） |
| 竖图卡等高修复 `.p-card__img img{position:absolute}` | ✅ 上线 | `axing.css` md5 `64aa2a71…` |
| 首页改版（hero 介绍语移右栏、删四宫格） | ✅ 上线并 commit `eab904c` | 线上 `.ax-hero__intro` 在右栏 250px、`.ax-quick__tile`=0、零 pageerror |
| 试摆可见性 + anonId 查试摆历史（server.js 那条线） | ✅ 上线 | 随工作区 rsync；`axing-tryon-visible` 10 条绿 |
| **AI 试摆总开关 `tryonEnabled`（本轮新增 P0）** | ✅ 上线 | `/api/feature-flags` 实测返回 `"tryonEnabled":true`；3 个文件 md5 与本地逐一相同 |

服务 `systemctl is-active yxjia` = active，`/`、`/axing`、`/api/products` 全 200。
**回滚点**：`src/*.bak-20261006-185135`（本次 tryonEnabled 覆盖前）；更早 `src/server.js.bak-20261006-160215`、`.rollback-20261006-160211` 仍在。

## 2. `tryonEnabled` 特性（怎么用）

**动机**（handoff-20261005 §8.6 🟠2.10）：AI 整体不可用（如 twofishai key 失效，现在是这个状态）时，顾客每点一次试摆就看一次降级预览/报错——应该**全站切「到店引导」**。

**实现（3 处 + 1 测试）**：
- 后端 `server.js`：`loadFeatureFlags()` 读时**合并默认** `{tryonRequirePhone:false, tryonEnabled:true}`；`PUT /api/admin/feature-flags` 白名单加 `tryonEnabled`（老客户端不传则保留现值）。→ `/api/feature-flags` 公开暴露。
- 后台 `/admin/feature-flags`：加「🪄 AI 试摆总开关」勾选框（和「必须填手机号」并列）。
- 前端 `src/axing/js/view-tryon.js`：进页先 `fetch('/api/feature-flags')`，`tryonEnabled===false` 时把试摆页整体换成「到店引导」——`打给店里 13359140982` + `预约到店`（跳 `view-booking`）；**接口拉不到默认开着**，不因网络抖动误伤正常试摆。
- 测试 `tests/axing-tryon-enabled.test.js`（端口 3534，3 条）：后端默认暴露 / 关→到店引导无「立即生成」/ 开→正常试摆。

**用法**：AI 挂了时，店主去 `/admin/feature-flags` 把「AI 试摆」开关**关掉**，全站试摆入口立刻变成打电话/预约到店，恢复后再打开。

> ⚠️ **一个被测试抓到的真洞（重要经验）**：最初只在「首次启动写默认值」那段加 `tryonEnabled:true`，但**已部署的 `data/feature-flags.json` 早存在、没有这个键**，`loadFeatureFlags()` 读成功就不会补 → 端点不返回该键。这正是 memory ⑥「server.js 兜底会被写进 data 并永久固化」的同类。**正解是在读取侧 `{...defaults, ...raw}` 合并**，这样老文件无需改数据就自动拿到新键默认值——以后加任何 feature flag 都照这个来。

## 3. 部署收敛过程（多会话撞车教训，务必照做）

本轮 prod 一度被两个会话在 ~4 秒内各 rsync 一次、互相覆盖，还叠加 SSH 限流。最后收敛正确，但代价是几分钟的混乱。

- **纪律**：动手前 `ListAgents` + 跨会话消息报备「我要部署 / 我不再 rsync」；部署中只一个会话发车；收尾通报 md5 结果。
- **SSH**：root 免密密钥已配好（`ssh -o BatchMode=yes root@72.60.193.189` 直接通，不必 sshpass 密码）；但**连打几发仍会触发服务端 banner 限流**→ 一次调用里把「备份→rsync→重启→校验」串起来压连接数；被限流退避 ~150s 再单发。`-o` 选项要**逐个内联**，别用未加引号的 `$VAR`（zsh 不分词会整串当成单个 `-o` 报错）。
- **交付必须 md5 复核**：`rsync -a`（size+mtime）会把「大小时间同、内容不同」的文件判成没变而跳过。**唯一可靠验收 = 逐个文件比 md5**（本地 `md5 -q` vs 远端 `md5sum`），别只信「rsync OK」。

## 4. 仍卡住 / 待办

| 项 | 状态 | 缺什么 |
|---|---|---|
| **生图写真合成** | ⛔ 仍未恢复 | 生产 `.env` 的 `TWO_FISH_API_KEY` 失效（`403 GROUP_DELETED` 日志刷屏），两级兜底也瘸。需新 key 才能写真合成；key 走运行时提供、勿落文件/记忆 |
| **`data/products.json` 那行 png→jpg** | ⛔ 故意不做 | 生产在售 **26** vs 仓库 **9**（店主/AI 在生产加的商品没提交回仓库），覆盖会删光生产商品。要做只能单字段 sed 且先确认该商品在生产在售 |
| P1 429 话术改「约到店/打电话」 | 未做 | 小改，我的线 |
| P1 `/api/admin`(scenes 或 rooms) 接 DELETE | 未做 | 小后端，让「可删除」隐私承诺可执行 |
| P1 卧室示例图 `default-room-bed.jpg` | 未做 | 缺真实空卧室照片（素材） |
| 🟡2.14 商品数据填真实价格/尺寸 | 未做 | 需店主提供真实数据 |

## 5. 多会话分工（同一棵工作区树，同时 3 个会话）

- `yxjia-mvp-c4`：真实用户模拟 + Playwright CLI 找茬 + 写回归测试；**不碰** a3 线的 server.js/view-tryon/首页。
- `yxjia-mvp-9f`：首页改版（view-home/axing.css/cards.css）；已把 prod 交回。
- `yxjia-mvp-a3`（本线）：server.js / view-tryon / feature-flags / 试摆那条线 + 部署。

## 6. 下一步（建议顺序）
1. **commit 并 push** 已部署的工作区（见 `git log`）；`docs/*.pdf` 大媒体按铁律**不进仓库**（保持未跟踪）。
2. **tryonEnabled 联动**：twofish key 实在修不好前，可让店主在后台先关掉「AI 试摆」，顾客立刻走「打电话/预约到店」的干净体验（比每次降级预览好）。
3. 继续 P1：429 话术、admin DELETE rooms/scenes。
4. 拿到新 twofish key → 修生图，见 §4。
