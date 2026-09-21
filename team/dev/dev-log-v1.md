# Dev Log · v1（商品文案/卖点自动生成）

> 开发角色 D · 2026-09-18 · 实现主体由开发 Agent 完成，中途两次中断（429 配额 / 流式停滞），验证收尾由主控接管完成

## 实现摘要

| 改动点 | 内容 | 位置 |
|---|---|---|
| B1 | 识别 prompt 一次产出 sellingPoints(3)/suitableFor/placementTip/size/description + 解析防御 + 诚实性兜底（编造价格→"到店询价"、无"约"尺寸→"可到店量尺"、剥离"AI 识别于"噪音） | src/server.js（identifyWithDoubao 及写入区块） |
| B2 | GET /api/products 读取时过滤 "AI 识别于" highlights（旧数据零迁移兜底） | src/server.js |
| B3 | 新端点 POST /api/admin/products/:id/regenerate-copy（requireAdmin，保留 name/price/status，图片缺失 404） | src/server.js |
| B4 | category 写入 products.json（修首页排序数据源） | src/server.js |
| 安全修复 | upload-and-identify 补挂 requireAdmin（测试角色发现的漏洞，A8/B0 用例守护） | src/server.js |
| F1 | 新页 "AI 拍照上架"：选图 → AI 生成全套文案 → 每字段可编辑 → 确认上架 | src/admin/ai-upload.html（新建） |
| F2 | admin 首页入口卡片 | src/admin/index.html |
| F3 | 商品编辑弹窗加适合人群/摆放建议/卖点输入框 | src/admin/products.html |
| F4 | 顾客详情页四件套展示（条件渲染兜底，旧商品无空区块） | src/product.html |
| F5 | 首页商品卡一行卖点 | src/index.html |

## 测试结果

| 套件 | 结果 |
|---|---|
| tests/api-v1.test.js | **13/13 绿**（含诚实性守护 A4、鉴权守护 A8/B0、regenerate-copy 成功路径 B3） |
| tests/test_07_ai_copy.py | **6/6 绿**（含旧商品详情页无 JS 报错冒烟） |
| 全量 Node 61 用例 | 47 过 / 14 红——与 v1 动工前基线**完全一致**（预填商品缺失的历史数据问题），零新增红 |

## 坑与解决

- MinIO 未启动时测试内自动回退本地存储（`connect ECONNREFUSED 9000` 日志为预期行为，不影响用例）
- 旧商品详情页"详细介绍"空区块：旧数据 description 为 "AI 识别：…" 模板句导致渲染异常，已按条件渲染兜底修复
- 两次中断：①5 小时配额 429（03:30 重置后续跑）②流式停滞 watchdog 判死；断点续跑未丢上下文

## 给产品/主控的反馈（进 v2 候选）

1. **预填 6 款商品缺失**（sofa-1 等）：14 条历史测试红的根因，也导致首页货架只有 3 条 AI 识别商品——建议 v2 或老板手动补数据
2. 31 张积压微信图现在可以走"AI 拍照上架"逐张入了，每张约半分钟；可选加分项（data/ 目录扫描脚本批量入待审）spec 未验收，未实现
3. 语音导购/全屋分析尚未接入新字段（suitableFor/placementTip），导购话术可因此更具体——v2 候选
4. regenerate-copy 对无图商品返回 404，后台列表可加"重新生成文案"按钮（本轮只做了 API）
