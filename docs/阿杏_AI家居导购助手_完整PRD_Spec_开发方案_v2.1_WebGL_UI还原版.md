# 阿杏 AI 家居导购助手

## Product Requirement Document（PRD）+ Technical Specification（Spec）+ Development Plan v2.1

> **产品 Slogan**
>
> **我是提前把家具搬到你家的 AI 助手，阿杏～**
>
> 英文定位：**A-Xing --- the AI Home Shopping Agent that brings
> furniture into your home before you buy it.**

> **本版本的核心改动**
>
> 从"功能入口型首页"升级为"**持续对话型 AI 首页**"：
>
> -   聊天窗口始终是页面主舞台；
> -   阿杏女孩头像始终作为 AI 身份锚点出现；
> -   "上传客厅照片，让阿杏提前把喜欢的家具搬回家～"成为首页第一业务卡片；
> -   拍照、语音、浏览家具、我的方案等能力全部下沉到聊天窗口下方；
> -   用户可以边看试摆结果、边拖动/浏览、边继续与阿杏语音聊天；
> -   后续逐步从 2D AI 试摆升级到 3D 家具、3D 房间、AR 和 Spatial
>     Agent（空间智能体）。

------------------------------------------------------------------------

# v2.1 更新说明：WebGL / Three.js + 首页视觉还原

本版本在 v2.0 的产品与 Agent 架构基础上，新增一条**强约束的前端视觉实现规范**：

> **「阿杏AI家居导购界面.png」是首页的视觉基准，不是灵感图。**

首页必须采用：

```text
Screenshot Reference
        ↓
DOM / CSS UI Reconstruction
        ↓
Three.js / WebGL Spatial Layer
        ↓
Browser Screenshot
        ↓
Visual Diff / Visual QA
        ↓
Refine
        ↓
Acceptance
```

核心原则：

1. **禁止用一个 Canvas / WebGL 绘制整个网页 UI。**
2. React / HTML / CSS 负责聊天、卡片、头像、按钮、输入框、导航和文本。
3. Three.js / React Three Fiber 只负责空间场景、家具 3D、相机、灯光、材质和空间交互。
4. 首屏必须先完成 DOM UI 渲染，再渐进加载 WebGL。
5. WebGL 不可用时必须有视觉连续的 DOM / 静态图 fallback。
6. 所有视觉验收必须以真实浏览器截图为准，而不是以代码结构为准。

这一边界是后续从 Web → 3D → App → AR → Spatial Agent 演进的基础。


------------------------------------------------------------------------

# 1. 产品定义

## 1.1 一句话

**阿杏不是家具搜索框，也不是单纯的 AI
生图工具，而是一个以"把家具提前搬进家"为核心任务的 Conversational
Commerce Agent（对话式交易智能体）。**

用户可以直接说：

> "阿杏，我想换个三四千左右的布艺沙发，我家客厅大概 20 平，帮我看看。"

阿杏负责完成：

``` text
理解需求
  ↓
检索真实商品
  ↓
解释为什么推荐
  ↓
邀请用户上传客厅照片
  ↓
AI 试摆
  ↓
比较尺寸 / 材质 / 风格 / 价格
  ↓
可选 3D / AR
  ↓
保存方案
  ↓
预约到店
  ↓
成交
```

------------------------------------------------------------------------

# 2. 本版本 UX 核心原则

## 2.1 第一原则：聊天永远在

旧方案的问题：

``` text
首页
├── 拍照试摆
├── 语音导购
├── 浏览家具
└── 我的方案
```

用户必须先理解产品，再选择入口。

新方案：

``` text
                    阿杏
                     │
                持续聊天窗口
                     │
          ┌──────────┴──────────┐
          │                     │
       AI 回复               用户回复
          │
   任务卡 / 商品卡 / 试摆卡
          │
   ───────────────────────
   拍照试摆 / 语音导购 / 浏览家具 / 我的方案
   ───────────────────────
          │
       输入框
```

**聊天是主界面，功能是聊天的能力扩展，而不是彼此竞争的入口。**

------------------------------------------------------------------------

## 2.2 第二原则：阿杏必须"在场"

每个 AI 消息都带阿杏头像。

头像不是装饰，而是：

-   Identity Anchor（身份锚点）
-   Voice Anchor（声音身份）
-   Trust Anchor（信任锚点）
-   Brand Asset（品牌资产）

推荐规则：

-   AI 消息左侧显示小尺寸阿杏头像；
-   首屏首次介绍可以显示较大的半身阿杏；
-   用户向下滚动后不再反复显示大头像；
-   每次新的 AI 任务结果仍保留小头像；
-   语音播放时头像增加轻微呼吸/声波状态；
-   不使用随机人物头像。

------------------------------------------------------------------------

## 2.3 第三原则：首页第一任务就是"搬家具回家"

首屏核心卡片固定：

> **上传客厅照片**
>
> 让阿杏提前把喜欢的家具为您搬回家～

卡片支持：

-   拍照
-   相册
-   示例客厅
-   最近照片

这是整个产品的核心 CTA（Call To Action，行动召唤）。

------------------------------------------------------------------------

# 3. 目标用户

## 3.1 家庭消费者

核心需求：

-   买沙发
-   买床
-   买电视柜
-   买茶几
-   全屋搭配
-   判断尺寸
-   判断风格
-   判断材质
-   比较价格

## 3.2 中老年用户

设计约束：

-   不依赖打字；
-   支持按住说话；
-   语音回答；
-   大按钮；
-   大字号；
-   少层级；
-   不要求理解 SKU、模型、3D 等技术概念。

## 3.3 年轻用户

关注：

-   拍照试摆；
-   风格匹配；
-   3D；
-   AR；
-   分享方案；
-   全屋搭配。

------------------------------------------------------------------------

# 4. 产品信息架构

``` text
阿杏
│
├── 首页 / Chat
│   ├── AI 对话
│   ├── 上传客厅
│   ├── 拍照试摆
│   ├── 语音导购
│   ├── 商品推荐
│   └── 最近任务
│
├── 商品
│   ├── 沙发
│   ├── 床
│   ├── 柜
│   ├── 茶几
│   └── 其他
│
├── 3D
│   ├── 家具 3D
│   ├── 房间 3D
│   ├── 场景编辑
│   └── AR
│
├── 方案
│   ├── 我的方案
│   ├── 试摆记录
│   ├── 全屋搭配
│   └── 分享
│
└── 我的
    ├── 我的房间
    ├── 我的偏好
    ├── 预约
    └── 联系门店
```

------------------------------------------------------------------------

# 5. 首页最终 UI Spec

## 5.1 页面结构

严格采用"聊天优先"结构：

``` text
┌─────────────────────────────┐
│  ☰      阿杏              ⋯ │
├─────────────────────────────┤
│                             │
│   [阿杏头像]                │
│   你好，我是阿杏～          │
│   我可以先把家具搬到你家     │
│                             │
│   [AI 对话内容]             │
│                             │
│   ┌─────────────────────┐   │
│   │ 上传客厅照片         │   │
│   │ 让阿杏提前把喜欢的   │   │
│   │ 家具搬回家～         │   │
│   │ [📷 拍照] [相册]     │   │
│   └─────────────────────┘   │
│                             │
│   你可以这样问：             │
│   [3000左右沙发] [奶油风]   │
│   [适合小客厅] [实木家具]   │
│                             │
│   ───── 功能 ─────          │
│   [拍照试摆] [语音导购]      │
│   [浏览家具] [我的方案]      │
│                             │
├─────────────────────────────┤
│  ◉ 发消息或按住说话   ＋ 📷 │
├─────────────────────────────┤
│ 首页   商品   3D   方案   我的 │
└─────────────────────────────┘
```

### 与旧版的关键区别

  项目           旧版           v2.0
  -------------- -------------- -------------------
  首页中心       功能卡片       AI 对话
  阿杏           局部出现       AI 消息固定身份
  首要 CTA       四个并列功能   上传客厅照片
  语音           功能之一       一级输入方式
  商品推荐       独立入口       对话中的动态 Card
  试摆           独立页面       对话任务流
  3D             独立功能       对话结果的增强层
  用户学习成本   较高           只需要"说 / 拍"

------------------------------------------------------------------------

# 6. 首页第一屏文案

## Header

**你好，我是阿杏～**

副标题：

**我是提前把家具搬到你家的 AI 助手。**

## Hero Chat

阿杏：

> "你想换家具的话，可以先让我帮你搬回家看看～"

用户示例：

> "我想换一个三千左右的布艺沙发，放客厅看看。"

阿杏：

> "好呀～你先拍一张客厅，我从银杏家具的真实商品里帮你挑，再直接搬进去看看效果。"

------------------------------------------------------------------------

# 7. 首页核心卡片：搬回家

## Card ID

`home.try_on`

## 标题

**上传客厅照片**

## 副标题

**让阿杏提前把喜欢的家具为您搬回家～**

## 操作

``` text
[ 拍照 ]

[ 从相册选择 ]

[ 试试示例客厅 ]
```

## 图片要求提示

> 尽量拍到完整的墙面、地面和主要空间，试摆效果会更准确。

------------------------------------------------------------------------

# 8. 对话模型

## 8.1 Conversation-first

所有业务能力都可以被对话触发。

例如：

``` text
用户：
帮我看看三千左右的沙发

阿杏：
我找到 6 款比较合适的。
你家客厅如果不大，我更推荐这三款。
要不要拍一张客厅，我帮你搬进去看看？

[商品卡 A]
[商品卡 B]
[商品卡 C]

[上传客厅照片]
```

------------------------------------------------------------------------

# 9. Chat Message Schema

``` typescript
type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  type:
    | "text"
    | "voice"
    | "product_card"
    | "tryon_card"
    | "scene_card"
    | "material_card"
    | "booking_card"
    | "task_card";

  content?: string;

  avatar?: {
    assetId: "axing_girl";
  };

  payload?: unknown;

  createdAt: string;
};
```

------------------------------------------------------------------------

# 10. 动态 Card 是产品的核心 UI Primitive

阿杏不要用长文本解释所有东西。

应把 Agent 输出变成结构化 Card：

``` text
Text
ProductCard
TryOnCard
3DCard
MaterialCard
PlanCard
BookingCard
```

例如：

``` text
阿杏：

“我找到 3 款比较适合你家的。”

┌─────────────────────┐
│ 沙发图片             │
│ 云朵三人位           │
│ ¥3980               │
│ 布艺 · 现代 · 小户型 │
│                     │
│ [搬进我家看看]       │
└─────────────────────┘
```

------------------------------------------------------------------------

# 11. 语音交互

## 11.1 用户

长按麦克风：

> "我想看看三千左右的布艺沙发。"

## 11.2 系统

``` text
Microphone
 ↓
VAD
 ↓
Streaming ASR
 ↓
Intent
 ↓
Product Retrieval
 ↓
LLM
 ↓
Streaming TTS
```

## 11.3 体验要求

目标：

-   首字反馈 \< 1.5s；
-   常规回答端到端 \< 5s；
-   语音播放过程中可以停止；
-   支持重新提问；
-   支持"换一个""第二个""这个太大了"等上下文指代。

------------------------------------------------------------------------

# 12. 拍照试摆流程

``` text
用户拍客厅
   ↓
Room Understanding
   ↓
识别墙 / 地 / 沙发 / 茶几 / 门窗
   ↓
用户选择家具
   ↓
获取真实商品资产
   ↓
AI Try-on
   ↓
生成结果
   ↓
用户继续说话
```

核心体验：

> "阿杏，把刚才第二个沙发换进去。"

系统不应该要求用户重新上传照片。

------------------------------------------------------------------------

# 13. 2D AI Try-on 与 3D Scene 的双引擎架构

## 13.1 2D Try-on

定位：

**最快的视觉决策层。**

``` text
Room Photo
+
Furniture Product Image
+
Composition Constraints
        ↓
Image Editing / Generation
        ↓
Try-on Result
```

适用于：

-   首次体验；
-   快速换款；
-   营销；
-   Web；
-   低算力设备。

## 13.2 3D Scene

定位：

**可编辑的空间资产层。**

``` text
Room
+
Furniture GLB
        ↓
Three.js Scene
        ↓
Transform / Material / Camera
```

适用于：

-   精确尺寸；
-   多家具组合；
-   360°；
-   换颜色；
-   换材质；
-   AR；
-   长期保存方案。

------------------------------------------------------------------------

# 14. Three.js 前端方案

## 14.1 结论

**可以使用 Three.js，而且应该使用。**

推荐：

``` text
React
TypeScript
Next.js
React Three Fiber
Three.js
@react-three/drei
GLTFLoader
```

其中：

**React Three Fiber（R3F）= React 对 Three.js 的声明式封装。**

不要在 React 项目里大量直接维护 imperative Three.js lifecycle。

------------------------------------------------------------------------

# 15. Three.js 的职责边界

Three.js 负责：

-   Scene；
-   Camera；
-   Lighting；
-   GLB / glTF；
-   Material；
-   Transform；
-   Rotation；
-   Scale；
-   Drag；
-   Bounding Box；
-   尺寸标注；
-   家具选中；
-   场景截图。

Three.js 不负责：

-   商品搜索；
-   价格；
-   库存；
-   AI 对话；
-   订单；
-   推荐逻辑。

------------------------------------------------------------------------

# 16. Scene Schema

``` typescript
interface FurnitureScene {
  id: string;
  roomId: string;

  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };

  objects: FurnitureObject[];

  metadata: {
    source: "photo" | "roomplan" | "manual";
    createdAt: string;
    updatedAt: string;
  };
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

  material?: string;
}
```

------------------------------------------------------------------------

# 17. 家具 3D Asset Pipeline

## 17.1 店主侧

老板只需要：

> **拍一张家具照片。**

后台：

``` text
Photo
 ↓
Image Quality Check
 ↓
Background Removal
 ↓
Object Segmentation
 ↓
Image-to-3D
 ↓
Mesh Optimization
 ↓
Texture Compression
 ↓
GLB
 ↓
Human QA / AI QA
 ↓
Asset Registry
```

------------------------------------------------------------------------

# 18. Hyper3D Rodin 定位

Rodin 是后台：

**Furniture 3D Asset Factory（家具三维资产工厂）**

不直接暴露给消费者。

``` text
商品照片
   ↓
Asset Agent
   ↓
Rodin
   ↓
GLB
   ↓
QA
   ↓
商品资产库
```

一件家具只需要生成一次 3D。

后续：

``` text
1000 次用户试摆
=
复用同一个 GLB
```

------------------------------------------------------------------------

# 19. 家具资产 Registry

``` typescript
interface FurnitureAsset {
  id: string;
  productId: string;

  sourceImages: string[];

  maskUrl?: string;

  glbUrl?: string;

  previewUrl?: string;

  dimensions?: {
    width: number;
    depth: number;
    height: number;
  };

  polygonCount?: number;

  textureSize?: number;

  status:
    | "processing"
    | "ready"
    | "failed";

  provider?: "rodin" | "object_capture" | "manual";

  qualityScore?: number;
}
```

------------------------------------------------------------------------

# 20. iOS App：最终空间计算路线

如果产品进入深度 App 阶段：

``` text
SwiftUI
+
ARKit
+
RealityKit
+
RoomPlan
+
LiDAR
```

## RoomPlan

用于：

-   房间墙体；
-   地面；
-   门；
-   窗；
-   房间尺寸；
-   家具空间关系。

## LiDAR

适用于支持 LiDAR 的 iPhone / iPad。

目标不是要求用户"学习扫描"，而是：

> "拿手机绕房间走一圈，阿杏帮你把家记下来。"

------------------------------------------------------------------------

# 21. Web / App 产品分工

  能力              Web   iOS App
  -------------- ------ ---------
  AI 对话             ✓         ✓
  语音                ✓        ✓✓
  上传照片            ✓        ✓✓
  2D 试摆             ✓         ✓
  商品浏览            ✓         ✓
  Three.js           ✓✓         ✓
  3D 家具             ✓        ✓✓
  RoomPlan           \-        ✓✓
  LiDAR              \-        ✓✓
  AR               部分        ✓✓
  本地空间计算     有限        ✓✓
  Push             有限         ✓
  相机体验         一般        ✓✓

结论：

> **Web 是获客入口，App 是空间智能产品。**

------------------------------------------------------------------------

# 22. AI Agent 架构

推荐从一个 Orchestrator（编排器）开始，而不是一开始拆成大量 Agent。

``` text
                       A-Xing Agent
                            │
                     Intent Router
                            │
        ┌───────────────────┼──────────────────┐
        │                   │                  │
   Product Tools       Scene Tools        Store Tools
        │                   │                  │
 search_products       analyze_room       inventory
 get_price             generate_tryon    pricing
 get_inventory          create_scene      booking
 get_material           update_scene      order
```

随着业务增长再拆：

``` text
A-Xing Orchestrator
├── Shopping Agent
├── Spatial Agent
├── Product Knowledge Agent
└── Store Operation Agent
```

------------------------------------------------------------------------

# 23. Agent Tool Contract

``` typescript
search_products({
  query,
  budget,
  category,
  style,
  material,
  dimensions
})

get_product(productId)

get_inventory(productId)

get_price(productId)

get_material_info(materialId)

analyze_room(imageId)

generate_tryon({
  roomImageId,
  productId,
  placement
})

generate_3d_asset(productId)

create_scene(roomId)

update_scene(sceneId, operation)

compare_products(productIds)

save_design(sceneId)

book_store_visit({
  products,
  time
})

create_order(...)
```

------------------------------------------------------------------------

# 24. Context Engineering

不要把所有商品塞进 LLM Context。

采用：

``` text
User Intent
 ↓
Candidate Retrieval
 ↓
Top-K Products
 ↓
Inventory / Price
 ↓
Material Knowledge
 ↓
Scene Context
 ↓
LLM
```

原则：

> **LLM 不负责记商品，LLM 负责调用商品系统。**

------------------------------------------------------------------------

# 25. 商品数据模型

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
    recommendedPrice?: number;
    floorPrice?: number;
  };

  inventory: number;

  images: string[];

  asset3d?: {
    glbUrl: string;
    status: "pending" | "ready" | "failed";
  };

  supplier?: string;

  status: "draft" | "active" | "sold_out" | "offline";
}
```

------------------------------------------------------------------------

# 26. 商家数字化：从"拍照上新"开始

店主不应该先学 ERP。

入口只有：

> **拍一张，上新。**

``` text
拍商品
 ↓
Vision
 ↓
识别品类 / 材质 / 颜色 / 风格
 ↓
生成结构化 Product Draft
 ↓
建议名称
 ↓
建议价格
 ↓
店主确认
 ↓
上线
```

AI 返回严格结构化 JSON，而不是自由文本。

------------------------------------------------------------------------

# 27. 传统纸质单据数字化

``` text
纸质单据
 ↓
OCR
 ↓
Document Parsing
 ↓
字段抽取
 ↓
采购单 / 入库单 / 出库单
 ↓
Product / Supplier / Inventory
```

必须保留：

``` text
原始图片
+
结构化字段
+
抽取置信度
+
人工修正记录
```

这样后续可以追溯。

------------------------------------------------------------------------

# 28. 微信历史数据数字化

长期目标：

``` text
微信图片
微信聊天
报价
客户咨询
采购沟通
        ↓
Entity Extraction
        ↓
Customer
Product
Supplier
Price
Order
Intent
```

必须：

-   用户授权；
-   最小化采集；
-   权限控制；
-   敏感信息脱敏；
-   可删除；
-   不把私人聊天默认全部导入业务库。

------------------------------------------------------------------------

# 29. 定价系统

不建议简单使用：

``` text
售价 = 进价 × 固定倍数
```

建议建立：

``` text
Base Cost
+
Logistics Cost
+
Operating Cost
+
Target Margin
+
Inventory Adjustment
+
Market Adjustment
```

输出三个价格：

``` text
标准展示价：¥6699

推荐成交价：¥6299

最低保护价：¥5999
```

## 为什么要保留三层价格？

因为传统家具存在：

-   讨价还价；
-   不同客户；
-   库存压力；
-   展示样品；
-   清仓；
-   季节性；
-   采购价格波动。

第一阶段不强制"一口价"。

更合理的是：

> **前台逐渐一口价，后台仍然保留成交价策略。**

最终可以测试：

``` text
透明价
vs
传统议价
```

用成交率、毛利率、退货率验证。

------------------------------------------------------------------------

# 30. AI 导购的回答边界

阿杏不能自由编价格。

价格必须来自：

``` text
Product Service
+
Pricing Service
```

如果数据库没有：

> "这款目前店里没有确认价格，我不乱报。要不要我帮你问店里？"

而不是让 LLM 猜。

------------------------------------------------------------------------

# 31. 材质知识 Agent

用户：

> "为什么这个实木的贵这么多？"

阿杏：

``` text
识别商品
 ↓
获取材质
 ↓
查询知识库
 ↓
结合用户场景
 ↓
解释
```

回答结构：

``` text
是什么
为什么贵
适合谁
不适合谁
怎么保养
```

避免绝对化：

> "实木一定比密度板好。"

改为：

> "如果你更看重耐用性、天然纹理和长期使用，实木更适合；如果预算有限、追求轻量和价格，板材可能更合适。"

------------------------------------------------------------------------

# 32. "我的方案"不是收藏夹

每个方案应该保存：

``` text
Room
+
Furniture
+
Transform
+
Try-on Image
+
3D Scene
+
Price Snapshot
+
Conversation Summary
```

例如：

``` text
方案：我家的奶油风客厅

沙发      ¥3980
茶几      ¥1280
电视柜    ¥1680

合计      ¥6940

试摆图
3D 场景
商品列表
阿杏推荐理由
```

------------------------------------------------------------------------

# 33. 到店体验

用户到店后：

店员 / 老板打开：

``` text
阿杏方案

用户预算：5000–7000
风格：奶油 / 现代
客厅：约 20㎡

已试摆：
✓ 沙发 A
✓ 沙发 B
✓ 茶几 C

最喜欢：
沙发 A

用户疑问：
“怕尺寸太大”
```

店员不需要重新问一遍。

这就是 Agent 带来的销售效率提升。

------------------------------------------------------------------------

# 34. 页面状态机

``` text
IDLE
 ↓
CHAT
 ↓
PHOTO_UPLOAD
 ↓
ROOM_ANALYSIS
 ↓
PRODUCT_SELECT
 ↓
TRY_ON_PROCESSING
 ↓
TRY_ON_RESULT
 ↓
SCENE_EDIT
 ↓
SAVE_PLAN
 ↓
BOOK_VISIT
 ↓
ORDER
```

任意状态都允许：

``` text
继续聊天
```

例如：

``` text
TRY_ON_RESULT

用户：
“换成第二个。”

→ PRODUCT_SELECT
→ TRY_ON_PROCESSING
→ TRY_ON_RESULT
```

不重新开始任务。

------------------------------------------------------------------------

# 35. Try-on UX

试摆结果页必须同时存在：

``` text
┌─────────────────────────────┐
│ [←] 试摆效果        保存    │
│                             │
│        房间 + 沙发           │
│                             │
│   [换一款] [尺寸] [旋转]      │
│                             │
│ ──────────────────────────  │
│ 阿杏头像                     │
│ “这个尺寸放你家比例比较合适” │
│                             │
│ [换颜色] [看3D] [对比]       │
│                             │
│ 继续说：“再换一个浅色的”     │
└─────────────────────────────┘
```

------------------------------------------------------------------------

# 36. 3D Viewer UX

Three.js 页面：

``` text
                 3D 家具
                    │
       ┌────────────┼────────────┐
       │            │            │
     旋转          缩放         移动
       │            │            │
       └────────────┼────────────┘
                    │
       材质 / 颜色 / 尺寸
                    │
           [搬进我的家]
```

------------------------------------------------------------------------

# 37. 3D 与 2D 的关系

不要让用户理解：

> "现在我要从 2D 切到 3D。"

而应该由阿杏自然引导：

> "如果你想看得更准，我可以给你打开 3D 版本。"

所以：

``` text
2D Try-on
   ↓
用户感兴趣
   ↓
“看 3D”
   ↓
Three.js
```

------------------------------------------------------------------------

# 38. 阿杏视觉规范

## 38.1 IP

素材：

-   **开心挥手的银杏女孩.png**
-   开心、亲和、可信；
-   半身；
-   面向用户；
-   手势以"邀请 / 展示 / 推荐"为主；
-   头发佩戴银杏叶发卡。

## 38.2 头像

必须使用同一 IP 的裁切版本：

``` text
axing_avatar_48
axing_avatar_64
axing_avatar_96
```

不能使用其他 AI 生成的人物替代。

## 38.3 色彩

主色：

``` text
杏色 / 暖橙 / 奶油白 / 深棕
```

建议 Design Tokens：

``` css
--axing-primary: #C96A2B;
--axing-orange: #E98B45;
--axing-cream: #FFF8EE;
--axing-bg: #FBF7F1;
--axing-text: #2F241D;
--axing-muted: #8E8177;
--axing-border: #E8DED3;
```

------------------------------------------------------------------------

# 39. 视觉层级

优先级：

``` text
1. 阿杏
2. 当前对话
3. 当前任务
4. 试摆结果
5. 商品
6. 功能入口
7. 底部导航
```

不要反过来。

------------------------------------------------------------------------

# 40. 前端目录

``` text
apps/
└── web/
    ├── app/
    ├── components/
    │   ├── chat/
    │   │   ├── ChatTimeline.tsx
    │   │   ├── ChatMessage.tsx
    │   │   ├── AxingAvatar.tsx
    │   │   └── VoiceInput.tsx
    │   │
    │   ├── cards/
    │   │   ├── UploadRoomCard.tsx
    │   │   ├── ProductCard.tsx
    │   │   ├── TryOnCard.tsx
    │   │   ├── SceneCard.tsx
    │   │   ├── MaterialCard.tsx
    │   │   └── BookingCard.tsx
    │   │
    │   ├── scene/
    │   │   ├── FurnitureViewer.tsx
    │   │   ├── RoomScene.tsx
    │   │   └── TransformControls.tsx
    │   │
    │   └── home/
    │       ├── HomeChat.tsx
    │       ├── QuickActions.tsx
    │       └── TryOnHeroCard.tsx
    │
    ├── lib/
    │   ├── api/
    │   ├── agent/
    │   ├── scene/
    │   └── voice/
    │
    └── types/
```

------------------------------------------------------------------------

# 41. 推荐前端技术栈

``` text
Next.js
React
TypeScript
Tailwind CSS
shadcn/ui（可选）
React Three Fiber
Three.js
Zustand
TanStack Query
WebSocket / SSE
```

## 状态管理

Zustand 负责：

``` text
chat state
scene state
user session
current product
try-on task
```

服务端数据：

TanStack Query。

------------------------------------------------------------------------

# 42. 后端架构

MVP：

``` text
Next.js / API
      │
      ├── Agent Runtime
      │
      ├── Product Service
      │
      ├── Scene Service
      │
      ├── Asset Service
      │
      ├── Pricing Service
      │
      └── Booking Service
```

数据层：

``` text
PostgreSQL
Object Storage
Redis（需要时）
Vector DB（知识库规模达到需求后）
```

------------------------------------------------------------------------

# 43. 推荐数据库

## PostgreSQL

保存：

-   Product
-   Inventory
-   Customer
-   Conversation
-   Scene
-   Design
-   Booking
-   Order
-   Asset metadata

## Object Storage

保存：

-   原始商品图片；
-   客厅照片；
-   Try-on 图片；
-   GLB；
-   Texture；
-   缩略图；
-   方案图片。

------------------------------------------------------------------------

# 44. API 设计

``` text
POST /api/chat
POST /api/voice/session
POST /api/images/upload
POST /api/room/analyze
POST /api/tryon
GET  /api/products
GET  /api/products/:id
POST /api/scenes
PATCH /api/scenes/:id
POST /api/assets/3d
POST /api/designs
POST /api/bookings
```

------------------------------------------------------------------------

# 45. Agent Runtime

推荐采用：

``` text
Streaming
+
Tool Calling
+
State
+
Task
+
Event
```

事件示例：

``` json
{
  "type": "tool_call",
  "tool": "generate_tryon",
  "status": "running"
}
```

随后：

``` json
{
  "type": "card",
  "cardType": "tryon",
  "payload": {}
}
```

------------------------------------------------------------------------

# 46. Event-driven UI

前端不要等待整个 Agent 完成再刷新。

使用：

``` text
message.delta
tool.start
tool.progress
tool.result
card.append
scene.update
voice.start
voice.end
```

例如：

``` text
阿杏：
“我先帮你找找～”

↓ 200ms

商品检索中…

↓ 800ms

找到 3 款

↓ 1.5s

[商品卡]

↓ 用户选择

正在把它搬进你家…

↓ 完成

[试摆卡]
```

------------------------------------------------------------------------

# 47. 性能目标

## 首屏

-   LCP \< 2.5s；
-   首屏 JS 尽可能控制；
-   阿杏 IP 图片 WebP/AVIF；
-   非首屏 3D 延迟加载。

## Chat

目标：

-   首 token \< 1.5s；
-   语音首响应 \< 1.5s；
-   UI 卡片流式出现。

## 3D

目标：

-   GLB 初始 \< 10MB；
-   首次进入 Viewer \< 3s；
-   后续同商品缓存命中。

------------------------------------------------------------------------

# 48. 图片 / 3D 资产优化

## 图片

``` text
Original
 ↓
WebP / AVIF
 ↓
Thumbnail
 ↓
CDN
```

## GLB

``` text
Raw Mesh
 ↓
Decimation
 ↓
Draco / Meshopt
 ↓
KTX2 Texture
 ↓
GLB
```

目标：

**视觉质量优先，体积第二。**

------------------------------------------------------------------------

# 49. MVP 范围

第一阶段不要做完整数字孪生。

## P0 必须做

``` text
✓ AI 聊天
✓ 语音
✓ 商品检索
✓ 商品卡
✓ 上传客厅
✓ 2D AI 试摆
✓ 保存试摆
✓ 预约到店
✓ 阿杏头像
✓ 首页聊天布局
```

## P1

``` text
✓ 商品自动上新
✓ 3D 家具
✓ Three.js Viewer
✓ 材质问答
✓ 我的方案
✓ 多家具方案
```

## P2

``` text
✓ RoomPlan
✓ LiDAR
✓ AR
✓ 3D 房间
✓ 全屋搭配
```

## P3

``` text
✓ Spatial Agent
✓ 自动理解整个家庭空间
✓ AI 自动调整家具布局
✓ 经营数据 Agent
✓ 门店数字化 OS
```

------------------------------------------------------------------------

# 50. 开发排期

## Week 1：UX + 基础骨架

``` text
Day 1
设计系统
阿杏 IP
首页布局

Day 2
Chat Timeline
Avatar
Message

Day 3
Try-on Hero Card
Quick Actions

Day 4
商品 Card
Voice Input

Day 5
前端状态机
API Contract
```

验收：

> 打开 App，用户 3 秒内理解"阿杏可以把家具搬进我家"。

------------------------------------------------------------------------

## Week 2：Agent + 商品

``` text
Product Schema
Product API
Search
Price
Inventory
Tool Calling
Chat Streaming
```

验收：

> 用户说一句话，可以返回真实商品，而不是模型编造商品。

------------------------------------------------------------------------

## Week 3：照片 + 2D 试摆

``` text
Upload
Room Analysis
Try-on
Image Storage
Result Card
Retry
Save
```

验收：

> 用户上传客厅 → 选择沙发 → 获得试摆结果。

------------------------------------------------------------------------

## Week 4：3D

``` text
GLB
Asset Registry
Three.js
R3F
Viewer
Transform
Material
Screenshot
```

验收：

> 用户可以旋转家具、查看尺寸、换材质。

------------------------------------------------------------------------

## Week 5：商家数字化

``` text
拍照上新
OCR
商品抽取
库存
采购单
价格
```

验收：

> 老板拍一张家具照片即可创建商品草稿。

------------------------------------------------------------------------

## Week 6：到店闭环

``` text
保存方案
分享
预约
店员端
客户需求摘要
```

验收：

> 用户线上完成方案 → 到店后店员可以直接继续服务。

------------------------------------------------------------------------

# 51. MVP Demo Script

正式演示不要展示几十个功能。

只展示一个完整故事：

``` text
1. 用户：
“阿杏，我想买一个 3000～5000 的沙发。”

2. 阿杏：
推荐 3 款。

3. 阿杏：
“拍张客厅，我帮你搬进去看看。”

4. 用户：
上传客厅。

5. 阿杏：
生成试摆。

6. 用户：
“第二个换进去。”

7. 阿杏：
再次试摆。

8. 用户：
“这个挺好，尺寸是多少？”

9. 阿杏：
回答真实尺寸。

10. 用户：
“我想看 3D。”

11. 阿杏：
打开 Three.js。

12. 用户：
“帮我保存。”

13. 阿杏：
生成方案。

14. 用户：
“周末去店里看看。”

15. 阿杏：
预约到店。
```

这就是完整闭环。

------------------------------------------------------------------------

# 52. 关键指标

## 用户侧

### Activation

首次打开后：

> 完成一次"上传客厅 + 试摆"。

### Core Conversion

``` text
照片上传率
→ 商品选择率
→ 试摆完成率
→ 保存方案率
→ 预约率
→ 成交率
```

## 商家侧

``` text
上新耗时
人工录入时间
库存准确率
询价响应时间
客户到店转化率
客单价
毛利率
库存周转率
```

------------------------------------------------------------------------

# 53. 最重要的产品指标

不要把：

> AI 回复次数

当成核心指标。

真正核心的是：

``` text
用户是否愿意把自己的家交给阿杏理解
                ↓
是否愿意上传照片
                ↓
是否完成一次试摆
                ↓
是否保存方案
                ↓
是否到店
                ↓
是否成交
```

因此 North Star Metric（北极星指标）建议：

> **每周完成"有效试摆"的家庭数。**

定义：

``` text
有效试摆 =
真实/有效房间照片
+
真实商品
+
完成一次可用试摆
+
用户停留或保存
```

------------------------------------------------------------------------

# 54. 安全与可信

家具电商不是高风险医疗场景，但仍有几个关键问题：

## 价格

不能幻觉。

## 尺寸

AI 生成图不代表真实尺寸。

UI 必须明确：

> "效果图仅用于视觉参考，实际尺寸以商品参数为准。"

## 材质

模型识别是建议，不是质检报告。

## 库存

必须来自库存系统。

------------------------------------------------------------------------

# 55. 失败降级策略

AI 系统一定会失败。

用户不应该看到：

> "500 Internal Server Error"

应该看到：

> "这次试摆没有成功，我再换一种方式帮你试一次～"

策略：

``` text
Try-on Provider A
      ↓ failed
Provider B
      ↓ failed
Fallback：商品抠图 + 简单合成
      ↓ failed
展示商品图 + 让用户继续选择
```

------------------------------------------------------------------------

# 56. Provider Abstraction

不要把模型厂商写死。

``` typescript
interface ImageTryOnProvider {
  generate(input: TryOnInput): Promise<TryOnResult>;
}

interface Furniture3DProvider {
  generate(input: AssetInput): Promise<AssetResult>;
}
```

实现：

``` text
OpenAI Image Provider
Other Image Provider

Rodin Provider
Object Capture Provider
```

这样切换模型只改变 Adapter（适配层）。

------------------------------------------------------------------------

# 57. 模型分层

``` text
                    A-Xing
                      │
            ┌─────────┼─────────┐
            │         │         │
           LLM      Vision     Voice
            │         │         │
        Reasoning   Room       ASR/TTS
            │
       Tool Calling
            │
      ┌─────┴─────┐
      │           │
    Image        3D
      │           │
   Try-on       Rodin
```

------------------------------------------------------------------------

# 58. 核心技术角色

  技术                产品角色
  ------------------- ------------------
  LLM                 阿杏的大脑
  Vision              看懂房间 / 商品
  Image Generation    2D 试摆
  Hyper3D Rodin       家具 3D 资产工厂
  Three.js            Web 3D 空间
  React Three Fiber   React 3D UI
  RoomPlan            iOS 房间结构
  LiDAR               空间深度
  ARKit               空间跟踪
  RealityKit          iOS 3D / AR
  PostgreSQL          业务数据
  Object Storage      图片 / GLB
  Agent Runtime       工具编排与状态

------------------------------------------------------------------------

# 59. 素材 Asset Spec

## Asset A

文件名：

**开心挥手的银杏女孩.png**

用途：

``` text
首页 Hero
AI 首次欢迎
空状态
推荐解释
试摆结果
语音状态
营销海报
```

要求：

-   保持人物一致；
-   保留银杏叶发卡；
-   保持开心挥手动作；
-   提供透明背景版本；
-   建议导出：
    -   PNG 原图
    -   WebP
    -   512px
    -   1024px
    -   2048px

## Asset B

文件名：

**阿杏AI家居导购界面.png**

用途：

-   首页 UI 视觉参考；
-   开发验收基准；
-   设计系统参考。

------------------------------------------------------------------------

# 60. 阿杏头像使用规范

``` text
AI 首次欢迎：
大头像 / 半身

普通消息：
48–64px

重要推荐：
64–80px

语音状态：
头像 + 波形

加载：
头像 + 呼吸动画

错误：
头像 + 温和解释
```

禁止：

-   随机换脸；
-   不同页面使用不同人物；
-   使用无银杏发卡版本；
-   AI 回复没有头像；
-   用户头像与阿杏头像混淆。

------------------------------------------------------------------------

# 61. 首页最终交互规则

### 用户进入首页

直接看到：

``` text
阿杏头像
↓
你好，我是阿杏～
↓
一句核心价值
↓
聊天示例
↓
上传客厅照片 Card
↓
快捷问题
↓
功能按钮
↓
输入框
```

### 用户点击上传

进入：

``` text
照片选择
↓
房间分析
↓
选择家具
↓
试摆
```

### 用户点击语音

不离开首页：

``` text
输入框
↓
Voice Mode
↓
阿杏实时对话
↓
商品 Card 插入聊天流
```

### 用户点击商品

不强制离开 Chat：

``` text
Product Card
↓
查看详情
↓
搬进我家
```

------------------------------------------------------------------------

# 62. 最终首页设计原则

一句话：

> **不要做一个"家具 App 首页"，要做一个"住在家具 App 里的阿杏"。**

页面应该让用户感觉：

> "我不是在操作一个复杂的软件，我是在和一个懂家具的人聊天。"

而所有复杂能力：

``` text
搜索
库存
价格
图片
3D
AR
知识库
推荐
订单
```

全部隐藏在阿杏背后。

------------------------------------------------------------------------

# 63. 最终产品架构

``` text
                         用户
                           │
                  语音 / 文字 / 图片
                           │
                           ▼
                     ┌──────────┐
                     │  阿杏 UI │
                     └────┬─────┘
                          Chat
                           │
                           ▼
                    ┌────────────┐
                    │ A-Xing Agent│
                    └──────┬─────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
     Product Tools     Scene Tools      Store Tools
          │                │                │
      商品 / 价格       房间 / 试摆       库存 / 订单
          │                │                │
          ├────────────┬───┴──────┬─────────┤
          ▼            ▼          ▼         ▼
       Vision       Image AI    Rodin     RoomPlan
          │            │          │         │
          ▼            ▼          ▼         ▼
       理解房间      2D试摆      3D家具    3D房间
          │            │          │         │
          └────────────┴────┬─────┴─────────┘
                            ▼
                       Scene / Plan
                            │
                     预约 / 到店 / 成交
```

------------------------------------------------------------------------

# 64. 产品长期演化

``` text
阶段 1
AI 家具导购
       ↓
阶段 2
AI 在线试摆
       ↓
阶段 3
3D Furniture
       ↓
阶段 4
3D Room
       ↓
阶段 5
AR Home
       ↓
阶段 6
Spatial Agent
       ↓
阶段 7
AI Furniture OS
```

最终不是：

> "AI 帮家具店生成图片。"

而是：

> **阿杏理解用户的家、理解家具、理解门店库存，并且可以在用户和真实商品之间完成从"看见"到"成交"的整个空间决策过程。**

------------------------------------------------------------------------

# 65. Final Definition

**阿杏 = Conversational Home Shopping Agent + Spatial Commerce
Interface + Furniture Store Digitalization Layer**

中文：

**阿杏 = 对话式家居导购智能体 + 空间电商交互层 +
传统家具店数字化操作层。**

核心体验只有一句：

> **"拍一张你家的照片，阿杏先把你喜欢的家具搬进去看看。"**

然后用户可以继续说：

> "换一个。"

> "这个大不大？"

> "给我看看 3D。"

> "换成米白色。"

> "我喜欢这个，帮我存起来。"

> "周末我去店里看看。"

这才是整个产品真正应该围绕构建的 Agent Loop：

``` text
看
↓
问
↓
试
↓
改
↓
比
↓
存
↓
到店
↓
买
```

------------------------------------------------------------------------

# 66. v2.1 首页视觉实现总 Spec

## 66.1 设计目标

首页不是传统家具商城，也不是普通 Chatbot。

目标体验：

```text
                    阿杏头像
                       ↓
                 持续 Chat Timeline
                       ↓
       “上传客厅照片，让阿杏把家具搬回家～”
                       ↓
              动态商品 / 试摆 Card
                       ↓
              功能按钮 / Quick Actions
                       ↓
                 Chat Input / Voice
                       ↓
                    Bottom Nav
```

**聊天窗口始终存在；功能按钮始终位于聊天区域下方；阿杏头像始终作为 AI 身份锚点。**

## 66.2 两个核心素材

### Asset A：阿杏角色

文件名：`开心挥手的银杏女孩.png`

用途：

- 首页 Hero / 首次欢迎；
- Chat Avatar；
- Voice 状态；
- Try-on 结果解释；
- 空状态；
- Loading / Processing；
- 宣传物料。

约束：

- 角色必须保持一致；
- 必须保留银杏叶发卡；
- 不允许使用随机 AI Avatar 替换；
- Avatar 与 Hero 必须来自同一角色资产；
- 优先提供透明背景 PNG + WebP/AVIF 派生版本。

### Asset B：首页参考图

文件名：`阿杏AI家居导购界面.png`

用途：

- 首页视觉基准；
- Screenshot-to-Code 参考；
- Visual Regression 基准；
- 设计 Token 反推参考；
- 最终 Demo 验收基准。

**不得把参考图直接作为整页背景来“伪装还原”。**

------------------------------------------------------------------------

# 67. DOM UI 与 WebGL 的职责边界

## 67.1 DOM / React 必须负责

```text
Header
ChatTimeline
ChatMessage
AxingAvatar
UploadRoomCard
ProductCard
TryOnCard
MaterialCard
SceneCard
QuickActions
VoiceInput
TextInput
BottomNavigation
Modal
Toast
Loading
Error
```

原因：这些元素需要可访问性、文本选择、响应式布局、事件处理、语义结构和 Agent 动态渲染。

## 67.2 Three.js / WebGL 负责

```text
RoomScene
FurnitureModel
Camera
Lighting
Shadow
Material
Transform
BoundingBox
Raycast
3D Dimension
360° View
Scene Screenshot
```

## 67.3 禁止事项

禁止使用 WebGL Canvas 绘制：

- 页面标题；
- Chat 文本；
- 商品价格；
- CTA 按钮；
- Bottom Navigation；
- 语音输入框；
- 阿杏文字气泡。

WebGL 是**空间渲染层**，不是**应用 UI 层**。

------------------------------------------------------------------------

# 68. Three.js / React Three Fiber 实现规范

## 68.1 推荐技术栈

```text
Next.js
React
TypeScript
Tailwind CSS
React Three Fiber
Three.js
@react-three/drei
Zustand
TanStack Query
```

R3F 的 `<Canvas>` 是 React 进入 Three.js 场景的入口，默认创建 Three.js WebGL Renderer，并支持 fallback；Three.js 当前 WebGLRenderer 使用 WebGL 2。

因此本项目采用：

```text
React
  ↓
React Three Fiber
  ↓
Three.js
  ↓
WebGL 2
```

## 68.2 Canvas 结构

```tsx
<RoomViewer>
  <Canvas fallback={<StaticRoomPreview />}>
    <CameraController />
    <Lighting />
    <Room />
    <FurnitureModel />
    <TransformControls />
  </Canvas>
</RoomViewer>
```

## 68.3 3D 资源格式

统一以 **glTF 2.0 / GLB** 作为运行时家具资产标准。

原因：

- 跨平台；
- 适合 Runtime Delivery；
- 支持 PBR；
- 支持材质、节点、相机、动画等；
- Web / iOS / AR / 后续其他 3D Runtime 都可以复用。

Three.js 使用 `GLTFLoader` 加载 GLB/glTF，并可接入 Draco、Meshopt、KTX2 等压缩能力。

## 68.4 不在首页默认加载完整 3D

首页：

```text
DOM UI
 ↓
Chat
 ↓
Upload Card
 ↓
Try-on
 ↓
用户主动点击“3D”
 ↓
Lazy-load WebGL
 ↓
GLB
 ↓
Scene
```

这是性能和产品体验的共同约束。

------------------------------------------------------------------------

# 69. 首页 Screenshot-to-Code / Visual QA 工作流

## 69.1 目标

不是：

> “让 AI 写一个差不多的页面。”

而是：

> **让 Coding Agent 通过截图、渲染、截图对比不断逼近视觉基准。**

## 69.2 标准循环

```text
阿杏AI家居导购界面.png
        ↓
Reference Analysis
        ↓
Layout Extraction
        ↓
DOM Implementation
        ↓
CSS / Tailwind
        ↓
Browser Render
        ↓
Playwright Screenshot
        ↓
Image Diff
        ↓
找出差异
        ↓
修正 CSS / Layout
        ↓
再次 Screenshot
```

## 69.3 必须比较的指标

```text
Viewport
Header height
Avatar position
Chat width
Card width / height
Padding
Margin
Border radius
Typography
Line height
Icon size
Input height
Bottom nav height
Background color
Shadow
Image crop
```

## 69.4 验收原则

开发人员不能只说：

> “肉眼看起来差不多。”

必须至少完成：

1. 目标设备截图；
2. 与 Reference Screenshot 对比；
3. 修正主要布局差异；
4. 再次截图；
5. 通过视觉验收。

------------------------------------------------------------------------

# 70. 首页最终布局 Spec v2.1

```text
┌───────────────────────────────┐
│ ☰             阿杏        ⋯ │
├───────────────────────────────┤
│                               │
│       [阿杏半身 / 头像]       │
│                               │
│       你好，我是阿杏～        │
│       提前把家具搬到你家      │
│                               │
│  ┌─────────────────────────┐  │
│  │ 上传客厅照片             │  │
│  │ 让阿杏提前把喜欢的家具   │  │
│  │ 为您搬回家～              │  │
│  │                         │  │
│  │       [拍照 / 相册]      │  │
│  └─────────────────────────┘  │
│                               │
│  [AI Chat Message]            │
│  [Product Card]               │
│  [Try-on Card]                │
│                               │
│  ───── 功能按钮 ─────         │
│  [拍照试摆] [语音导购]         │
│  [浏览家具] [我的方案]         │
│                               │
├───────────────────────────────┤
│  ● 发消息或按住说话   ＋ 📷  │
├───────────────────────────────┤
│ 首页  商品  3D  方案  我的    │
└───────────────────────────────┘
```

### 70.1 核心不变式

**聊天窗口始终在页面上。**

**功能按钮永远位于 Chat 之后、Input 之前。**

**阿杏头像必须与 AI 消息绑定。**

**“上传客厅照片”是首页第一业务 CTA。**

------------------------------------------------------------------------

# 71. 首页状态机

```text
HOME_IDLE
   ↓
USER_UPLOAD_ROOM
   ↓
ROOM_ANALYZING
   ↓
PRODUCT_RECOMMENDATION
   ↓
TRYON_GENERATING
   ↓
TRYON_RESULT
   ├── 换一个 → PRODUCT_RECOMMENDATION
   ├── 看 3D → SCENE_LOADING
   ├── 保存 → PLAN_SAVED
   └── 预约 → BOOKING

SCENE_LOADING
   ↓
SCENE_READY
   ↓
USER_EDIT_SCENE
   ↓
SAVE_PLAN
```

任何状态都不能让用户失去 Chat。

例如用户正在看 3D 时仍可以说：

> “阿杏，这个换成米白色。”

Agent 通过 `change_material` 修改 Scene State，而不是重新开始任务。

------------------------------------------------------------------------

# 72. Scene State 与 Agent Tool 的正式接口

```typescript
type SceneOperation =
  | { type: "move_furniture"; objectId: string; position: [number, number, number] }
  | { type: "rotate_furniture"; objectId: string; rotation: [number, number, number] }
  | { type: "scale_furniture"; objectId: string; scale: [number, number, number] }
  | { type: "change_color"; objectId: string; color: string }
  | { type: "change_material"; objectId: string; materialId: string }
  | { type: "replace_furniture"; objectId: string; productId: string }
  | { type: "focus_object"; objectId: string };
```

Agent 不直接操作 Three.js API。

必须：

```text
LLM / Agent
   ↓
Scene Tool
   ↓
Scene State
   ↓
React
   ↓
R3F
   ↓
Three.js
```

这样可以避免 Agent Runtime 与前端渲染引擎强耦合。

------------------------------------------------------------------------

# 73. 3D Asset 性能预算

## MVP 建议

单件家具：

- 优先压缩后的 GLB；
- 移动端优先；
- 避免首页预加载；
- 纹理优先 KTX2 / GPU-friendly compression；
- 根据设备动态选择 LOD。

## Asset Pipeline

```text
Raw Model
 ↓
Mesh Optimization
 ↓
LOD
 ↓
Draco / Meshopt
 ↓
Texture Resize
 ↓
KTX2 / WebP fallback
 ↓
GLB
 ↓
CDN / Object Storage
```

不要把“原始高精度模型”直接发给手机浏览器。

------------------------------------------------------------------------

# 74. WebGL Progressive Enhancement

## Desktop / High-end Mobile

```text
2D Try-on
 ↓
3D Viewer
 ↓
Interactive Scene
```

## 普通移动设备

```text
2D Try-on
 ↓
轻量 3D Viewer
 ↓
减少阴影 / 后处理
```

## WebGL 不可用

```text
2D Try-on
 ↓
Static Preview
 ↓
继续 Chat
```

**无论 WebGL 是否成功，用户都必须可以继续完成购买决策。**

------------------------------------------------------------------------

# 75. v2.1 前端目录更新

```text
apps/web/
├── app/
│   ├── page.tsx
│   ├── chat/
│   ├── product/
│   ├── scene/
│   └── plan/
│
├── components/
│   ├── chat/
│   │   ├── ChatTimeline.tsx
│   │   ├── ChatMessage.tsx
│   │   ├── AxingAvatar.tsx
│   │   ├── AxingHero.tsx
│   │   └── VoiceInput.tsx
│   │
│   ├── cards/
│   │   ├── UploadRoomCard.tsx
│   │   ├── ProductCard.tsx
│   │   ├── TryOnCard.tsx
│   │   ├── SceneCard.tsx
│   │   ├── MaterialCard.tsx
│   │   ├── PlanCard.tsx
│   │   └── BookingCard.tsx
│   │
│   ├── home/
│   │   ├── HomeShell.tsx
│   │   ├── HomeChat.tsx
│   │   ├── TryOnHeroCard.tsx
│   │   ├── QuickActions.tsx
│   │   └── BottomNavigation.tsx
│   │
│   └── scene/
│       ├── RoomViewer.tsx
│       ├── RoomScene.tsx
│       ├── FurnitureModel.tsx
│       ├── CameraController.tsx
│       ├── Lighting.tsx
│       ├── TransformControls.tsx
│       └── SceneFallback.tsx
│
├── lib/
│   ├── agent/
│   ├── api/
│   ├── scene/
│   ├── assets/
│   ├── visual-qa/
│   └── voice/
│
└── public/
    ├── assets/axing/
    ├── furniture/
    └── rooms/
```

------------------------------------------------------------------------

# 76. v2.1 开发排期调整

## Week 1：视觉还原 + Chat Shell

```text
1. 导入“开心挥手的银杏女孩.png”
2. 导入“阿杏AI家居导购界面.png”
3. 建立视觉 Token
4. React 首页骨架
5. Chat Timeline
6. Avatar
7. Upload Room Card
8. Quick Actions
9. Voice Input
10. Browser Screenshot QA
```

验收：**首页截图与参考图达到视觉一致级别。**

## Week 2：Agent + 商品

```text
商品数据
搜索
价格
库存
Product Card
Context / Tool Calling
```

## Week 3：Room Photo + 2D Try-on

```text
Upload
Room Understanding
Product Selection
Try-on
Result Card
Retry / Fallback
```

## Week 4：Three.js / 3D

```text
R3F
WebGL capability detection
GLB loading
Camera
Lighting
Material
Transform
Scene State
Scene Tool
```

## Week 5：家具数字资产工厂

```text
商品照片
 ↓
抠图
 ↓
Image-to-3D
 ↓
Rodin / Other Provider
 ↓
GLB QA
 ↓
Asset Registry
```

## Week 6：到店闭环

```text
Save Plan
Share
Booking
Store View
Lead
Order
```

## Week 7+：App / Spatial

```text
iOS
RoomPlan
LiDAR
ARKit
RealityKit
Spatial Agent
```

------------------------------------------------------------------------

# 77. v2.1 验收标准

## P0

- [ ] 首页 Chat 永远存在；
- [ ] 阿杏头像正确；
- [ ] 首页使用 `阿杏AI家居导购界面.png` 作为视觉基准；
- [ ] “上传客厅照片，让阿杏提前把喜欢的家具为您搬回家～”为核心 CTA；
- [ ] 功能按钮位于 Chat 下方；
- [ ] 语音不离开 Chat；
- [ ] Product Card 可以直接触发 Try-on；
- [ ] Try-on 失败有降级路径；
- [ ] 3D 不阻塞首屏；
- [ ] WebGL 不可用时仍可继续购物。

## P1

- [ ] Three.js / R3F Viewer；
- [ ] GLB / glTF；
- [ ] 家具旋转 / 缩放 / 移动；
- [ ] 换颜色 / 材质；
- [ ] Scene State 可保存；
- [ ] Agent 可以通过 Tool 修改 Scene。

## P2

- [ ] RoomPlan；
- [ ] LiDAR；
- [ ] AR；
- [ ] 多家具空间编辑；
- [ ] 全屋方案。

------------------------------------------------------------------------

# 78. 技术参考与依据

- Three.js `WebGLRenderer` 当前使用 WebGL 2：
  https://threejs.org/docs/pages/WebGLRenderer.html

- Three.js `GLTFLoader`：
  https://threejs.org/docs/pages/GLTFLoader.html

- React Three Fiber Canvas：
  https://r3f.docs.pmnd.rs/api/canvas

- Khronos glTF Runtime 3D Asset Delivery：
  https://www.khronos.org/gltf/

- Khronos glTF 2.0 Specification：
  https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html

- Khronos 2025 Commerce-ready glTF Asset Creation Guidelines 2.0：
  https://www.khronos.org/blog/introducing-asset-creation-guidelines-2.0-siggraph-2025

备注：Khronos 在 2026 年提出 glTF 2.1 的复杂场景方向，但本项目当前运行时资产标准仍以稳定的 glTF 2.0 / GLB 为基线，不把尚未成熟的规范当成 MVP 强依赖。

------------------------------------------------------------------------

# 79. v2.1 最终技术结论

### 前端

**React + Next.js + TypeScript + Tailwind + React Three Fiber + Three.js**

### UI

**DOM / CSS First**

### 3D

**Three.js / WebGL 2**

### 3D Asset

**glTF 2.0 / GLB**

### AI Try-on

**2D Image Editing / Generation First**

### Furniture 3D

**Hyper3D Rodin / 可替换 3D Provider**

### Mobile Spatial

**RoomPlan + LiDAR + ARKit + RealityKit**

### Agent

**Agent Runtime → Tool Contract → Scene State → UI**

### Visual QA

**Reference Screenshot → Browser Render → Screenshot → Diff → Refine**

最终原则：

> **阿杏不是一个用 WebGL 做出来的网页，而是一个由 Agent 驱动、以 Chat 为主界面、以 2D Try-on 为即时决策层、以 Three.js 3D Scene 为空间交互层、最终连接到真实家具库存和门店成交的 Spatial Commerce 产品。**

