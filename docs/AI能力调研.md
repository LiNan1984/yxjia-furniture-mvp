# 银杏家具 MVP · 可叠加 AI 能力调研（2026-09-17）

> 调研方法：DuckDuckGo + GitHub CLI + 直接抓取（WebSearch/MiniMax/Jina 因额度与模型限制不可用）
> 基线：gpt-image-2 写真合成、step-3.7-flash 识别+全屋分析、StepAudio 2.5 语音导购（一次性+Realtime）、全屋定制 Phase 1

---

## 一、行业信号

- Salesforce 2025 黑五：AI 助手影响全球 **20%** 订单；Bluecore 分析 144 个零售品牌：站内 AI 助手使用户**转化率提升 46%**
- 床垫品牌 Puffy：AI 自动解决 **63%** 售后咨询，CSAT 90%；行业数据：AI 挽单成功率 **20–35%**（Alhena AI，2026）
- 虚拟布置已 API 化成熟（Decor8AI、Collov、SofaBrain、ModelsLab），家具/家居是渗透率最高品类之一

## 二、可叠加 AI 能力

### 🟢 第一梯队：现有模型换 prompt 即可（零新依赖）

| # | 能力 | 做法 | 落点 |
|---|------|------|------|
| 1 | AI 全屋搭配师（一图推整套） | step-3.7-flash 全屋分析 → 从 products.json 选 3-5 件组合成全屋方案 + 推荐理由 | 语音导购 / 试摆结果页 / 全屋定制延伸 |
| 2 | 对话式 AI 导购（文字多轮） | 一问一答升级为带上下文多轮 + 主动推荐 | `/api/voice/ask` 加 session |
| 3 | 商品文案/卖点自动生成 | 上传识别时顺手生成卖点 3 条、适合人群、摆放建议 | products.json 新字段，前台直出 |
| 4 | 合成图质量自检 | 出图后 LLM 自检"合成自然吗"，低分自动重跑 | 降低试摆翻车率 |
| 5 | 订单/浏览洞察小结 | LLM 每日读 orders/uploads，老板微信推摘要 | 配合 v2.1 Server酱 |

### 🟡 第二梯队：加一个 API / 小模块（1-3 天）

| # | 能力 | 参考方案 |
|---|------|----------|
| 6 | 合成图精修套件（Upscale/去杂物/换墙色/局部重绘） | Decor8AI 11 端点对标；先试 twofishai images/edits 的 mask/inpaint 自研 |
| 7 | 草图/户型图 → 3D 效果 | Decor8AI Sketch to 3D；mithunparab/virtual-staging 管线 |
| 8 | 智能挽单 | 停留久/反复重生成 → 主动弹对话（复用导购问答，纯前端检测） |
| 9 | 老板微信 AI 值班客服 | 新订单/试摆 AI 摘要推送 + 代拟回复 |
| 10 | 店内数字店员 | StepAudio 2.5 Realtime（首包 0.7s）+ 欢迎语 + 转人工规则，平板即 AI 导购台 |

### 🔴 第三梯队：战略级（v2-v3）

| # | 能力 | 说明 |
|---|------|------|
| 11 | AR 实景摆放（WebXR/小程序 AR） | 1:1 尺寸感知，打掉"沙发塞不塞得下"顾虑 |
| 12 | AI 商品场景图生产 | 白底图 → 5 风格场景图，供小红书/朋友圈 |
| 13 | 短视频口播生成 | 数字人 15s 口播，视频号/抖音本地号 |
| 14 | Agentic Commerce / AEO | products.json 补 JSON-LD product schema、结构化 feed；零成本先埋 |

## 三、建议优先级

1. **#3 商品文案生成 + #4 合成图自检**（纯 prompt 工程，几天见效）
2. **#1 全屋搭配师 + #8 挽单**（全屋定制 Phase 1 收口）
3. **#10 店内 AI 导购台**（线下差异化）
4. #14 顺手埋结构化数据；#6 先自研，不通再接 Decor8AI 类 API

## 四、来源

- [TMO Group · 2026年电商AI导购](https://www.tmogroup.com.cn/insights/ai-shopping-assistant/)（数据点出处，全文已读）
- [TMO Group · 2026电商AI客服](https://www.tmogroup.com.cn/insights/ai-customer-service-ecommerce/)
- [Decor8AI API 文档](https://api-docs.decor8.ai/)
- GitHub：LarryWalkerDEV/mcp-immostage · mithunparab/virtual-staging · zqq25/ai-shopping-assistant · 知乎《1688 Ai导购探索》
