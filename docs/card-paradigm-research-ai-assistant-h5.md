# H5「卡片交互范式」调研报告 —— 供「无框架原生 ES Module」项目移植参考

> 调研对象：`/Users/linan/Desktop/aicode/grid-ar-glasses/ai-assistant-h5`（Vue 3 + Vite 8 + Vant 4 + vue-router 5）
> 目标项目：阿杏 AI 家居导购助手（`/axing`，铁律：不引框架、纯 HTML + 原生 ES Module + CSS）
>
> **可信度约定**：
> - `【文档】` = AGENTS.md / JSAPI.md / local/H5前端使用文档.md / docs/superpowers/plans/* 里明确写了
> - `【代码】` = 我从源码直接读出的实现（可靠，但非文档化）
> - `【推断】` = 我结合上下文推断的设计意图（需二次确认）

---

## 0. 一句话结论（先看这个）

「卡片」不是 UI 组件库意义上的卡片，而是**「后端 Agent 在 SSE 流里按序推送的结构化内容单元，每种 unit 对应一个前端模板组件」**。前端是一个 `templateId → 组件` 的注册表 + 一条会把流切成「前置卡 / 文本 / 工具卡」三段 emit 的状态机。移植到原生 JS 时，**范式（注册表 + contentList 顺序 emit + chunkId 增量订阅）可以 100% 照搬，Vue 的部分（响应式、动态组件、import.meta.glob）要换机制**。

---

## A. 卡片范式的定义

### A1. 「一套卡片」是什么 `【代码】`

一套卡片 = `src/template/resources/<业务域>/<卡片名>.<s|m>.vue`，按业务域分目录：

| 域 | 目录 | 数量 | 加载 | 用途 |
|---|---|---|---|---|
| base | `src/template/resources/base/` | 7 | `.s.vue` **同步 eager** | markdown / plainText / plainImage / greetings / suggestions / markdown-card / fallback |
| electric | `src/template/resources/electric/` | 16（含 2 个 `.data.js`/`.images.js` 纯函数模块） | `.m.vue` **异步 lazy** | 电力巡检全套：任务列表、检查项、缺陷检测、导航、报告预览… |
| income | `src/template/resources/income/` | 4 | `.m.vue` 异步 | 收入概览、汇总、对比、无结果 |
| flame | `src/flame/FlameCard.vue` | 1 | **条件编译** `#v-ifdef` | 服务端下发的动态卡片容器（`@ynet/card`） |

> 域数量表在 AGENTS.md「卡片类型速查」`【文档】` 里写的是 base 7 / electric 14 / income 3 / flame 1；实际 electric 目录 16 个文件、income 4 个，是后续迭代增量 `【推断】`。

**卡片 = 一个 `.vue` 文件 = 一个 templateId。** 文件名即组件名即 templateId：`importLoader` 把 `electric-task-list.m.vue` 解析成组件名 `electric-task-list`（`src/lib/importLoader.js:14-42`）；目录形式 `income-totalBalance/index.m.vue` → 组件名取父目录 `income-totalBalance`（`importLoader.js:24-26`）。

### A2. 注册与路由到组件 `【代码】`

```js
// src/template/registry.js
allTemplates = [
  { name:'FlameCard', component: asyncComponent(...) },        // 条件编译
  ...importLoader(import.meta.glob('./resources/**/*.m.vue', { eager:false })),  // 异步
  ...importLoader(import.meta.glob('./resources/**/*.s.vue', { eager:true  })),  // 同步
].map(e => [e.name, e.component])   // → Object.fromEntries → Map<name, component>
```

「templateId → 组件名」的三级 Fallback 在 `src/core/hooks/useChat.js:77-89`：

```js
getTemplateType(data) {
  if (displayResponseType === 'MARKDOWN') return 'markdown'
  if (displayResponseType === 'TEXT' || 'ERROR') return 'plainText'
  return templateIdAlias[data.templateId] || data.templateId   // alias.json → 原名
}
```

`src/template/alias.json` 只做两件事（后端 templateId ≠ 前端组件名时的桥接）：
```json
{ "greetingscenerio": "greetings", "conversationSuggestions": "suggestions" }
```

渲染时再兜底一次 `【代码】`（`src/views/chat/message/index.vue:212-226`）：注册表查不到 → 若 `templateId` 在 Flame 的 `cardCodes` 白名单里则走 `FlameCard` → 否则渲染 `fallback`（`base/fallback.s.vue` 显示「不支持当前卡片类型」+ JSON 原文）。

### A3. 卡片的统一结构 `【代码】`

**没有基类，靠 mixin 模拟**（AGENTS.md 自己列为「待改进：模板 Mixin 隐式依赖，耦合度高」`【文档】`）：

- `src/template/mixins/common/props.js` 定义 **12 个统一 props**，这就是事实上的卡片基类接口：
  `isClient / isAppEnv / animated / index / dataSource / requestAI / userInfo / appendCard / messageParser / eventBus / eventEnums / scrollToBottom / autoVoiceReading`
- `src/template/mixins/common/index.js` = props + `mounted() { if(!this.animated) this.scrollToBottom() }` + 格式化方法（formatMoney / maskCardNo / rateToPercent / dataParser…）
- `src/template/mixins/common/request.js` 和 `route.js` **是空对象**（被注释掉）→ 卡片自己不许直接发请求，只能通过注入的 `requestAI` / `appendCard` 反压回聊天内核 `【推断：这是刻意的权限收缩】`

**每条「消息」的统一 schema**（`useChat.js:127-138` messageParser 产出）：
```js
{ isClient, hidden, renderIndex, msgId, chunkId, type, originTemplateId, data }
```
`type` = 组件名；`data` 是塞给卡片的 `dataSource`。卡片内部再从 `dataSource.kvMap` 取内容、`dataSource.dataResponse` 取动作 `【代码】`。

**卡片自身视觉结构**：没有统一的 header/body/footer 基类，每张卡自己写。但收敛出了三条约定 `【代码】`：
1. **全宽**：卡片根节点一律 `width: 100%`（`electric-task-list.m.vue:105`、`fallback.s.vue:36`）——AI 富内容卡不是气泡，是通栏卡
2. **三件套外框**：`background: rgba(255,255,255,.5)` + `border: 1px solid #fff` + `box-shadow: var(--app-highlight-inset-shadow)` + `border-radius: var(--app-card-radius)`
3. **右上/左下圆角归零** 只发生在 `plainText`/`plainImage` 这类「真气泡」上（`plainText.s.vue:135-146`：server 消 `border-top-left-radius`，client 消 `border-top-right-radius`）

### A4. 组合 / 嵌套 / 轮换 `【代码】`

- **组合**：一次响应 = 一个 `contentList` 数组，`useChat.messageParser` 逐项 push 成多条消息（`useChat.js:97-121`），渲染层按 `renderIndex` 排动画延迟。→ **一张卡一条 row，横向不并排，纵向堆叠**
- **顺序控制**（`src/core/adapter/stream.js:387-455`）：`message_output_end` 时按「**阶段1 前置卡 → 阶段2 文本 → 阶段3 普通卡**」三段 emit。前置白名单硬编码：`PREPEND_TEMPLATE_IDS = ['electric-greetings']`（`stream.js:484`），注释明说是 `[HACK]`——问候卡要在文字上面
- **嵌套**：`markdown-card.s.vue` 是纯粹的包装组件，转发到 `markdown.s.vue`（`markdown-card.s.vue:1-31`），做 `kvMap` 拍平
- **轮换**：`suggestions` 卡片被 `clearSuggestion()` 一次性隐藏（`useChat.js:45-49`：把历史 `type==='suggestions'` 的消息 `hidden=true`），实现「推荐问题只显示最新一组」`【代码】`

---

## B. 交互范式

### B1. 用户操作路径 `【代码】`

```
输入源（4 个）                ── 统一收敛到 useChat.requestAI(params, silent, hideQuery)
 ├ 键盘输入 / 回车            (views/chat/skeleton/chatSenderMobile/index.vue:258)
 ├ 按住说话（startListen）     (chatSenderMobile:290-347)
 ├ 眼镜语音 glassStartListening(chatSenderMobile:378-397)
 ├ 拖图 / 选图 / 眼镜拍照      (skeleton/index.vue:238-248, views/chat/index.m.vue:236)
 └ 卡片上的按钮/推荐语         (suggestions.s.vue:40, greetings.m.vue:50)
        ↓
useChat.requestAI → pushMessage(用户消息) → api.chatQuery
        ↓
rpc('agentStreamChatA', { ResponseMode:'streaming' })  → SSE / jsBridge keepCallback
        ↓
StreamParser（Web Worker）→ onReadStream → useChat.callback
        ↓
messageParser → pushMessage(AI 卡片们) → <component :is> 渲染
```

**「说一句话 → 系统回一串卡片」对话式 = 是**，但关键细节：**卡片不是渲染在气泡里，而是渲染成独立的全宽 row**（`views/chat/message/index.vue:1-44` 每条消息一个 `.msg-row`，只有 `isClient` 时 `justify-content: flex-end`）。

### B2. 卡片如何响应用户输入 `【代码】`

四种机制，按推荐度排序：

1. **`requestAI({keywords})` —— 卡片即下一个问题**（最主流）。推荐语卡、欢迎语卡的选项按钮都走这条（`suggestions.s.vue:39-43`、`greetings.m.vue:49-53`）。好处：前端 0 业务逻辑，按钮文字就是 query
2. **`templateId === 'actionTrigger'` 动作分发**（`useChat.js:57-75` actionTrigger）：
   | actionType | 行为 |
   |---|---|
   | `commonHandleClick` | `jsapi.pushWindow(actionParams.clickUrl)` 跳页 |
   | `clientAction` | `eventBus.emit('action.client')` → postmate 跨 WebView 回宿主 App（`views/chat/index.m.vue:313-319`） |
   | `takePhoto` | `eventBus.emit('action.takePhoto')` → 开取景器 |
   | `sendQuery` | `eventBus.emit('action.sendQuery')` → `waitForIdle` 后 requestAI |
   | 默认 | `eventBus.emit('action.trigger')` |
   
   `【推断】` 这就是「后端驱动前端行为」的 RPC 化设计——卡片可以在流里命令前端跳页/拍照/再发问。
3. **卡片内部本地 state**：`income-overview.m.vue` 的眼睛（显隐金额）、tab 切换、`animateNumber` 数字滚动，纯前端 `【代码】`
4. **`$emit` 向上抛**：`electric-transfer.m.vue:66`、`electric-completion-confirm.m.vue:72` 等，但 `message/index.vue` 模板里**没有监听这些事件** → `【推断】` 是预留/半成品，移植时可以不做

### B3. 卡片状态与降级 `【代码】`

| 状态 | 实现位置 | 说明 |
|---|---|---|
| 加载中（流级） | `constants/enums.js: streamResEnums` = `idle/thinking/GENERATING` | `message/index.vue:39-43` 在列表底部插一个 `plain-text + stream-spinner`（「正在思考中」+ wave 动画） |
| 加载中（卡片级） | `lib/importLoader.js:5-12` `asyncComponent({loadingComponent: loadingSpinner, delay:200, timeout:30000})` | 异步卡 200ms 后才显 spinner，防闪烁 |
| 失败（卡片级） | `lib/importLoader.js` `errorComponent: loadError`（`components/loadError.vue`「加载异常」） | 组件加载失败即替换 |
| 失败（流级） | `stream.js:346-342` errorCode≠'0' → `streamStatus=ERROR` + `stateMessageTrigger`；`useChat.checkStreamStatus:180-220` 按 `TIMEOUT/NETWORK/ABORT/default` 分派 toast + `abortResponse` | toast 文案集中在 `constants/enums.js errorTextEnums` |
| 空 | `template/resources/income/no-search-result.m.vue` | 「无结果」也是一张卡，且带一个可点跳转的 action-card |
| 未知/兜底 | `base/fallback.s.vue` | 渲染「不支持当前卡片类型」+ `JSON.stringify(dataSource)` + textStreamTool |
| 流式中 md 降级 | `base/markdown.s.vue:10-11` | **流式期间不渲染 markdown，降级成 `<pre>` 纯文本**，`chunkStatus===END` 才切真 md。`【代码】` |
| Worker 降级 | `stream-bridge.js:82-139` | Worker 创建失败或异常 → 主线程 `StreamParser`；已推送过则报 `WORKER_ERROR` 而不是降级 |
| Flame 降级 | `flame/FlameCard.vue:11-13` | 动态卡 `bLoading`/`bError` 切 spinner/loadError |

> `【推断】` 移植启示：**「降级」被拆成了 5 层**（流级 / 卡级 / md 级 / worker 级 / 动态卡级），每层各自兜底、互不依赖。这是这套范式最值得抄的工程品味。

---

## C. 会话与用户体系（重点）

### C1. 创建会话 `【代码】`

入口 `src/core/api/chat.js:221-260 chatQuery()`：

```js
const id = storage.session.get(CURRENT_CONVERSATION_ID)   // '__AI_AGENT_CURRENT_CONVERSATION_ID__'
if (id) startConversation({id, ...})                       // 复用
else    createConversation().then(res => startConversation({id: res.Conversation.AppConversationID, ...}))
```
- **懒创建**：第一次提问时才建，不预建 `【代码】`（`core/api/chat.js:243-259`）
- **createConversation 入参**（`core/api/chat.js:79-94`）：`{ AppKey, BotId, UserID, QueryExtends:{}, Inputs: getAgentExtraParams(data, params) }`
  - `Inputs` 由 `core/config/index.js:29-43` 生成：`global_param_name / loginStatus / CifSeq(游客码 or 客户码) / CifNo / sex / AppConversationID / AppUserID`
- **出参**：取 `res.Conversation.AppConversationID` → 写 **sessionStorage**（`chat.js:100-124`，带大量 console.info 埋点，明显是为排查会话丢失加的 `【推断】`）
- **UI 变化：没有任何变化**。建会话是纯后台的，界面上无「新会话」动效、无 toast `【代码】`

### C2. 切换会话 `【代码】——本项目没有这个功能`

- 全仓 grep `conversation`，UI 层唯一相关入口是 `views/settings/index.m.vue:129-132` 的「**清除对话上下文**」：`storage.session.remove(CURRENT_CONVERSATION_ID)`
- `core/preload.js:20-39`：原生 App 可通过 `document.on('clearAgentContext')` 事件要求 H5 清会话
- `deleteConversation` 已定义（`core/api/chat.js:25-38`）但**前端无任何调用点** `【代码】`（grep 确认）
- `【推断】` 产品形态 = **单会话制**（一个设备/一次进店 = 一个会话），换会话 = 清空重来。阿杏若要「历史会话列表」，这是**新增能力，不是移植**

### C3. 用户系统 `【代码】`

`src/core/adapter/jsapi/user.js`：

```js
getUserData() = getDeviceFingerprint() + getUserInfo() 合并：
  - 有 userInfo.userNo  → { ...userInfo, deviceID, conversationUserId, conversationId, agentLoginStatus: 1 }   // 登录
  - 否则                → { ...getVisitorUserInfo(), deviceID, conversationUserId, conversationId }           // 游客
```
- **设备指纹** = localStorage `__AI_AGENT_DEVICE_ID__`；App 走 `jsBridge.call('getDeviceFingerprint')`，Web 直接返回常量 `'LOCAL_DEBUG_DEVICE'`（`user.js:36-41`）
- **游客身份 ID** = localStorage 里的一个 UUID `__AI_AGENT_CONVERSATION_USER_ID__`（`core/config/index.js:45-52`），游客 `agentLoginStatus: 0`、`customerName: '游客'`
- **登录**：`handleLogin()` 是 `Promise.resolve({})` 空实现（`user.js:44-46`）；真登录由 App 原生做，H5 只读 `sessionStorage __AI_AGENT_USER_INFO__`；`saveUserInfo` 写 `RPC_TOKEN` + `USER_INFO`（`user.js:83-91`）
- **会话归属**：`UserID = conversationUserId`（设备指纹 or 游客 UUID），`AppConversationID` 是会话。→ **会话挂在「身份」上，不挂登录态**，游客也有完整会话 `【代码】`
- **未登录可用程度**：除 Glass 系列（拍照/字幕/设备，Web 端直接 reject）外全可用。AGENTS.md「游客模式和登录模式」`【文档】`

### C4. 历史消息存哪 `【代码】`

- **前端不存消息**。`useChat.messages = ref([])` 纯内存；`onBeforeUnmount` / `CHAT.RESET` 即清空（`views/chat/index.m.vue:192-195, 393`）
- 持久化的只有 4 样：会话 ID（session）、设备/用户 ID（local）、对话高度缓存（session，`views/chat/message/heightCache.js`，LRU 200 + `chat_height_cache`）、动态卡缓存（session，`FLAME_CARD_DATA`）
- `【推断】` 历史对话**完全由后端持有**，前端刷新 = 从零开始。移植时阿杏若要做「我的方案/预约记录」，得自己加前端存储或后端接口

---

## D. 前端架构

### D1. 状态管理：没有 Vuex / Pinia `【文档 + 代码】`

AGENTS.md「状态管理 - 使用 Vue 3 响应式 API 进行状态管理；复杂逻辑封装在自定义 Hooks 中（如 useChat）；使用事件总线（eventBus）进行跨组件通信」，且「待改进：状态管理分散，useChat ~300 行承担过多职责，建议引入 Pinia」

三层 `【代码】`：
| 层 | 载体 | 内容 |
|---|---|---|
| 全局可变 | `sessionStorage`/`localStorage` | 会话 ID、用户、AppKey、字号比例、Flame 缓存 |
| 单一 store | `src/core/hooks/useChat.js`（ref 集合） | `messages / responseStatus / querySilent / currentRequestUid / currentResponseId / latestQuery` |
| 跨组件事件 | `src/core/event/` | eventBus + eventEnums，**`emit` 実現 = `window.dispatchEvent(new CustomEvent(name,{detail}))`**（`core/event/eventBus.js:1-20`） |

eventEnums 全集（`core/event/index.js`，文档 AGENTS.md 有同款速查）：
```
MESSAGE: CHANGE / CHECK_ERROR        LOGIN: SUCCESS        MOMENT: UPDATE
ROOT_SIZE: CHANGE                    CREDIT_CARD: HIDE
ACTION: TRIGGER / TAKE_PHOTO / CLIENT / SEND_QUERY / PAUSE_MIC_AUDIO
CHAT: REQUEST / RESET / ABORT / TEXT_STREAM_END / GREETING_SUBTITLE
DEVICE: CONNECTED                    MOCK: SPINNER / LOADED
```
> **移植利好**：eventBus 本质就是 window CustomEvent，原生 JS 零成本照搬（注意 `core/event/overwrite.js` 把 `window.on/off` 猴补丁成「同 id 先摘旧监听」，直接 addEventListener 的项目要注意重复绑定）。

### D2. 请求层 `【代码】`

统一入口 `rpc(url, params, { beforeHooks, onReadStream, timeout, processError })`（`core/adapter/jsapi/request.js:78-247`），四通道自动选择：

| 通道 | 条件 | 实现 |
|---|---|---|
| Mock | `VITE_MOCK_ON==='1'` | `mockRpc`，1s 假延迟，数据来自 `src/template/mock/` |
| App SSE | `isApp && ResponseMode==='streaming'` | `jsBridge.rpc(url, params, {keepCallback})` 逐 chunk 回调 |
| App 普通 | `isApp && !streaming` | `jsBridge.rpc` 单次 |
| Web SSE | `!isApp && streaming` | `sse.js` + `fetch`（`core/adapter/fetch.js:87-124`） |
| Web 普通 | `!isApp && !streaming` | `fetch`（`fetch.js:126-133`） |

错误处理 `【代码】`：`resHeaderData.errorCode` 不在 `['000000','0']` → `showFailToast` + reject（`fetch.js:149-152`）；`bodyOutData` 可能是字符串需二次 `JSON.parse`（`fetch.js:128-132`）。流式错误码另有一套：`abortTypeEnum = TIMEOUT/ABORT/NETWORK`（`stream.js:37-41`）+ Native 网络码集合 `['10','5000','14016']` 和正则兜底（`jsapi/request.js:18-42`）。**无自动重试** `【代码】`。

### D3 路由 `【代码】`

`src/router/index.js`：`import.meta.glob('../views/**/*.m.vue')` 文件即路由，路径由目录驼峰化生成。
- App（UA 含 `ynetBank`）用 `createMemoryHistory`，Web 用 `createWebHashHistory`（`router/index.js:34-38`）
- `/` → `views/redirect.js`，`/:pathMatch(.*)*` 也 redirect
- `【推断】` 移植时用 hash 路由即可；唯一的「路由感」来自 `jsapi.pushWindow`（卡片 action `commonHandleClick` 会跳原生/H5 页）

### D4. 渲染性能策略（移植价值最高的一块）`【代码 + 文档】`

| 策略 | 位置 | 做法 |
|---|---|---|
| Web Worker 分流 | `core/adapter/stream-bridge.js` + `stream-worker-entry.js` | SSE 的 JSON.parse / 状态机在 Worker，主线程只收 `CHUNK` 消息 |
| 同型消息合并 | `stream.js:171-201` | 连续 `event==='message'` 的 answer 字符串拼接，队列上限 120 条强制合并 |
| RAF 分帧 | `stream.js:243-261` | 每帧只处理 1 条，保 UI 不卡 |
| 对象复用 | `stream.js:580-612` | TEXT/MARKDOWN 预建 `_textData`，token 只改 `textResponse` 字段 |
| `chunkId` 事件订阅 | `plainText.s.vue:93-104`、`markdown.s.vue:194-204` | 每条消息 `eventBus.on(chunkId, cb)`，**只让这一条消息重绘，不重绘整个列表** |
| CSS contain | `plainText.s.vue:133`、`markdown.s.vue:221`、`plainImage.s.vue:69` | `contain: layout style paint` 限制重排范围 |
| 活跃/历史分区 | `message/index.vue:56-61,167-174` | 最近 `ACTIVE_TAIL_COUNT=5` 条 + streaming 消息用真 DOM，其余走 `LazyMessage` |
| IO 懒渲染 + 高度缓存 | `message/LazyMessage.vue` + `heightCache.js` | IntersectionObserver（rootMargin 200px）进视口才挂组件，离视口 2s 后卸载、用缓存高度占位防跳跳 |

---

## E. 与后端 / RPC 的接口面

### E1. 接口清单 `【代码】`

| 方法 | RPC 名 | 入参要点 | 出参 |
|---|---|---|---|
| POST | `createConversation` | `AppKey, BotId, UserID, QueryExtends, Inputs{global_param_*}` | `Conversation.AppConversationID` |
| POST | `agentStreamChatA` | `AppKey, BotId, UserID, AppConversationID, Query, queryImage, Inputs, ResponseMode:'streaming'` | SSE 事件流（见 E2） |
| POST | `stopMessage` | `TaskID`（= messageId）| — |
| POST | `deleteConversation` | `AppConversationID` | — （前端未调用） |
| POST | `FM2DS4B10064610` / `FM2DS4B10548341` | 银行交易域 | `core/api/common.js` 遗留 |
| POST | `/api/v1/upload/image` | `{ session_id, user_id, image_base64, analyze:true }` | `{url}`（`jsapi/other.js:83-118`） |
| POST | Flame `publish` `ajax({type:'publish'})` | 动态卡清单/资源 | `{data}` |

### E2. SSE 事件类型（卡片范式的真正输入格式）`【代码】`

`StreamParser._realProcess`（`stream.js:299-565`）处理的事件，**移植时必须原样实现**：

```
message_start / message_replace / message / message_end
message_output_start / message_output_end
tool_message_start / tool_message_output_start / tool_message / tool_message_end / tool_message_output_end
text_check_fail / knowledge_retrieve_end
```
- 文本增量：`event:'message'`，字段 `answer`（增量字符串）+ `displayResponseType`（`MARKDOWN`/`TEXT`）`【代码】`
- **卡片数据：`event:'tool_message'`，`answer` 是 JSON 字符串**，归一化成（`stream.js:518-550`）：
  ```js
  { templateName: data.cardId, kvMap: JSON.parse(data.cardData), version: data.cardVersion,
    templateId: data.cardId, displayResponseType: 'TEMPLATE', rawContent: {} }
  ```
  支持三种形态：单 `cardId`+`cardData` / `contentList[]` 数组（逐项分流）/ 裸兜底（`templateId` 缺省 → `'template-fallback'`）
- 知识库引用：`event:'knowledge_retrieve_end'` 的 `docs` 挂到文本消息的 `docs`，由 `quoteTool` 渲染 `【代码】`
- 终止：`message_end` 或 `errorCode!=='0'`；130s 无数据超时（`stream.js:128,138-161`）

### E3. 「网关」概念 `【代码 + 推断】`

有。`RPC_SUB_PATH = '/fgw'`（`.env`），`fetch.js:15-17`：
```js
reqPrefix = (url, isSSE) => `${RPC_SUB_PATH}/${isSSE ? 'sse/' : ''}${SASS_APP_ID}/${url}`
// 例：/fgw/sse/100001/agentStreamChatA
```
外层 body 是「双层冗余」包装（`fetch.js:45-51`）：`{ body, bodyData, reqHeaderData, header, securityData }`，再套一层 `{ channel: '100001_dev', data: {...} }`（`fetch.js:56-71`）。Header 带 `X-Agent-Type: 1 / Apikey / sassappid / sassworkspaceid / deviceid / token`。
- `【推断】` `fgw` = finance gateway，`SASS_APP_ID + SASS_WORKSPACE_ID` 是多租户标识；`channel = appId_workspaceId`。阿杏后端如果是自研 Express，**不需要复刻这套包装**，但要保留「一个统一前缀 + 一个服务端注入的业务上下文对象」的形态。

### E4. 鉴权 `【代码】`

- 登录态：`sessionStorage['__AI_AGENT_RPC_TOKEN__']`（`saveUserInfo` 写入，`user.js:83-86`）
- 请求头：`token: storage.session.get(RPC_TOKEN) || ''`（`fetch.js:80`）；body 层另有 `securityData: { securityToolList:[{reserve, verifyValue: token, securityToolType:'rl'}], securityToolType:'rl' }`（`fetch.js:19-32`）
- `Apikey: body.AppKey` 同时出现在 header（`fetch.js:76`）；AppKey 可被后台在设置页改（`settings/index.m.vue:32-41, 151-161`）
- `【推断】` 铁律：**所有身份信息都在请求体/头里显式传，没有 cookie session**；登出 = 清 sessionStorage + 清会话 ID（`preload.js:25-31`）

---

## F. 视觉规范

### F1. 设计 token（可直接抄）`【代码】` `src/styles/var.scss`

```scss
--app-primary-color: #2f86f6;    --app-danger-color: #f3464a;   --app-warn-color: #fe6723;
--app-orange-color: #ffb31c;     --app-success-color: #26d43d;  --app-success-bg-color: #eefff0;
--app-border-color: #e4e4e4;     --app-text-color: #333;        --app-title-color: #333333;
--app-sub-text-color: #727885;   --app-btn-primary-bg-color: #3c7efe;
--app-body-bg-color: #fff;       --app-area-bg-color: #f7f9fc;  --app-quote-bg-color: #dbe8ff;
--app-tip-bg-color: #fbebed;     --app-input-bg-color: #f3f4f8;
--app-card-bg: #ffffff60;        --app-font-size: 0.28rem;      --app-card-radius: 0.24rem;
--app-split-line: 0.51px solid #ebedf0;   --app-chat-sender-height: 2.16rem;
--app-highlight-inset-shadow: 0 0 0 0.5px #fff inset, 0 2px 12px -4px #00000016;
--app-card-bg-gradient: linear-gradient(0deg, #fefbf7 0%, #fef3e9 100%);
--app-ribbon-gradient: linear-gradient(180deg, #ff6834 0%, #f63532 100%);
```

**字体/rem 体系**（`src/core/utils/index.js:19-31`）：
```js
setRootSize(ratio) {
  const baseWidth = Math.min(clientWidth, 750)          // 750 设计稿
  docEl.style.fontSize = (100 * baseWidth/750 * ratio) + 'px'
  docEl.style.setProperty('--abs-rem', (100*baseWidth/750).toFixed(4) + 'px')  // 不受字号缩放影响
}
```
- `ratio` 6 档：`0.875 / 1 / 1.125 / 1.25 / 1.375 / 1.5`（`constants/enums.js fontSizeScaleMapKeys`），存 localStorage，`resize` 与 `DOMContentLoaded` 重算
- `--abs-rem` 是「绝对 rem」，`styles/fn.scss` 提供 `absRem($multiplier)` → 用于**不能被字号缩放影响的尺寸**
- `【代码】` 阿杏现有 `--app-*` 变量风格与此同源，可直接对齐命名

### F2. 卡片尺寸 / 栅格 / 间距 `【代码】`

- **Sketch 设计尺寸 `686 × 1117`**（`docs/superpowers/plans/2026-07-23-electric-patrol-report-sketch.md`：「Sketch 选中卡片设计尺寸为 686 × 1117，页面实现继续使用项目现有 rem 比例」）`【文档】`
- 卡片根：`width: 100%`；消息行 `margin: 0.32rem`（`message/index.vue:258`、`LazyMessage.vue:172`）
- 卡片内边距主流 `0.24rem ~ 0.32rem`；卡内子块 `0.24rem`；子块内边距 `0.2rem ~ 0.28rem`
- **没有多列栅格**（AI 卡全宽通栏）。唯一的例外是 `plainImage` 多图：`grid-template-columns: repeat(2, 1fr)` + `aspect-ratio: 1`（`plainImage.s.vue:81-92`）
- 圆角层级：卡 `0.24rem` / 卡内块 `0.12–0.2rem` / 标签 `0.08rem` / 底部弹窗 `0.32rem 0.32rem 0 0`

### F3. 动效规范 `【代码】`

- **入场**（`views/chat/message/index.vue:228-239` + `styles/index.scss:52-61`）：
  ```js
  getItemAnimation(e) {
    return !e.animated ? `fadeIn ${ textTemplates.includes(e.type) ? '0.3s' : '0.6s' }
                         ${ (index>3 ? 3 : index+1) * 0.3 }s ease backwards` : ''
  }
  ```
  → **文本卡 0.3s、富卡片 0.6s、第 n 张延迟 `min(n+1,3)*0.3s`**；`animationend` 后置 `animated=true`（后续 IO 重载不再播）
  ```scss
  @keyframes fadeIn { from { opacity:0; transform: translateY(50px) } to { opacity:1; transform:none } }
  ```
- **滚动时机**：非 immediate 时会检测最后一条 row 的动画，**等 `animationend` 再 scrollToBottom**，带 1s 兜底（`skeleton/index.vue:296-318`）
- 语音播放中：`breathing` 呼吸（opacity 0.75↔0.25，1.2s linear，`textStreamTool.vue:41-49`）
- 声波：`components/wave.vue`（随机柱状 + `barCount/duration/animationHeights` 参数化）
- 数字滚动：`components/animateNumber.vue`（`value/height/duration`）

---

## G. 移植到「无框架原生 JS」的要点

### G1. 可 100% 照搬（纯 HTML/CSS/DOM，无 Vue 依赖）`【推断，基于代码】`

1. **rem + `--abs-rem` 双轨制**（`utils/index.js:19-31` + `fn.scss`）——核心是 `min(clientWidth,750)` 归一化，原生直接抄
2. **`var.scss` 全部 token**，尤其卡片三件套：`background: rgba(255,255,255,.5)` + `1px #fff border` + `--app-highlight-inset-shadow` + `--app-card-radius`
3. **fadeIn 分级延迟规则**（文本 0.3s / 卡片 0.6s / 延迟 `min(i+1,3)*0.3s`）+ `animationend` 标记
4. **`contain: layout style paint`** 加在每张卡根节点上（streaming 高频更新不炸外部布局）
5. **卡片注册表 = 一个 `Map<templateId, factory>`**，`templateId → 组件名` 的 alias.json 三级 fallback（markdown / plainText / 原名 / fallback）原样保留
6. **eventBus 用 `window CustomEvent`**（`core/event/eventBus.js`）——原生零成本
7. **LazyMessage + heightCache**：IntersectionObserver（rootMargin 200px）+ 离屏 2s 卸载 + sessionStorage 高度缓存（LRU 200 + 按卡片类型给估计高度）——**纯 DOM 逻辑，一行 Vue 都不用改**
8. **流式期间 md 降级 `<pre>`**（`markdown.s.vue:10-11`）——这是性能关键，务必保留
9. **三段 emit 顺序**（前置卡 → 文本 → 普通卡）与 `PREPEND_TEMPLATE_IDS` 白名单
10. **「卡片即下一个问题」**（按钮文字 = query）与 `actionTrigger` 分发表——协议层，与框架无关

### G2. 必须重写（Vue 机制 → 原生等价物）`【推断】`

| Vue 机制 | 原生等价方案 | 注意 |
|---|---|---|
| `import.meta.glob('./resources/**/*.s.vue')` | 手写 `cards/index.js` 注册表，每张卡 `export default { name, mount(root, ctx) }`；异步卡用 `() => import('./x.js')` | **别用循环扫目录**（原生 ESM 无 glob）。收益是显式可控，代价是新增卡要手动登记 |
| `<component :is="type" v-bind="cardProps">` | `registry.get(type)(root, ctx)`，每张卡导出一个 `mount(root, ctx)` | 契约与阿杏 `view-*.js` 的 `mount(root, ctx)` **完全同构，可直接复用现有模式** |
| `mixins: [mixins]` 注入 12 个 props + mounted scrollToBottom | 统一 `ctx = { api, ui, state, emit, on, requestAI, appendCard, scrollToBottom, ... }` 单对象 | AGENTS.md 自己也说这是「待改进：隐式依赖」，原生改成显式 ctx 更干净 |
| `ref([]) + .push()` 响应式数组 | `messages` 数组 + 两类更新：① 追加（appendChild）② **同 chunkId 增量更新**（按 `chunkId` 找到 DOM 局部 patch） | **绝不能整列表 innerHTML 重建**，否则丢掉 streaming 性能 |
| `watch(dataSource, {immediate:true})` | 卡的 `mount(root, ctx)` 里读一次初始值 + `ctx.on('chunk:'+chunkId, patch)` | `chunkId` 订阅机制是 `plainText.s.vue:93-104` / `markdown.s.vue:194-204` 的核心，原生用 CustomEvent 复刻 |
| `requestAnimationFrame` 分帧队列 | 同左，或 `setTimeout(0)` / `scheduler.postTask` | 注意 Worker 里没有 rAF，`stream.js:243-261` 用 `IS_WORKER` 分支绕过的，别照抄 |
| `?worker` 后缀（`stream-bridge.js:1`） | `new Worker(new URL('./stream-worker.js', import.meta.url), {type:'module'})` | worker 文件不许 import 任何碰 DOM 的模块；`StreamParser` 目前只在 `IS_WORKER` 时走 `_realProcess` 直调 |
| `#v-ifdef` 条件编译 | 构建期字符串替换，或运行时 `const FLAME_ON = ...` 常量化 + rollup treeshake | 三项：Flame / LocalCard / VConsole |
| Vant（Toast / ImagePreview / Dialog / Swipe / Slider） | 自写等价件 | 实际用到点：`showFailToast/showSuccessToast/showImagePreview/showConfirmDialog` + `van-swipe`（顶部 tab 横滑）。阿杏已有 `ctx.ui`，补 toast + 图片预览即可 |

### G3. 隐藏前提条件 / 移植踩坑点 `【推断】`

1. **`chunkId` 增量订阅是整个流式渲染的骨架**。`useChat.request` 的回调里（`useChat.js:251-272`）会先倒序查找 `data.chunkId === info.chunkId` 的消息做「原地 patch」（只改 `docs`/`textResponse`），匹配不到才走 `messageParser` 新建。原生重写若偷懒整条重绘，长回答会明显卡。
2. **`tool_message` 的 `answer` 是 JSON 字符串且可能 `contentList` 是数组**——一张卡/多张卡/裸数据三种形态都要兼容（`stream.js:532-550`），这个字段容错是「新老协议混跑」用的，别简化掉。
3. **消息的 `hidden` 字段**：`clearSuggestion()` 靠 `e.hidden = true` 隐藏旧推荐语，渲染层 `filter(e => !e.hidden)`（`message/index.vue:130`）。原生若直接删 DOM 会丢掉「再次显示」的可能。
4. **`window.on/off` 被猴补丁**（`core/event/overwrite.js`）：同 id 注册会先移除旧监听。原生项目若有多处 `addEventListener` 同名，注意自己会不会重复绑定。
5. **`getRootSize()` 在模块加载期就被调用**（`flame/adapter/ChatAdapter.js:12`）——依赖 `document.documentElement.style.fontSize` 已被 `preload` 设置。原生的初始化顺序要保证「先 setRootSize，再 import 卡片」。
6. **sessionStorage 读写全部 try/catch**（`heightCache.js:117-146`、`chat.js:17-23`）——隐私模式/WebView 禁用场景。原生同样要包。
7. **`abortResponse` 的 UUID 失效机制**（`useChat.js:148-178` + `request.js` 迟到回调）：`CHAT.ABORT` 一发，`currentRequestUid` 比对不上的 chunk 全部丢弃。原生若不做「晚到 chunk 丢弃」，停止生成后还会有卡片继续冒出来。
8. **卡片 `mounted` 即 `scrollToBottom`**（`mixins/common/index.js:21-25`）——但用 `animated` 标记区分「历史消息被 IO 重载」不滚。移植时懒渲染重挂的卡不要触发滚动。
9. **`isClient` 决定左右 + 圆角归零方向**（`plainText.s.vue:135-146`）：这是「用户/AI」视觉区分的唯一机制，卡片本身不感知气泡概念。
10. **`electric-patrol-report` 的「新协议 `inspection_groups` + 旧协议扁平 `alerts`」双兼容**（`docs/superpowers/plans/2026-07-23-electric-patrol-report-sketch.md` `【文档】`）→ `【推断】` 说明**线上卡片协议是会变的**，阿杏的卡 schema 要预留「kvMap 里字段可增删、缺省有默认值」的容错（`electric-greetings.m.vue:27` 的 `|| '我是电网人的数字用检助手…'` 就是范例）。

---

## 附：移植落地清单（给阿杏的 6 步）

1. `cards/registry.js`：`Map<templateId, () => import(cardModule)>` + `alias` 对象 + `fallback`
2. `stream.js`：把 `StreamParser` 的 12 事件状态机 + 三段 emit 抄成原生模块（约 200 行，无框架依赖，可直接搬）
3. `ctx`：`{ api, ui, state, emit, on, requestAI, appendCard, scrollToBottom, isClient }`
4. 每张卡：`export default { name, mount(root, ctx){} }`，root 上自带 `width:100%` + 三件套 + `contain`
5. `msg-row` 渲染器：追加 + chunkId patch + IO 懒渲染 + 高度缓存
6. CSS：`var.scss` token + rem 双轨制 + fadeIn 分级延迟
