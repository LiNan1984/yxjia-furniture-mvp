# PRD：Furniture AI Operating System（家具行业 AI 数字化操作系统）

| 项目 | 内容 |
|---|---|
| 版本 | V1.0 |
| 日期 | 2026-10-01 |
| 作者 | 林安 |
| 状态 | 草案 |

---

## 0. 方向重述

你实际上不是在做一个「家具 AI 试摆 App」，那只是**用户侧入口**。

更大的机会是：

> **传统家具行业 AI Native（AI 原生）数字化操作系统。**
>
> 前端：AI 空间设计师（面向消费者）
> 后端：家具门店 AI Agent ERP（面向商家）

核心壁垒不是 3D，也不是 GPT Image，而是：

**把传统家具店几十年的线下资产（图片、微信聊天、纸质单据、库存、经验、报价方式）转化成 AI 可理解、可运营的数据资产。**

---

# 一、背景与痛点

## 1. 行业现状

大量传统家具门店：

- **商品数量**：几百 ~ 几千 SKU
- **商品资料**：
  - 纸质目录
  - 微信图片
  - 供应商报价单
  - 老板脑中的经验

它们**没有**：

- 商品数据库
- 库存系统
- CRM
- 销售分析
- 用户画像
- 智能推荐

## 2. 核心经营问题

### 商品问题

老板知道：

> 「这个床是去年那个厂家来的。」

但系统不知道：

```text
床 A
  供应商：XXX家具厂
  采购价：3800
  销售价格：5500 - 6500
  销售次数：不知道
  库存：不知道
  客户喜欢程度：不知道
```

### 销售问题

传统模式：

| 角色 | 台词 |
|---|---|
| 客户 | 这个多少钱？ |
| 老板 | 6800。 |
| 客户 | 便宜一点。 |
| 老板 | 最低 6200。 |

结果是**价格不透明**，并带来四个问题：

1. 销售依赖老板经验
2. 新员工无法快速成长
3. 毛利无法控制
4. 无法规模化复制

### 客户问题

消费者不知道：

- 为什么实木贵？
- 为什么这个床垫值得买？
- 为什么这个设计适合我的家？

最终演变成一句话：**比价格。**

---

# 二、产品愿景

## Vision

打造 **AI Furniture Store（AI 家具门店）**，让一家传统家具店拥有：

- 一个 AI 店长
- 一个 AI 销售
- 一个 AI 设计师
- 一个 AI 仓库管理员
- 一个 AI 数据分析师

---

# 三、产品整体架构

```text
                    用户
                     |
              AI 家居设计师
                     |
          ---------------------
          |                   |
      家庭空间 AI         商品推荐 AI


                     商家
                     |
              AI Furniture OS
                     |
          ---------------------
          |        |        |        |        |
      商品资产  库存    销售    财务    供应链  数据分析
        Agent   Agent  Agent   Agent   Agent   Agent
```

---

# 四、核心模块设计

## Module 1：商品数字化 Agent

### 目标

把传统家具店所有商品变成 AI 能理解的资产。

### 输入来源

**图片**
- 微信图片
- 手机拍照
- 供应商图片

**文档**
- 纸质单据
- Excel
- PDF
- 合同

**对话**（微信聊天）

```text
老板：这个床去年进了 20 张
厂家：这个价格最低 3800
```

### AI Pipeline

```text
图片
 |
视觉模型
 |
商品识别
 |
OCR
 |
信息抽取
 |
商品知识库
 |
Furniture Asset
```

产出的 Asset 结构：

```json
{
  "name": "橡木双人床",
  "category": "床",
  "material": "北美橡木",
  "purchase_price": 3800,
  "recommended_price": 5800,
  "inventory": 12,
  "supplier": "XX家具厂",
  "style": "现代简约"
}
```

---

## Module 2：家具 3D Asset Agent

### 目标

一张照片快速生成数字家具。

### 流程

```text
手机拍照
   ↓
AI 抠图
   ↓
商品理解
   ↓
3D 生成
   ↓
GLB
   ↓
进入空间设计
```

### 技术选型

**图片理解**
- GPT Vision
- Segment Anything
- Grounding DINO

**图片增强**（GPT Image 2.5）
- 去背景
- 补全遮挡
- 商品白底图
- 场景效果图

**3D**（Hyper3D Rodin）
- 用途：Image → 3D Asset
- 输出：`bed.glb` / `chair.glb` / `cabinet.glb`

---

## Module 3：AI 空间设计 Agent（消费者入口）

### 输入

用户上传：

```text
我的客厅照片
```

或用 iPhone 扫描：

```text
RoomPlan + LiDAR
```

### 生成

```text
Room Scene
  墙
  地面
  家具
  空间尺寸
```

### 交互示例

用户：

> 「帮我换一个沙发。」

Agent 理解：

```text
Intent:     Replace Sofa
Constraint: 保持空间风格
Budget:     5000
Style:      现代
```

调用链：

```text
商品库 Agent
   ↓
匹配家具
   ↓
3D Scene
   ↓
实时展示
```

---

## Module 4：AI 销售 Agent

这是商业价值最大的模块。

### 传统 vs 未来

| | 传统 | AI |
|---|---|---|
| 客户提问 | 这个床多少钱？ | 这个床有什么区别？ |
| 回答 | 6500。 | 这款采用橡木结构，稳定性比普通密度板更高，适合湿度较高地区；床头软包设计更适合长期阅读。 |

### AI 自动生成

- 产品故事
- 材质解释
- 对比分析
- 推荐理由

---

## Module 5：动态定价 Agent

传统家具最大的问题是**非标价格**。

不建议直接强制一口价——家具行业客单价高，用户心理上存在议价需求。更合理的方案是 **AI Price Engine（智能价格引擎）**。

### 公式

```text
销售价格 = 采购成本 + 物流成本 + 运营成本 + 目标利润率 + 市场调整系数
```

### 算例

```text
采购：   4000
目标毛利：40%
基础价： 4000 / (1 - 40%) = 6666
```

AI 建议三档：

| 档位 | 价格 |
|---|---|
| 标准价 | 6699 |
| 活动价 | 6299 |
| 最低保护价 | 5999 |

### 销售权限

| 角色 | 权限 |
|---|---|
| 普通员工 | 不能低于 6299 |
| 店长 | 可以调到 5999 |
| 老板 | 自由调整 |

解决的三个问题：

- 价格混乱
- 新员工不会卖
- 老板经验无法复制

---

## Module 6：库存 Agent

自动统计：

```text
商品 → 销售次数 → 库存周期 → 资金占用
```

输出示例：

```text
某款床
  库存：8 个月
  销售：过去半年 0 次
  建议：降低价格，或停止采购
```

---

# 五、完整用户闭环

## 消费者侧

```text
进入家具店
   ↓
AI 识别商品
   ↓
扫码 / 拍照
   ↓
看到 3D 家具
   ↓
上传自己家照片
   ↓
AI 试摆
   ↓
语音咨询
   ↓
生成购买方案
   ↓
成交
```

## 商家侧

```text
商品拍照
   ↓
自动生成商品档案
   ↓
自动进入库存
   ↓
自动生成销售话术
   ↓
自动推荐客户
   ↓
自动分析利润
```

---

# 六、核心技术架构

```text
                 AI Agent Runtime
                        |
 -------------------------------------------------
 |          |            |             |
商品Agent  空间Agent   销售Agent   库存Agent
 |          |            |             |
Vision    RoomPlan     LLM        Database
 |          |
GPT Image  Rodin
 |
Scene Graph
 |
Three.js / RealityKit
```

---

# 七、Skill Pool（技能池）

## Vision Skill

| Skill | 作用 |
|---|---|
| OCR Skill | 票据识别 |
| Product Recognition | 商品识别 |
| SAM Segmentation | 商品抠图 |
| Image Enhancement | 图片增强 |

## Knowledge Skill

| Skill | 作用 |
|---|---|
| Product KB Skill | 商品知识库 |
| Supplier Skill | 供应商管理 |
| Price Skill | 价格规则 |
| Inventory Skill | 库存分析 |

## Spatial Skill

| Skill | 作用 |
|---|---|
| RoomPlan Skill | 房间扫描 |
| Depth Skill | 深度估计 |
| Rodin Skill | 图片转 3D |
| Three.js Skill | 3D 渲染 |

## Agent Skill

| Skill | 作用 |
|---|---|
| Sales Agent | 销售 |
| Designer Agent | 设计 |
| Inventory Agent | 库存 |
| Operation Agent | 运营 |

---

# 八、PPT 路线规划

## Slide 1 · 从传统家具店到 AI 原生家具空间

视觉对比：

- 左：传统店 —— 纸质单据、微信聊天、库存混乱
- 右：AI Store —— 3D 空间、智能销售、数字资产

## Slide 2 · 行业痛点

```text
纸质订单 / 微信图片 / 老板经验 / 库存未知 / 价格混乱
                    ↓
                AI 转化
```

## Slide 3 · 产品全景架构

```text
AI Furniture OS
  消费者端  +  商家端  +  Agent Runtime
```

## Slide 4 · 消费者体验 Demo

```text
手机
语音：「换一个奶油风沙发」
        ↓
    3D 客厅变化
```

## Slide 5 · 商家数字化流程

```text
拍照片 → AI 商品档案 → 库存 → 销售 → 利润
```

## Slide 6 · AI Agent 集群

```text
AI 店长 / AI 销售 / AI 设计师 / AI 库存管理员
```

## Slide 7 · 技术架构

```text
GPT Image / Rodin / RoomPlan / Three.js / Realtime Voice / Agent Runtime
```

## Slide 8 · 未来商业模式

**SaaS 门店订阅**：999/月 · 1999/月 · 4999/月

**增值服务**：
- AI 设计服务
- 3D 资产生成
- 电商连接
- 数据分析

---

# 九、开发排期

## Phase 1（0–3 个月）· AI 家具数字化助手

- 图片商品录入
- OCR
- 商品知识库
- AI 销售

## Phase 2（3–6 个月）· AI 空间设计

- RoomPlan
- 3D 家具
- AI 试摆
- GPT Image

## Phase 3（6–12 个月）· AI Furniture OS

- 库存预测
- 动态定价
- 供应链
- 多店管理

---

# 最终定位

不要把它定位成：

> 家具 AI 试摆工具

应该定位成：

# **Furniture Intelligence Platform（家具智能平台）**

底层逻辑：

> 把传统家具行业从「老板经验驱动」，升级到「数据 + Agent 驱动」。

真正的护城河不是生成一个沙发 3D，而是：

**把一家传统家具店过去 20 年积累的隐性经验、商品、价格、客户沟通，全部转化成 AI 可调用资产。**

3D 是消费者入口，Agent 是商业核心。
