# 交接文档 · Agent 团队迭代项目（银杏家具 MVP）

> 写于 2026-09-18 12:10 · 主控（Orchestrator）维护
> 用途：任何新会话/新接手者读完此文档 + `team/` 目录，即可无缝继续团队迭代

---

## 1. 一句话现状

**4 角色 Agent 团队（营销→产品→测试→开发）正在用 /loop 闭环迭代本项目：v1 已交付转绿，v2 代码已写完、卡在收尾验证（开发 Agent 被 429 配额打断，15:21 重置）。**

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

## 4. 接手者下一步（按序）

1. **跑测试确认现状**（不动代码先看真实水位）：
   ```bash
   ./node_modules/.bin/playwright test tests/api-v2.test.js   # 目标 14/14
   source .venv/bin/activate && python3 -m pytest tests/test_08_scene.py -v   # 目标 5/5
   ./node_modules/.bin/playwright test tests/                  # 回归：47 过/14 红基线，零新增红
   ```
2. **真链路抽查**：`curl` 调 `POST /api/admin/products/:id/scene-image`（admin 登录拿 cookie，见 CLAUDE.md §14），确认图片商品本体不变形、无水印文字；画质不行就调 `buildScenePrompt`
3. **写 `team/dev/dev-log-v2.md`**（模板照 dev-log-v1.md：实现摘要/测试数字/坑/给产品反馈）
4. **更新 `team/STATE.md` → v2 完成**，然后启动 v3：营销角色读 STATE + dev-log-v2 反馈池重新进场
5. 若原开发 Agent 可续（SendMessage 带上下文续跑优先）；否则新开开发 Agent，喂 spec-v2 + testcases-v2 + 本文档

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
