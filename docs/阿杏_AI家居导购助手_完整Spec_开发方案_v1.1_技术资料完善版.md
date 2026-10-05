# 阿杏 AI 家居导购助手

## Furniture AI Agent · Product & Technical Specification v1.0

> 产品定位：**"我是提前把家具搬到你家的 AI 助手，阿杏～"**
>
> 核心体验：用户通过**语音 + 手机照片 + AI 试摆 + 3D/AR +
> 智能导购**，在真正到店前完成"看、问、试、选、搭、约、买"的闭环。
>
> 商业目标：以"AI
> 在线试摆"为消费者入口，同时把传统家具店的商品、库存、价格、销售经验、纸质单据和微信沟通逐步数字化，形成
> **AI Furniture OS（家具智能经营系统）**。

------------------------------------------------------------------------

# 1. Executive Summary

## 1.1 一句话定义

**阿杏 = 一个会聊天、懂家具、能把家具提前搬进用户家的 AI 家居导购。**

用户不需要理解 SKU、参数、材质和 3D。

用户只需要：

> "阿杏，我想换个 3000～5000 的布艺沙发，放我家客厅看看。"

阿杏完成：

``` text
语音理解
  ↓
商品检索
  ↓
推荐候选
  ↓
用户上传客厅照片
  ↓
AI 试摆
  ↓
尺寸 / 风格 / 材质解释
  ↓
3D / AR 查看
  ↓
保存方案
  ↓
预约到店
  ↓
成交
```

------------------------------------------------------------------------

# 2. Product Vision

## 2.1 Vision

把传统家具消费从：

> "到店 → 看样品 → 靠想象 → 讨价还价 → 回家测量 → 再决定"

升级为：

> "在家 → 说一句话 → 上传照片 → 家具先搬进来 → AI 帮你比较 → 到店体验 →
> 成交"

------------------------------------------------------------------------

## 2.2 长期形态

最终产品不是一个"AI 图片生成器"，而是：

``` text
                    阿杏 AI
                       │
        ┌──────────────┼──────────────┐
        │              │              │
     导购 Agent      空间 Agent      商家 Agent
        │              │              │
     商品知识        Room Scene       商品资产
     价格策略        3D Asset         库存
     销售话术        AR/试摆          订单
     材质解释        全屋搭配          经营分析
```

------------------------------------------------------------------------

# 3. Target Users

## 3.1 消费者

### A. 普通家庭用户

需求：

-   换沙发
-   换床
-   换电视柜
-   全屋搭配
-   看家具尺寸
-   比较不同材质

### B. 中老年用户

核心特点：

-   不喜欢打字
-   更习惯说话
-   对复杂 App 不耐受
-   更信任线下门店

因此：

**语音不是附加功能，而是一级交互。**

### C. 年轻用户

核心需求：

-   拍照试摆
-   风格匹配
-   3D
-   AR
-   分享方案

------------------------------------------------------------------------

# 4. Core Product Experience

## 4.1 首页

视觉原则：

-   iPhone 原生感
-   奶油白 / 暖棕 / 杏色
-   大字号
-   大按钮
-   圆角卡片
-   阿杏女孩头像
-   强调"拍照"和"语音"

首页核心文案：

> **你好，我是阿杏～**
>
> **我是提前把家具搬到你家的 AI 助手。**

核心入口：

``` text
[ 拍照试摆 ]

[ 语音导购 ]

[ 浏览家具 ]

[ 全屋搭配 ]
```

------------------------------------------------------------------------

# 5. 8 个核心页面

## Page 01：首页 · AI 家居导购

目标：

让用户 3 秒理解产品。

核心 CTA：

-   拍照试摆
-   按住说话
-   浏览商品
-   我的方案

阿杏头像固定出现。

------------------------------------------------------------------------

## Page 02：语音对话 · AI 导购

用户：

> "我想买一个三四千的布艺沙发，家里是奶油风。"

阿杏：

> "好的，我先从店里的现货里帮你找。你可以拍一张客厅照片，我直接帮你搬进去看看。"

要求：

-   Streaming Voice
-   ASR 实时识别
-   LLM Streaming
-   TTS 流式播放
-   对话过程中可以继续操作卡片

核心原则：

**语音是主交互，文字是辅助。**

------------------------------------------------------------------------

## Page 03：上传家庭照片

支持：

-   拍照
-   相册
-   最近使用
-   示例房间

提示：

> "拍一张完整的客厅，尽量把地面和墙面拍进去，这样试摆会更准确。"

后续可支持：

-   多张照片
-   视频
-   LiDAR Room Scan

------------------------------------------------------------------------

## Page 04：选择家具

支持筛选：

``` text
全部
布艺
真皮
实木
现代
奶油
北欧
新中式
价格
尺寸
```

每张卡片：

``` text
商品图片
商品名
价格
材质
尺寸
库存状态
```

价格必须来自真实商品数据。

------------------------------------------------------------------------

## Page 05：AI 试摆

核心体验：

``` text
用户房间照片
        +
家具商品资产
        ↓
AI Scene Composition
        ↓
试摆结果
```

操作：

-   换家具
-   改尺寸
-   换颜色
-   换材质
-   删除
-   对比
-   保存

必须支持：

> "这个不太好看，换刚才第二个。"

------------------------------------------------------------------------

# 6. Page 06：3D 家具模型

支持：

-   360°旋转
-   缩放
-   换颜色
-   换材质
-   查看尺寸
-   查看材质
-   AR 实景

3D 模型格式：

**GLB / glTF**

前端 Web：

**Three.js**

iOS：

**RealityKit / ARKit**

------------------------------------------------------------------------

# 7. Page 07：材质科普

目标：

解决传统家具销售中：

> "为什么这个贵？"

例如：

### 实木

-   材质
-   木种
-   纹理
-   稳定性
-   使用寿命
-   保养方式

### 密度板

-   价格
-   工艺
-   防潮性
-   使用场景

阿杏不是单纯说"实木更好"。

而应该根据：

``` text
预算
家庭成员
使用场景
湿度
儿童
老人
宠物
```

给出适合性解释。

------------------------------------------------------------------------

# 8. Page 08：到店预约 / 购买

最终 CTA：

``` text
保存方案

分享方案

预约到店

加入购物车

在线咨询
```

预约卡片：

``` text
银杏家具体验店

营业时间
地址
联系电话

预约日期
预约时间

到店体验商品：
- 沙发 A
- 茶几 B
- 电视柜 C
```

用户到店后：

> "阿杏已经帮你把方案准备好了。"

销售直接看到：

``` text
用户需求
预算
喜欢商品
试摆结果
沟通记录
方案
```

------------------------------------------------------------------------

# 9. "把家具搬回家"核心技术路线

这是整个产品的核心体验。

## 9.1 推荐采用双引擎

### Engine A：2D AI 试摆

适合：

-   快速生成
-   营销
-   普通用户
-   网页端
-   低成本

``` text
Room Image
+
Furniture Image
+
Scene Instruction
        ↓
Image Generation / Editing
        ↓
Realistic Room Image
```

优点：

-   快
-   真实感高
-   开发简单

缺点：

-   尺寸不是严格物理真实
-   物体空间关系不可完全约束

------------------------------------------------------------------------

## 9.2 Engine B：3D Scene

适合：

-   精确尺寸
-   旋转
-   换材质
-   多家具组合
-   AR
-   长期资产沉淀

``` text
Furniture Photo
      ↓
Segmentation
      ↓
Image → 3D
      ↓
GLB
      ↓
Three.js Scene
```

------------------------------------------------------------------------

# 10. Three.js 是否适合阿杏？

## 结论：非常适合 Web 前端。

但：

> **不要让 Three.js 承担所有事情。**

推荐：

``` text
                    阿杏前端
                       │
        ┌──────────────┴──────────────┐
        │                             │
     2D体验                         3D体验
        │                             │
  Image Generation                 Three.js
        │                             │
  试摆效果图                      GLB / glTF
                                      │
                                  Scene Graph
```

------------------------------------------------------------------------

# 11. Three.js 技术职责

Three.js 负责：

-   3D Scene
-   Camera
-   Light
-   GLB Loader
-   材质
-   旋转
-   缩放
-   拖拽
-   家具摆放
-   Bounding Box
-   尺寸标注
-   截图
-   WebAR 的部分 Web 体验

建议技术栈：

``` text
React
TypeScript
Next.js
Three.js
@react-three/fiber
@react-three/drei
GLTFLoader
```

推荐使用：

**React Three Fiber**

而不是直接手写大量 Three.js imperative code。

------------------------------------------------------------------------

# 12. Three.js Scene 数据结构

建议建立自己的 Scene Schema。

``` typescript
interface FurnitureScene {
  roomId: string;

  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };

  objects: FurnitureObject[];
}

interface FurnitureObject {
  id: string;
  productId: string;
  assetUrl: string;

  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };

  dimensions: {
    width: number;
    depth: number;
    height: number;
  };
}
```

这样未来可以：

``` text
保存方案
↓
数据库 / JSON
↓
重新打开
↓
恢复完整房间
```

------------------------------------------------------------------------

# 13. iPhone 原生 App 技术路线

如果最终做 App，推荐：

## iOS

``` text
SwiftUI
+
ARKit
+
RoomPlan
+
RealityKit
```

### RoomPlan

用于：

-   房间扫描
-   墙体
-   地面
-   门
-   窗
-   家具
-   尺寸

输出房间结构。

------------------------------------------------------------------------

# 14. Web 与 App 的分工

  能力             Web   iOS App
  ------------- ------ ---------
  语音聊天           ✓         ✓
  上传照片           ✓         ✓
  AI 试摆            ✓         ✓
  商品浏览           ✓         ✓
  Three.js 3D        ✓         ✓
  RoomPlan          \-         ✓
  LiDAR             \-         ✓
  AR              部分        ✓✓
  深度数据        有限         ✓
  本地算力        有限         ✓
  推送               ✓         ✓
  相机体验        一般        ✓✓

因此：

**Web = 获客 / 轻量体验**

**App = 深度体验 / AR / 房间数字孪生**

------------------------------------------------------------------------

# 15. AI 模型层

## 15.1 Vision

负责：

-   商品识别
-   OCR
-   材质识别
-   房间理解
-   家具检测
-   图片分类

------------------------------------------------------------------------

## 15.2 Image Generation

负责：

-   AI 试摆
-   商品图增强
-   背景替换
-   场景生成
-   营销图

原则：

**图片生成负责"视觉表现"，不要负责真实商品数据。**

------------------------------------------------------------------------

# 16. 3D Asset Pipeline

``` text
商品照片
   ↓
Image Quality Check
   ↓
Background Removal
   ↓
Object Segmentation
   ↓
Image → 3D
   ↓
Mesh Optimization
   ↓
Texture Optimization
   ↓
GLB
   ↓
Asset QA
   ↓
Asset Registry
```

------------------------------------------------------------------------

# 17. Hyper3D Rodin 的定位

Rodin 不应该直接暴露给用户。

它是：

> **Furniture Asset Generation Service**

例如：

``` text
用户 / 店主：
拍一张沙发

↓

Asset Agent

↓

Rodin

↓

GLB

↓

自动检查

↓

进入商品资产库
```

商品一旦生成 GLB，以后重复使用。

这比每次生成 3D 更重要。

------------------------------------------------------------------------

# 18. Asset Registry

每件家具应该拥有：

``` text
Product ID

Product Image

Product Mask

3D Asset

GLB URL

Dimensions

Material

Color

Style

Purchase Price

Sale Price

Inventory

Supplier
```

形成：

# Digital Furniture Asset

------------------------------------------------------------------------

# 19. Agent Architecture

推荐：

``` text
                    阿杏 Agent
                        │
                 Intent Router
                        │
       ┌────────────────┼────────────────┐
       │                │                │
   Product Agent    Scene Agent      Store Agent
       │                │                │
   商品搜索          房间理解          库存
   价格              试摆              价格
   材质              3D                订单
   推荐              AR                预约
```

------------------------------------------------------------------------

# 20. Agent Tools

核心 Tool：

``` text
search_products()

get_product()

get_inventory()

get_price()

get_material_info()

analyze_room()

generate_tryon()

generate_3d_asset()

create_scene()

update_scene()

compare_products()

save_design()

book_store_visit()

create_order()
```

------------------------------------------------------------------------

# 21. Context Engineering

阿杏不应该把所有商品塞进 Context。

采用：

``` text
用户意图
  ↓
商品检索
  ↓
Top-K
  ↓
商品详情
  ↓
价格规则
  ↓
库存
  ↓
LLM
```

核心原则：

> **LLM 不负责记商品，LLM 负责调用商品系统。**

------------------------------------------------------------------------

# 22. 商品数据模型

``` typescript
interface Product {
  id: string;

  name: string;
  category: string;

  material?: string;
  color?: string;
  style?: string;

  dimensions?: {
    width: number;
    depth: number;
    height: number;
  };

  purchasePrice: number;

  pricing: {
    retailPrice: number;
    minimumPrice?: number;
  };

  inventory: number;

  images: string[];

  asset3d?: {
    glbUrl: string;
    status: "pending" | "ready" | "failed";
  };

  supplier?: string;
}
```

------------------------------------------------------------------------

# 23. 商家数字化入口

老板不需要后台 ERP 专业知识。

只需要：

> **"拍张照片，上新。"**

流程：

``` text
拍商品
 ↓
AI识别
 ↓
自动填写
 ↓
老板确认
 ↓
商品上线
```

AI 输出固定结构：

``` text
品类
材质
颜色
风格
商品名称
建议价格
尺寸
销售话术
```

------------------------------------------------------------------------

# 24. 传统纸质单据数字化

Pipeline：

``` text
纸质单据
 ↓
OCR
 ↓
Document Parsing
 ↓
字段抽取
 ↓
Product / Supplier / Order
 ↓
结构化数据
```

例如：

``` text
2026-09-12

橡木床
数量：3
采购价：3800
供应商：XX
```

转成：

``` json
{
  "productId": "...",
  "quantity": 3,
  "purchasePrice": 3800,
  "supplier": "XX"
}
```

------------------------------------------------------------------------

# 25. 微信数据数字化

长期方向：

``` text
微信图片
微信聊天
报价
采购沟通
客户咨询
```

转换：

``` text
Customer
Product
Supplier
Price
Order
Intent
```

但必须遵守：

-   用户授权
-   合规采集
-   最小化保存
-   权限控制

------------------------------------------------------------------------

# 26. 定价系统

不要简单：

> 成本 × 固定百分比。

建议：

``` text
Base Price
=
Purchase Cost
+
Logistics
+
Operating Cost
+
Target Margin
```

再加入：

``` text
库存周转
销售速度
季节性
市场价格
促销
客户类型
```

输出：

``` text
标准价：6699

推荐成交价：6299

最低保护价：5999
```

------------------------------------------------------------------------

# 27. 推荐系统

用户画像：

``` text
预算
房间面积
风格
颜色
家庭成员
宠物
儿童
偏好
历史浏览
试摆历史
```

推荐：

``` text
Candidate Retrieval
        ↓
Rule Filter
        ↓
LLM Reasoning
        ↓
Ranking
        ↓
推荐卡片
```

------------------------------------------------------------------------

# 28. 全屋搭配

用户：

> "我想把客厅重新弄一下。"

阿杏：

``` text
分析房间
 ↓
识别已有家具
 ↓
确定风格
 ↓
生成候选方案
 ↓
沙发
茶几
电视柜
地毯
灯
装饰
 ↓
生成完整 Scene
```

输出：

> "方案 A：奶油现代"

------------------------------------------------------------------------

# 29. Voice UX

推荐架构：

``` text
Microphone
   ↓
Realtime ASR
   ↓
Voice Agent
   ↓
Tool Calling
   ↓
LLM
   ↓
Streaming TTS
```

同时保留：

``` text
语音
文字
卡片
按钮
```

这叫：

# Multimodal Agent UI

用户可以：

> 说话 + 点卡片 + 拖动家具 + 上传照片

而不是单纯聊天机器人。

------------------------------------------------------------------------

# 30. 最关键的交互原则

## 不要做成 ChatGPT + 家具。

而要做成：

# Spatial Agent（空间智能体）

用户说：

> "换一个。"

阿杏直接操作 Scene。

用户说：

> "这个太大。"

阿杏：

``` text
识别：
尺寸问题

Tool：
replace_product()

Constraint：
width < 2.6m
```

然后直接换。

------------------------------------------------------------------------

# 31. Backend Architecture

推荐：

``` text
                    API Gateway
                         │
                  Agent Runtime
                         │
        ┌────────────────┼────────────────┐
        │                │                │
    Product API      Scene API        User API
        │                │                │
   Product DB       Scene Store       User DB
        │
    Asset Store
        │
   Image / GLB
```

------------------------------------------------------------------------

# 32. Storage

MVP 可以非常轻。

## Object Storage

保存：

-   商品图片
-   用户房间图片
-   AI 试摆图片
-   GLB
-   Scene snapshot

## Structured Data

MVP：

``` text
SQLite / PostgreSQL
```

不要为了"无数据库"而牺牲扩展性。

真正重要的是：

> **让数据库复杂度对用户不可见。**

------------------------------------------------------------------------

# 33. API

## Product

``` http
GET /products
GET /products/:id
POST /products
PATCH /products/:id
```

## Scene

``` http
POST /scenes
GET /scenes/:id
PATCH /scenes/:id
POST /scenes/:id/objects
DELETE /scenes/:id/objects/:objectId
```

## AI

``` http
POST /ai/chat
POST /ai/try-on
POST /ai/generate-3d
POST /ai/analyze-room
```

## Booking

``` http
POST /appointments
GET /appointments/:id
```

------------------------------------------------------------------------

# 34. Event Model

推荐所有核心操作产生事件：

``` text
USER_SPEAK
PHOTO_UPLOADED
PRODUCT_SELECTED
TRYON_STARTED
TRYON_COMPLETED
SCENE_UPDATED
PRODUCT_REPLACED
DESIGN_SAVED
BOOKING_CREATED
ORDER_CREATED
```

未来可以直接做：

-   Funnel Analysis
-   Recommendation
-   Agent Evaluation
-   商业分析

------------------------------------------------------------------------

# 35. 前端目录

``` text
src/
├── app/
├── components/
│   ├── chat/
│   ├── voice/
│   ├── product/
│   ├── scene/
│   ├── furniture/
│   └── booking/
│
├── three/
│   ├── Scene.tsx
│   ├── Furniture.tsx
│   ├── Camera.tsx
│   ├── Lighting.tsx
│   └── Controls.tsx
│
├── agents/
│   ├── productAgent.ts
│   ├── sceneAgent.ts
│   └── salesAgent.ts
│
├── api/
├── store/
└── types/
```

------------------------------------------------------------------------

# 36. 推荐前端 Stack

``` text
Next.js
React
TypeScript

Tailwind CSS
shadcn/ui

React Three Fiber
Three.js
Drei

Zustand
TanStack Query

WebSocket / SSE
```

------------------------------------------------------------------------

# 37. Mobile Stack

## MVP

React Native / Expo 也可以快速验证。

## 深度 AR 版本

建议：

``` text
SwiftUI
ARKit
RoomPlan
RealityKit
```

因为你真正要利用：

-   LiDAR
-   Depth
-   AR
-   Room Capture

原生能力。

------------------------------------------------------------------------

# 38. 推荐最终架构

``` text
                  iPhone App
                      │
        ┌─────────────┼─────────────┐
        │             │             │
      Voice         Camera        LiDAR
        │             │             │
        └─────────────┼─────────────┘
                      ↓
                 阿杏 Agent
                      │
       ┌──────────────┼──────────────┐
       │              │              │
 Product Agent    Scene Agent    Sales Agent
       │              │              │
       ↓              ↓              ↓
 Product DB      Scene Store      CRM/Order
       │
 Asset Registry
       │
 ┌─────┴─────┐
 │           │
Image AI    3D AI
 │           │
试摆        Rodin
             │
            GLB
             │
        Three.js / RealityKit
```

------------------------------------------------------------------------

# 39. MVP Scope

## P0：必须做

### 消费者

-   [x] 首页
-   [x] AI 语音
-   [x] 上传照片
-   [x] 商品浏览
-   [x] AI 试摆
-   [x] 保存方案
-   [x] 到店预约

### 商家

-   [x] 商品图片上传
-   [x] AI 商品识别
-   [x] 商品字段自动生成
-   [x] 商品价格
-   [x] 库存

------------------------------------------------------------------------

# 40. P1

-   3D 家具
-   Three.js Scene
-   360°
-   换材质
-   换颜色
-   尺寸测量
-   全屋搭配
-   分享方案

------------------------------------------------------------------------

# 41. P2

-   iOS App
-   RoomPlan
-   LiDAR
-   RealityKit AR
-   多房间
-   空间数字孪生

------------------------------------------------------------------------

# 42. P3

-   AI 店长
-   自动库存预测
-   动态定价
-   供应商管理
-   微信历史数据结构化
-   纸质票据数字化
-   多门店

------------------------------------------------------------------------

# 43. 开发排期

## Week 1

基础工程：

``` text
Next.js
React
TypeScript
UI Design System
Agent API
Product Schema
```

------------------------------------------------------------------------

## Week 2

消费者：

``` text
首页
商品列表
商品详情
上传照片
```

------------------------------------------------------------------------

## Week 3

Voice Agent：

``` text
ASR
LLM
Tool Calling
TTS
Streaming
```

------------------------------------------------------------------------

## Week 4

AI 试摆：

``` text
Image Upload
Prompt
Image Generation
Result Storage
Retry
```

------------------------------------------------------------------------

## Week 5

商品数字化：

``` text
商品图片
Vision
OCR
字段抽取
商品入库
```

------------------------------------------------------------------------

## Week 6

Three.js：

``` text
GLB
Scene
Camera
Lighting
Transform
Drag
Rotate
Scale
```

------------------------------------------------------------------------

## Week 7

完整闭环：

``` text
语音
 ↓
推荐
 ↓
照片
 ↓
试摆
 ↓
保存
 ↓
预约
```

------------------------------------------------------------------------

## Week 8

稳定性：

``` text
E2E Test
错误处理
模型 fallback
图片存储
日志
监控
```

------------------------------------------------------------------------

# 44. 第二阶段：App

## Month 3

``` text
iOS
RoomPlan
LiDAR
ARKit
RealityKit
```

实现：

> "拿着手机绕客厅走一圈。"

然后：

``` text
Room
 ↓
Wall
Floor
Door
Window
Furniture
```

形成：

# Room Scene

------------------------------------------------------------------------

# 45. 第三阶段：AI Furniture OS

Month 4～6：

``` text
商品数字化
+
库存
+
订单
+
客户
+
价格
+
供应商
+
AI销售
```

最终：

> 一家传统家具店不再需要复杂 ERP 培训。

------------------------------------------------------------------------

# 46. Evaluation / Eval

必须建立 Agent Eval。

## Voice Eval

指标：

-   ASR Accuracy
-   Intent Accuracy
-   Tool Accuracy
-   Response Latency

## Product Eval

-   商品召回率
-   价格准确率
-   库存准确率

## Try-on Eval

-   家具位置
-   遮挡关系
-   光照一致性
-   结构保持
-   商品一致性

## Agent Eval

``` text
是否调用正确 Tool
是否使用真实价格
是否虚构库存
是否正确理解用户约束
```

------------------------------------------------------------------------

# 47. 最重要的业务安全规则

价格是高风险数据。

Agent：

**不能自由生成价格。**

必须：

``` text
LLM
 ↓
get_price()
 ↓
Product System
 ↓
真实价格
```

同样：

库存：

``` text
不能：
“应该还有库存。”

必须：
get_inventory()
```

------------------------------------------------------------------------

# 48. 数据资产飞轮

这是整个产品最重要的长期价值。

``` text
商品
 ↓
用户浏览
 ↓
语音咨询
 ↓
试摆
 ↓
收藏
 ↓
到店
 ↓
成交
 ↓
评价
 ↓
库存变化
```

最终形成：

# Furniture Data Flywheel

数据越多：

``` text
推荐越准
↓
成交越高
↓
数据更多
↓
价格更合理
↓
库存更健康
```

------------------------------------------------------------------------

# 49. 产品真正的护城河

不是：

-   Three.js
-   Rodin
-   GPT Image
-   RoomPlan

这些都是可以替换的。

真正的壁垒是：

## ① 家具数字资产

``` text
图片
+
3D
+
材质
+
尺寸
+
价格
+
库存
```

## ② 家具行业知识

``` text
材质
工艺
风格
价格
销售经验
```

## ③ 用户空间数据

``` text
房间
尺寸
风格
偏好
历史方案
```

## ④ 商家经营数据

``` text
采购
库存
销售
毛利
周转
```

------------------------------------------------------------------------

# 50. 最终产品闭环

``` text
                    用户
                     │
                  “阿杏”
                     │
              ┌──────┴──────┐
              │             │
             说话           拍照
              │             │
              └──────┬──────┘
                     ↓
                AI 导购
                     ↓
                 商品检索
                     ↓
              ┌──────┴──────┐
              │             │
            AI试摆          3D
              │             │
              └──────┬──────┘
                     ↓
                  选方案
                     ↓
                  到店体验
                     ↓
                    成交
                     ↓
                 商家数据
                     ↓
                 AI 店长
                     ↓
                 更好的推荐
                     ↓
                    用户
```

------------------------------------------------------------------------

# 51. 产品 Slogan

主 Slogan：

> **我是提前把家具搬到你家的 AI 助手，阿杏～**

副 Slogan：

> **先搬回家看看，再决定要不要买。**

品牌表达：

> **不只是看家具，是先把家布置好。**

------------------------------------------------------------------------

# 52. 最终技术决策

  技术                定位               是否采用
  ------------------- ----------------- ----------
  React               Web UI                ✓
  Next.js             Web App               ✓
  TypeScript          主语言                ✓
  Three.js            Web 3D                ✓
  React Three Fiber   React 3D              ✓
  GLB/glTF            3D Asset              ✓
  RoomPlan            iPhone 房间扫描       ✓
  ARKit               iOS AR                ✓
  RealityKit          iOS 3D/AR             ✓
  Vision Model        商品/房间理解         ✓
  Image Generation    AI 试摆               ✓
  Hyper3D Rodin       家具 3D 生成          ✓
  Voice / Realtime    语音导购              ✓
  Agent Runtime       业务编排              ✓
  PostgreSQL          正式数据              ✓
  Object Storage      图片/GLB              ✓

------------------------------------------------------------------------

# 53. 最终建议

**第一版不要一开始就做 LiDAR + 3D + AR + 全屋数字孪生。**

正确路线是：

``` text
Phase 1

语音
+
商品库
+
照片
+
AI试摆
+
预约

↓

验证“把家具搬回家”
这个核心价值

↓

Phase 2

Three.js
+
GLB
+
3D家具

↓

Phase 3

iOS
+
RoomPlan
+
LiDAR
+
ARKit

↓

Phase 4

AI Furniture OS
+
库存
+
价格
+
供应链
+
经营 Agent
```

**Three.js 可以，而且应该用。**

但它应该是阿杏的 **Web Spatial Engine（Web
空间渲染引擎）**，而不是整个产品的底层。

最终最合理的组合是：

> **2D AI 试摆负责"快"**
>
> **Three.js 负责"可交互"**
>
> **RoomPlan + LiDAR 负责"真实空间"**
>
> **RealityKit/ARKit 负责"手机 AR"**
>
> **Rodin 负责"家具数字资产"**
>
> **Agent Runtime 负责"理解用户、调用工具、驱动整个体验"**

这会比单纯做一个"家具图片生成器"高一个产品层级。

------------------------------------------------------------------------

# 54. 技术资料复核与 v1.1 修订（2026-10）

本章根据 2026 年公开官方技术文档对原 Spec 做技术校正。重点核验：

-   Apple RoomPlan / ARKit / RealityKit
-   Apple Object Capture / Photogrammetry
-   Hyper3D Rodin API
-   OpenAI GPT Image 2.5 图像生成能力
-   React Three Fiber / Three.js

## 54.1 一个重要的架构修正

原方案中最容易产生误解的一点是：

> **不要把"用户拍一张照片 → 实时生成高质量 3D 家具 → 立即进入 3D
> 场景"作为 MVP 的同步链路。**

目前更合理的产品架构是：

``` text
                     阿杏
                      │
          ┌───────────┴───────────┐
          │                       │
      快速试摆                   3D空间
          │                       │
     GPT Image 2.5             GLB Asset
          │                       │
       秒级体验              预生成/缓存资产
          │                       │
          └───────────┬───────────┘
                      ↓
                用户继续对话
                      ↓
          需要精确空间操作时再进入 3D
```

原因是：Hyper3D Rodin 当前 API 是异步 3D 生成服务；官方文档中的 Rodin
Agentic 也以分钟级生成时间作为不同 tier
的典型耗时。因此它更适合**商品资产生产流水线**，而不是用户点击"试摆"后的同步实时生成器。

------------------------------------------------------------------------

# 55. 2026 技术能力核验

## 55.1 Apple RoomPlan

RoomPlan 是当前阿杏 iOS App 最值得利用的原生能力之一。

Apple 官方定义中，RoomPlan 使用设备摄像头、LiDAR
和机器学习模型，对室内环境进行扫描，并识别：

-   墙
-   门
-   窗
-   开口
-   沙发
-   桌子
-   床
-   柜体
-   家电等

并输出带有尺寸信息的参数化房间表示，可导出 USD / USDZ。

因此：

> **RoomPlan 更准确的定位是"房间参数化建模器"，不是完整的 photorealistic
> 3D reconstruction。**

它非常适合阿杏的：

``` text
房间尺寸
+
墙体
+
门窗
+
主要家具
↓
Room Scene
```

官方资料明确把"虚拟家具预览"和"电商场景"列为 RoomPlan 的典型应用方向。

### 产品决策

P2 iOS App：

``` text
用户：
“帮我把客厅扫描一下”

↓

RoomPlan

↓

墙 / 地 / 门 / 窗 / 家具 / 尺寸

↓

阿杏 Scene Schema

↓

Three.js / RealityKit

↓

虚拟家具
```

------------------------------------------------------------------------

# 56. ARKit Scene Reconstruction

如果产品需要更接近真实空间的环境遮挡，而不只是房间平面结构，则增加：

``` text
ARKit Scene Reconstruction
```

ARKit 可以根据 LiDAR 深度信息生成物理环境的 polygonal mesh，并支持：

-   平面检测
-   场景网格
-   物体分类
-   虚拟物体遮挡

这对于"沙发应该被真实茶几挡住""家具应该被墙遮挡"之类的 AR 体验非常重要。

因此：

``` text
RoomPlan
    =
“这个房间是什么结构？”

ARKit Scene Reconstruction
    =
“这个现实空间的几何表面在哪里？”
```

二者不是互斥关系。

------------------------------------------------------------------------

# 57. Apple Object Capture：家具 3D 的第二条路线

Apple RealityKit Object Capture 可以通过多张照片进行
photogrammetry（摄影测量），生成 3D 对象。

官方文档要求：

-   多角度照片
-   良好光照
-   足够的图像重叠
-   尽量避免强反光和硬阴影

对于家具店，这提供了一个非常有价值的备选方案：

``` text
店主
  ↓
围着沙发拍摄一圈
  ↓
Object Capture
  ↓
Photogrammetry
  ↓
3D Object
```

但它不应该成为用户购买流程中的实时能力。

它更适合作为：

> **"商家数字化上架工具"**

即：

``` text
店主拍一次
    ↓
生成一次
    ↓
以后所有用户重复使用
```

这就是家具数字资产的核心思想。

------------------------------------------------------------------------

# 58. Rodin：从"实时生成器"调整为"Asset Factory"

Hyper3D 当前官方 API 支持：

-   Image-to-3D
-   Text-to-3D
-   多图输入
-   Gen-2 / Gen-2.5
-   GLB 等标准 3D 输出
-   异步任务
-   任务状态查询
-   下载生成结果

Rodin Agentic 当前支持让系统自动选择生成模式；官方文档给出的 basic /
standard / pro tier 典型耗时约为 3 / 5 / 10 分钟。

因此阿杏应该这样使用：

``` text
                 商品数字化
                     │
                  商品照片
                     │
          ┌──────────┴──────────┐
          │                     │
     Rodin Image→3D       Apple Object Capture
          │                     │
          └──────────┬──────────┘
                     ↓
                 GLB Asset
                     ↓
               Asset Validation
                     ↓
               Asset Registry
                     ↓
          ┌──────────┴──────────┐
          ↓                     ↓
      Three.js              RealityKit
```

### 不推荐

``` text
用户点击“试摆”
      ↓
现场调用 Rodin
      ↓
等待数分钟
```

### 推荐

``` text
店主上架商品
      ↓
后台自动生成 3D
      ↓
审核
      ↓
缓存 GLB
      ↓
用户以后直接加载
```

------------------------------------------------------------------------

# 59. GPT Image 2.5：定位为"极速视觉试摆层"

OpenAI 当前官方图像生成 API 文档提供 GPT Image 2.5
的不同模型形态，例如：

-   `gpt-image-2.5-sunburst`
-   `gpt-image-2.5-flare`

官方文档同时支持：

-   从文本生成图片
-   编辑已有图片
-   多轮编辑
-   在 Responses API 中作为多步骤流程的一部分使用

因此阿杏的 2D
试摆应该继续保留，而且它实际上是整个产品最重要的**低门槛入口**。

------------------------------------------------------------------------

# 60. 最终的"2D → 3D → AR"产品分层

这是本项目最重要的产品架构。

## Level 1：照片试摆

``` text
用户客厅照片
+
商品图片
+
空间指令
        ↓
GPT Image 2.5
        ↓
“沙发搬进你家”
```

目标：

> 让用户 5～10 秒内看到"像不像"。

这是转化入口。

------------------------------------------------------------------------

## Level 2：3D 商品

``` text
商品
 ↓
GLB
 ↓
Three.js
 ↓
360°
```

目标：

> 让用户"看清楚家具"。

------------------------------------------------------------------------

## Level 3：3D Room Scene

``` text
RoomPlan
+
GLB Furniture
+
Scene Schema
        ↓
Three.js / RealityKit
```

目标：

> 让用户"理解空间关系"。

------------------------------------------------------------------------

## Level 4：AR 实景

``` text
Camera
+
LiDAR
+
ARKit
+
RealityKit
+
Furniture GLB
        ↓
真实环境中的虚拟家具
```

目标：

> 让用户"真正看到家具在家里"。

------------------------------------------------------------------------

# 61. 阿杏真正应该构建的核心对象：Scene

不要让 Agent 直接操作 Three.js。

这是一个重要的工程原则。

推荐：

``` text
User Language
      ↓
Agent
      ↓
Scene Command
      ↓
Scene Engine
      ↓
Three.js / RealityKit
```

例如用户：

> "把沙发往左边一点，再换成米白色。"

Agent 不应该生成：

``` javascript
mesh.position.x -= 0.3
mesh.material.color = ...
```

而应该生成：

``` json
{
  "action": "update_scene_object",
  "object_id": "sofa_001",
  "operations": [
    {
      "type": "translate",
      "axis": "x",
      "delta": -0.3
    },
    {
      "type": "set_material",
      "material_id": "ivory_fabric"
    }
  ]
}
```

然后：

``` text
Scene Engine
    ↓
Three.js Adapter
```

这样以后换成：

``` text
RealityKit
Unity
WebGPU
ARKit
```

都不需要重新设计 Agent。

------------------------------------------------------------------------

# 62. Scene Command Schema

建议建立第一版统一命令：

``` typescript
type SceneCommand =
  | {
      type: "add_object";
      productId: string;
      position?: Vec3;
    }
  | {
      type: "remove_object";
      objectId: string;
    }
  | {
      type: "move_object";
      objectId: string;
      position: Vec3;
    }
  | {
      type: "rotate_object";
      objectId: string;
      rotation: Vec3;
    }
  | {
      type: "scale_object";
      objectId: string;
      scale: Vec3;
    }
  | {
      type: "replace_object";
      objectId: string;
      productId: string;
    }
  | {
      type: "change_material";
      objectId: string;
      materialId: string;
    }
  | {
      type: "change_color";
      objectId: string;
      color: string;
    };
```

这实际上是：

# Spatial Tool Calling

也就是：

> **Agent 不只是调用业务 API，还可以调用空间操作 API。**

------------------------------------------------------------------------

# 63. Three.js / React Three Fiber 最新工程建议

React Three Fiber 是 Three.js 的 React renderer。

推荐：

``` text
React
   ↓
React Three Fiber
   ↓
Three.js
   ↓
WebGL / WebGPU
```

当前 React Three Fiber 文档已经出现 v10 alpha，并开始提供 WebGPU
相关能力；但生产 MVP 不建议因为追新而直接绑定 alpha。

### MVP

``` text
Three.js
+
React Three Fiber
+
Drei
+
GLTFLoader
```

### 后续

``` text
WebGPU
+
更复杂 PBR
+
大规模场景
+
GPU instancing
```

------------------------------------------------------------------------

# 64. Web 3D 性能预算

阿杏不是游戏，不应该追求"模型越精细越好"。

建议：

## 首屏

``` text
3D 首屏目标：
< 3 MB
```

## 单家具

建议根据设备动态分级：

``` text
Mobile Low
   ↓
低面数 GLB

Mobile High
   ↓
中等面数 GLB

Desktop
   ↓
高质量 GLB
```

## Asset Pipeline

``` text
Original Model
      ↓
LOD Generation
      ↓
Mesh Simplification
      ↓
Texture Resize
      ↓
KTX2 / compressed texture
      ↓
GLB
```

目标不是：

> "做一个电影级 3D 模型"

而是：

> **"让一个普通 iPhone 能同时加载 5～20 件家具仍然流畅。"**

------------------------------------------------------------------------

# 65. 家具资产必须支持 LOD

每个商品不要只有一个 GLB。

建议：

``` text
product_001/
├── hero.webp
├── thumbnail.webp
├── model_low.glb
├── model_medium.glb
├── model_high.glb
└── metadata.json
```

使用：

``` text
列表页
→ thumbnail

商品详情
→ hero

3D 预览
→ medium

AR / 高性能设备
→ high
```

------------------------------------------------------------------------

# 66. 2D 试摆和 3D 场景的"真值"问题

这是产品最容易踩坑的地方。

AI 图片可以产生视觉上很真实的结果，但：

> **视觉真实 ≠ 尺寸真实。**

所以阿杏必须把两种结果明确区分：

### "效果参考"

``` text
AI Try-on
```

标注：

> "AI 效果图，仅供空间搭配参考。"

### "尺寸确认"

``` text
3D Scene / RoomPlan
```

标注：

> "根据家具实际尺寸和房间测量结果生成。"

最终购买决策必须以：

``` text
商品真实尺寸
+
实际测量
```

为准。

------------------------------------------------------------------------

# 67. 用户体验中的"无感技术"

用户绝对不应该看到：

``` text
Rodin
GPT Image
Three.js
RoomPlan
ARKit
GLB
```

用户看到的应该只有：

``` text
拍一下
↓
阿杏正在帮你搬进去…
↓
好了
```

或者：

> "要不要让我把这个沙发也搬进去看看？"

这就是产品的：

# Invisible Infrastructure

技术越来越复杂，但用户操作越来越简单。

------------------------------------------------------------------------

# 68. 推荐的最终 App 首页

最终首页不要像传统家具商城。

应该更接近：

``` text
┌─────────────────────────┐
│                         │
│       客厅背景图         │
│                         │
│        阿杏头像          │
│                         │
│   “早安，我是阿杏～”     │
│                         │
│  我可以帮你把家具搬回家   │
│                         │
│ ┌─────────┐ ┌─────────┐ │
│ │ 拍照试摆 │ │ 语音问我 │ │
│ └─────────┘ └─────────┘ │
│                         │
│ ┌─────────┐ ┌─────────┐ │
│ │ 看家具  │ │ 我的方案 │ │
│ └─────────┘ └─────────┘ │
│                         │
│     🎙 按住说话          │
└─────────────────────────┘
```

核心不是"商城"。

而是：

> **AI 家居顾问。**

------------------------------------------------------------------------

# 69. 八个页面应该形成一条任务流

原来的 8 张手机图不要只是"8 个页面展示"。

它们应该实际上组成：

``` text
01 首页
 ↓
02 语音表达需求
 ↓
03 上传房间
 ↓
04 选择家具
 ↓
05 AI 试摆
 ↓
06 3D 查看
 ↓
07 AI 解释
 ↓
08 保存 / 到店
```

因此 PPT 中展示 8 张 iPhone 时，应当让观众一眼看到：

> **一个用户从"我想买沙发"到"沙发已经搬进我家"再到"我准备去店里买"的完整旅程。**

------------------------------------------------------------------------

# 70. 商家侧必须形成另一条闭环

消费者侧：

``` text
需求
↓
试摆
↓
推荐
↓
预约
↓
成交
```

商家侧：

``` text
进货
↓
拍照上架
↓
AI 识别
↓
价格
↓
库存
↓
销售
↓
成交
↓
库存变化
```

最终两条链汇合：

``` text
                   家具数字资产
                        │
          ┌─────────────┴─────────────┐
          ↓                           ↓
       消费者                        商家
          │                           │
      AI 导购                       AI 店长
          │                           │
       试摆                         库存
          │                           │
       预约                         定价
          │                           │
       成交 ←───────────────────────→ 经营数据
```

------------------------------------------------------------------------

# 71. 价格系统：不要直接采用"成本 + 固定毛利"

对于没有全国统一价的县城家具店，更合理的是：

``` text
Purchase Cost
+
Logistics
+
Installation
+
Expected Operating Cost
+
Target Margin
+
Inventory Adjustment
+
Market Adjustment
```

形成：

``` text
指导价
成交价区间
最低保护价
```

例如：

``` text
进货成本：3000

指导价：4999

建议成交区间：
4499～4799

最低保护价：
4299
```

Agent 可以解释：

> "这款现在库存有 4 件，已经 96 天没有卖出，我更建议把成交价控制在
> 4399～4599。"

但：

> **价格计算必须由 Price Engine 负责，LLM 只能解释和调用。**

------------------------------------------------------------------------

# 72. "讨价还价"不是第一阶段就必须消灭

你原来的判断有一部分正确：

> 统一明码标价可以降低运营复杂度。

但不要简单把"讨价还价"直接砍掉。

推荐过渡：

### 第一阶段

``` text
明码标价
+
AI 推荐成交区间
```

### 第二阶段

``` text
会员价
套餐价
全屋方案价
```

### 第三阶段

``` text
AI Pricing Engine
```

最终不是：

> "所有人一个价格。"

而是：

> **"价格规则透明、成交过程可控。"**

------------------------------------------------------------------------

# 73. 传统家具店真正应该数字化的 7 类数据

``` text
① Product
商品

② Asset
图片 / 3D / 材质 / 尺寸

③ Inventory
库存

④ Purchase
采购

⑤ Customer
客户

⑥ Conversation
沟通

⑦ Transaction
交易
```

然后形成：

``` text
Product
   ↓
Asset
   ↓
Customer Intent
   ↓
Try-on
   ↓
Order
   ↓
Inventory
   ↓
Profit
```

------------------------------------------------------------------------

# 74. 微信数据不要"一次性全量导入"

建议采用：

``` text
历史微信图片
历史聊天
历史报价
历史订单
```

先进入：

``` text
Raw Data Zone
```

再由 Agent / ETL：

``` text
OCR
+
Vision
+
Entity Extraction
+
Product Matching
```

转成：

``` text
客户
商品
供应商
价格
订单
需求
```

同时保留：

``` text
source_id
source_time
source_image
source_message
confidence
```

这样每个结构化数据都能追溯到原始证据。

这是后续做经营 Agent 的关键。

------------------------------------------------------------------------

# 75. 纸质票据数字化：必须保留"证据链"

不要只做：

``` text
OCR → Excel
```

而应该：

``` text
原始票据
   ↓
OCR / Vision
   ↓
结构化字段
   ↓
人工确认
   ↓
业务对象
```

例如：

``` json
{
  "purchase_price": 3800,
  "quantity": 3,
  "supplier": "XX家具厂",
  "confidence": 0.96,
  "source": {
    "document_id": "invoice_20260912_001",
    "page": 1
  }
}
```

未来老板问：

> "这 3 张床的进货价是多少？"

Agent 不应该只是回答数字，而应该能够：

> "3800 元/张，来源是 2026 年 9 月 12 日这张进货单。"

------------------------------------------------------------------------

# 76. 阿杏 Agent 的四层 Context

建议不要只有一个"大上下文"。

``` text
Layer 1
User Context
用户预算、家庭、偏好

Layer 2
Scene Context
房间、尺寸、现有家具、当前 Scene

Layer 3
Product Context
候选商品、价格、库存、材质

Layer 4
Business Context
门店规则、价格规则、促销、预约
```

Agent 每次只取当前任务需要的 Context。

这会明显降低：

-   Context Dilution
-   Context Competition
-   Token Cost
-   错误召回

------------------------------------------------------------------------

# 77. Spatial Agent 的 Tool 分类

建议最终 Tool Registry：

## 商品

``` text
search_products
get_product
compare_products
get_inventory
get_price
```

## 房间

``` text
analyze_room
scan_room
get_room_dimensions
```

## 场景

``` text
create_scene
add_furniture
remove_furniture
move_furniture
rotate_furniture
resize_furniture
replace_furniture
change_material
change_color
```

## AI

``` text
generate_tryon
generate_3d_asset
generate_room_design
```

## 商业

``` text
save_design
share_design
book_visit
create_order
```

这会让阿杏从：

> Chat Agent

进化成：

> **Commerce + Spatial Agent**

------------------------------------------------------------------------

# 78. 最终技术架构 v1.1

``` text
                           阿杏 App
                              │
             ┌────────────────┼────────────────┐
             │                │                │
           Voice            Camera           LiDAR
             │                │                │
             └────────────────┼────────────────┘
                              ↓
                        Multimodal Agent
                              │
                       Intent / Planner
                              │
              ┌───────────────┼────────────────┐
              │               │                │
        Product Agent    Spatial Agent     Commerce Agent
              │               │                │
              ↓               ↓                ↓
        Product Tools     Scene Tools      Store Tools
              │               │                │
              ↓               ↓                ↓
        Product DB       Scene Store       Order/Inventory
              │               │
              ↓               ↓
       Asset Registry     Scene Schema
              │               │
       ┌──────┴──────┐       │
       │             │       │
    Image AI       3D AI     │
       │             │       │
 GPT Image 2.5    Rodin      │
       │             │       │
    2D Try-on       GLB      │
       │             │       │
       └──────┬──────┘       │
              ↓              ↓
          Web Renderer    iOS Renderer
              │              │
          Three.js      RealityKit / ARKit
              │              │
              └──────┬───────┘
                     ↓
                用户的“家”
```

------------------------------------------------------------------------

# 79. MVP 应该砍掉什么

第一版不要做：

-   实时 LiDAR
-   复杂 AR
-   多房间数字孪生
-   实时 Rodin
-   自动全屋 3D
-   复杂 ERP
-   动态价格 AI
-   微信全量历史分析

第一版只证明一个事情：

> **用户愿意因为"先把家具搬回家看看"而使用阿杏。**

------------------------------------------------------------------------

# 80. 第一版真正的 Golden Path

``` text
用户进入
  ↓
“我是阿杏～
 我可以先把家具搬到你家看看。”
  ↓
用户按住麦克风
  ↓
“我想买个三四千的沙发。”
  ↓
阿杏推荐 3 个真实商品
  ↓
“拍一张你家客厅给我。”
  ↓
用户拍照
  ↓
选择商品
  ↓
AI Try-on
  ↓
结果出现
  ↓
“这个怎么样？”
  ↓
用户：
“换第二个。”
  ↓
阿杏直接替换
  ↓
用户：
“这个可以。”
  ↓
保存方案
  ↓
预约到店
```

这条链必须做到：

> **短、快、稳定。**

------------------------------------------------------------------------

# 81. 关键 KPI

## 用户侧

``` text
首次试摆完成率
照片上传 → 试摆成功率
试摆 → 收藏率
收藏 → 预约率
预约 → 成交率
```

## Agent

``` text
Intent Accuracy
Tool Call Accuracy
Price Accuracy
Inventory Accuracy
Scene Command Accuracy
Voice Latency
```

## 体验

``` text
首次响应 < 1s
语音首包尽可能 < 1s
试摆结果目标：数秒级
3D 首屏目标：数秒级
```

注意：

> Rodin 生成不计入用户实时链路。

它属于后台 Asset Pipeline。

------------------------------------------------------------------------

# 82. 技术选型最终结论

  技术                最终定位                          决策
  ------------------- --------------------------------- ------
  React               Web UI                            采用
  Next.js             Web App                           采用
  TypeScript          主语言                            采用
  Three.js            Web 3D Engine                     采用
  React Three Fiber   React 3D Renderer                 采用
  GLB / glTF          家具资产格式                      采用
  GPT Image 2.5       2D AI 试摆                        采用
  Hyper3D Rodin       家具 3D Asset Factory             采用
  RoomPlan            iOS 房间参数化扫描                P2
  ARKit               空间跟踪 / Scene Reconstruction   P2
  RealityKit          iOS 3D / AR                       P2
  Object Capture      商家多图建模备选                  P2
  WebGPU              后续性能路线                      P3
  PostgreSQL          正式业务数据                      采用
  Object Storage      图片 / GLB                        采用
  Agent Runtime       Agent 编排                        采用

------------------------------------------------------------------------

# 83. 官方资料与技术依据

以下资料建议直接进入项目 README / Architecture Decision Record（ADR）。

### Apple

-   RoomPlan\
    https://developer.apple.com/documentation/roomplan

-   RoomPlan Overview\
    https://developer.apple.com/augmented-reality/roomplan/

-   ARKit Scene Reconstruction\
    https://developer.apple.com/documentation/arkit/arworldtrackingconfiguration/scenereconstruction

-   RealityKit Object Capture\
    https://developer.apple.com/documentation/realitykit/realitykit-object-capture

-   PhotogrammetrySession\
    https://developer.apple.com/documentation/realitykit/photogrammetrysession

### Hyper3D

-   Hyper3D API Documentation\
    https://docs.hyper3d.ai/en

-   Rodin Features\
    https://docs.hyper3d.ai/en/get-started/features

-   Rodin Agentic API\
    https://docs.hyper3d.ai/en/api-specification/rodin-agentic

-   Hyper3D Pricing\
    https://hyper3d.ai/pricing

### OpenAI

-   Image Generation API\
    https://developers.openai.com/api/docs/guides/image-generation

-   Image API Reference\
    https://developers.openai.com/api/reference/cli/resources/images/methods/generate

### React Three Fiber

-   React Three Fiber Documentation\
    https://r3f.docs.pmnd.rs/

------------------------------------------------------------------------

# 84. 最终产品判断

阿杏最值得做的，不是：

> "AI 帮你生成一张家具效果图。"

而是：

> **"AI 理解你的家，并且可以替你操作这个家。"**

因此产品演化路线应该明确为：

``` text
AI 导购
   ↓
AI 试摆
   ↓
3D Furniture
   ↓
3D Room
   ↓
AR Home
   ↓
Spatial Agent
   ↓
AI Furniture OS
```

其中：

``` text
GPT Image 2.5
=
视觉生成层

Rodin
=
家具数字资产层

RoomPlan
=
房间结构层

ARKit
=
现实空间层

Three.js
=
Web 空间交互层

RealityKit
=
iOS 空间交互层

Agent
=
整个系统的“大脑”
```

最终一句话：

> **阿杏不是把家具"画进"你的家，而是逐渐建立一个可被 AI
> 理解、编辑和交易的"数字化家庭空间"。**

这才是这个项目从一个家具店 Demo 走向真正 Spatial
Commerce（空间电商）产品的技术路线。
