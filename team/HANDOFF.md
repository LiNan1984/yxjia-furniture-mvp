# 交接文档 · Agent 团队迭代项目（银杏家具 MVP）

> 写于 2026-09-18 12:10 · 主控（Orchestrator）维护
> 用途：任何新会话/新接手者读完此文档 + `team/` 目录，即可无缝继续团队迭代

---

## 1. 一句话现状

**4 角色 Agent 团队（营销→产品→测试→开发）正在用 /loop 闭环迭代本项目。当前活跃迭代 = v3（2026-09-25，多品类地基 + 沙发扩容 + 卧室板块「把床搬回家」）：M/P/Q/D 四角色已全部走完，代码在工作区、经全量回归验证（Node 98过/11红、Python 35过/3红，零 v3 新回归——14 红全为 products.json 丢 8 款的历史数据坑，已用 pristine HEAD worktree 对照证明），见 `team/dev/dev-log-v3.md`。剩余为老板侧动作（见 §4）。**

## 2. 团队机制（怎么运转的）

- 驱动方式：Claude Code `/loop` 动态自节奏模式，每轮迭代 = 营销挖痛点 → 产品写 spec → 测试写用例（TDD 先行）→ 开发实现转绿 → 更新 STATE → 下一轮
- 交接载体：`team/` 目录文件（角色间不共享上下文，全靠文档交接）
- 主控职责：落盘 planner 的只读产出、督促接力、Agent 中断时接管收尾
- 规则：**不 git commit**（改动留工作区给老板审）、两色调 #3a2818/#faf6ef、无前端框架、无数据库、老人友好、零新依赖

```
team/
├── README.md            # 团队规则
├── STATE.md             # 版本状态机（先读这个）
├── marketing/insights-v{N}.md
├── spec/spec-v{N}.md
├── qa/testcases-v{N}.md
└── dev/dev-log-v{N}.md
```

## 3. 迭代账本

### v1 ✅ 已完成（商品文案/卖点自动生成，调研文档 #3）

- **交付**：后台"AI 拍照上架"页（`/admin/ai-upload`）——传商品图，AI 一次产出卖点×3/适合人群/摆放建议/尺寸，老板可改后确认上架；顾客详情页四件套展示；诚实性守护（AI 不编价格尺寸，回落"到店询价/可到店量尺"）；修复 upload-and-identify 缺失的 requireAdmin 鉴权漏洞
- **测试**：api-v1 13/13 绿 + test_07 6/6 绿；全量 61 Node 用例 47 过/14 红（14 红为预填商品缺失的历史数据问题，与迭代无关，基线一致）
- **遗留**：预填 6 款商品（sofa-1 等）数据缺失待老板决策补回；31 张积压微信图待运营逐张录入

### v2 🔨 代码完成、验证中断（AI 商品场景图生产，调研文档 #12）

- **目标**：商品主图 → 5 风格场景图（明亮/暖光/夜晚/极简/家庭），老板一键下载+复制发圈文案（解 0 曝光）；顾客详情页"摆进家里是什么样"画廊（解图不对版）；北极星指标 = 非测试用户上传 0→1
- **关键文件**：`team/spec/spec-v2.md`（蓝图，含 4 设计决策）、`team/qa/testcases-v2.md`（交接）、`tests/api-v2.test.js`（14 用例）、`tests/test_08_scene.py`（5 用例，TDD 基线 16 红/4 绿）
- **代码进度**：`data/scene-styles.json`、`src/admin/scene.html` 已建；server.js / admin 页 / 顾客端页均已改动（S1-S9+P1、F1-F4 对应 spec）
- **中断点**：开发 Agent 正在做真链路抽查——Pollinations 兜底已出图（5.9s），**停在"检查图片本体质量"这一步**，dev-log-v2 未写

### v3 ✅ 代码完成 + 验证通过（多品类地基 + 沙发扩容 + 卧室板块「把床搬回家」）

- **交付**：商品补 `category` + 新建 `data/categories.json`（板块唯一数据源，柜/桌已留地基 `enabled:false`）；首页改用 `renderSections()` 数据驱动板块循环、删 `.slice(0,6)`；品类大 tab + 「把这张沙发/床搬回家试试」按钮（页内试摆带品类上下文）；试摆 prompt 品类化（`buildTryonDefaultPrompt`，sofa 逐字零回归、bed→卧室·床）；后台商品编辑加品类下拉；**新建 `tools/ingest-new.mjs`** 串行批量入库（断点续跑、新品默认下架待审）——**正面回答"是不是又上传 skill"：无现成 skill，这就是当年欠的批量入库工具**。修 X1（登录上传文件试摆 400）/ X2（hero/兜底/后台指向已删 `sofa-zhongshi.jpg`）。
- **测试**：Node 98过/11红 + Python 35过/3红；**零 v3 相关新回归**（pristine HEAD worktree 对照，14 红全因 products.json 缩到 7 款）。api-room 3/3、api-v3 20/20、api-v2 15/15、test_09 3/3。
- **产出**：`team/dev/dev-log-v3.md`（逐项核对 spec B1-B9/F1-F6/A1-A2 + 4 处补强 + v4 候选池）。

## 4. 生产已部署（2026-09-27）+ 剩余老板动作

**已上线**：v3 代码 rsync→`72.60.193.189`（远端已备份 `server.js.bak-*`）+ `systemctl restart yxjia`；线上 `/api/categories` 出 sofa/bed、首页真站渲染无 JS 报错。**23 张图已入生产**（线上 26 款 = 3 旧 AI 沙发 + 12 床 + 11 沙发），全「下架」待审。QA 全量回归 Node 99/10 + Python 35/3，13 红 = sofa-1/table-1 未找回，23 新品零回归。

**剩余（老板侧）**：

1. **sofa-1 主推补正图**：线上/本地都缺 sofa-1；备份图路径失效、MinIO 那个仅 15KB。补正图 → 后台换图。（6 个「测试新沙发 pytest」是测试污染、table-1 图已删，均不建议恢复）
2. **已上架（2026-09-27）**：23 款已翻「在售」；线上「想摆的家具」沙发 11 新 + 卧室 12 床全部露出、裂图 0。旧「竹节皮麻沙发」丢失主图已用本地备份经 retake-image 补回生产 MinIO。
3. **可选素材**：`/images/default-room-bed.jpg` 卧室空场照（缺，已有禁用+引导兜底，不阻塞）。

## 5. v3 候选（营销 v2 洞察预判，待重新评估）

- **#1 AI 全屋搭配师**——营销标注"被货架卡死（排 v3）"，前提是先把商品数据补起来
- **#4 合成图质量自检**——等有真实用户数据后可度量
- **#14 JSON-LD 结构化**——零成本顺手项
- 补预填商品数据（解 14 条历史测试红）——需老板确认商品清单
- 运营 KPI（非开发）：31 张积压图逐张录入、旧 3 款商品点"AI 重写文案"补四件套

## 6. 已知坑（三代角色踩过的）

| 坑 | 处理 |
|---|---|
| 开发 Agent 反复被 429 打断（sonnet 子代理配额） | 等 5h 窗口重置；SendMessage 续跑不丢上下文；或主控直接接管收尾验证 |
| planner 角色只读，spec 需主控落盘 | 正常流程，不是故障 |
| linter 动过 server.js 后测试假红 | 重启测试进程/服务再跑 |
| MinIO 未启动 | 测试内 saveImage 自动回退本地，`ECONNREFUSED 9000` 日志属预期 |
| mock 1x1 png | S4 不得加图片最小尺寸拦截；POLLINATIONS_OFF=1 环境变量隔离真网络 |
| 场景图 uploads.json type 必须用 'scene' | 用 'composition' 会污染试摆兜底缓存 |
| 外部检索通道 | 内置 WebSearch/MiniMax 配额受限；DuckDuckGo html 端点时好时坏；GitHub CLI 恒可用 |

## 7. 环境速查

- 主服务 :3000（日志 /tmp/yxjia-mvp-3000.log）· 后台 /admin（admin/123456）· MinIO :9000/:9001
- 测试双进程约定：3100 被测 server + 3199 mock AI
- 项目入口文档：CLAUDE.md（项目全貌）、docs/AI能力调研.md（14 项能力路线图，选题池）

---

## 8. v3 交接（2026-09-25 · 主控追加）

- **触达**：老板新拷入 `data/new/沙发`(11) + `data/new/床`(11 + 未命名.png)，要求「沙发板块上新更多照片 + 新增卧室板块（把床搬回家）」。
- **三份 v3 文档已就绪**（本目录）：
  - `team/marketing/insights-v3.md` —— 判断瓶颈从"没能力"转为"品类结构"；核出无 category、三套类别词表、首页 `.slice(0,6)` 顶格、2 个活 bug、线上/本地脱节、无批量入库 skill。
  - `team/spec/spec-v3.md` —— **设计与安排主文档**。主线 A 品类地基（category + `data/categories.json` + 首页板块循环）；主线 B 沙发扩容 + 卧室 + 试摆通用化；配套 `tools/ingest-new.mjs` 串行入库 + 修 X1/X2。
  - `team/qa/testcases-v3.md` —— 用例清单（api-v3.test.js + test_09_bedroom.py）。
- **开发 D 接手顺序**（spec-v3"实施顺序"）：阶段 0 收尾 v2 测试水位 → 阶段 1 地基 → 阶段 2 前端板块 → 阶段 3 试摆通用化+bug → 阶段 4 入库工具+素材+入库 → 阶段 5 部署同步（主控/老板，dev 不 commit）。
- **关键硬线**：入库**严格串行**（products.json 追加非原子 server.js:2474-2501）；图像合成只 twofishai + Pollinations 兜底；零新依赖；两色调；**不 git commit**。
- **给老板 2 决策**（spec-v3）：①data/new 非商品图是否入库；②线上 3 款 vs 本地 7 款以本地为唯一事实源、覆盖前备份。
- **新踩坑记录**（待 D 补充 dev-log-v3）：①`sofa-zhongshi.jpg` 被删后 hero(370)/hero 回落(600)/商品兜底(2647)三处断链——比单个 agent 初判更广；②presets 默认值 server.js:125-128 也写死"客厅/沙发"，中性化别漏。
- **结果（2026-09-25，D 已完成并验证）**：上述全部落地 + 补 `GET /api/admin/products/:id`、卧室默认图缺失兜底、admin/scene.html 残留图；全量回归零 v3 新回归。决策①已消除（未命名.png 是干净床品图）。剩余纯老板侧动作见 §4。
