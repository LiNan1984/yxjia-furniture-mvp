# 阿杏 · 卡片交互范式 + 会话 + 用户 + RPC 网关（设计）

> 日期：2026-10-05 · 分支 `feat/axing-ai-assistant` · 基线 `52cb739`
> 上游参照：`/Users/linan/Desktop/aicode/grid-ar-glasses/ai-assistant-h5`（卡片范式 + 会话 + 用户）
> 与 `/Users/linan/Desktop/aicode/grid-ar-glasses/gateway`（/fgw RPC 网关）
> 调研底稿：`docs/card-paradigm-research-ai-assistant-h5.md`、`docs/fgw-wire-format-capture.md`

---

## 0. 已确认的三个决策（本文所有设计的前提）

| # | 决策 | 含义 |
|---|---|---|
| 1 | **只替换 AI 回复的载体** | 首页 5 Tab、顶栏、Composer 位置、配色 `#2C2C2C/#F7F4EF/#E8B27D` 一律不动。改的只是「阿杏回复的那一条怎么渲染」：纯文本气泡 → 文本气泡 + 卡片 |
| 2 | **复刻 /fgw 的协议面，不照搬它的包装** | 保留「统一前缀 + 服务端注入业务上下文 + SSE 事件规范 + 卡片藏在 tool_message + bodyOutData/resHeaderData 错误码体制」；**不**复刻 `channel`/`securityData`/双层冗余信封/`com.finmall.mbank.` 前缀 |
| 3 | **分批** | 会话 → 用户 → 网关，三批各自可独立上线、独立回滚、各自带测试 |

### 0.1 三条铁律（违反即返工）

1. **不引前端框架**：Vue/Pinia/Vuex 全部改写成原生等价物（Map 注册表 + `el()` + ctx 事件总线）。
2. **不引数据库**：会话与消息落 `data/conversations.json`，沿用 `loadContainer/saveContainer`。
3. **不新增色板**：卡片只用现有 `.card` / `.card__body` / `.p-card*` / `.chip*` / `.row` / `.stack` / `.tiny` / `.muted` 类。需要新类时只加布局，不加颜色。

---

## 1. 现状盘点（改动落点）

| 层 | 现状 | 问题 |
|---|---|---|
| `src/axing/js/chat-composer.js` | `history` 是**模块内内存数组**，只留 6 轮；打 `/api/chat/guide` 一次性拿全文 | 刷新即失忆；无法「回看上次聊了什么」；切会话无从谈起 |
| `src/axing/js/view-home.js` | `chatRow()` 只渲染纯文本气泡；`PRESET_CHAT = []` | 卡片无处落脚 |
| `src/axing/js/app.js` | `ctx.state` 有 `phone`，但**没有游客身份**；`ctx.appendChat(role, text)` 只带 text | 匿名写入无法归属，登录后记录接不上 |
| `src/server.js:1356` `/api/chat/guide` | 返回 `{reply}`，无流式、无工具输出 | 卡片没有输入源 |
| `src/server.js:1385` `/api/chat/guide/stream` | 已有 SSE，事件为 `status/thinking/delta/tool/done`；**`tool` 只带 name，输出被丢**（`chat-guide-agent.js`） | 正好差一步就能出卡片 |
| 用户系统 | `/api/auth/login`（手机号 + 固定 123456）+ session cookie 已在 | 缺游客态与会话归属打通 |

---

## 2. 分批路线图

```
Phase 1  会话       data/conversations.json + 6 个 REST + Composer/首页改成会话态 + 会话列表 UI
Phase 2  用户       游客 visitorId + 登录认领 + 「我的」页身份区
Phase 3  网关+卡片  /api/fgw/sse/chat 协议面 + 卡片注册表 + 补工具输出
```

**每批的交付物固定为**：后端接口 + 前端改动 + Playwright 测试（自带端口）+ 部署脚本跑一遍。
**每批都可单独回滚**：Phase 3 上线后旧 `/api/chat/guide` 与 `/api/chat/guide/stream` 保持不动，前端只把 Composer 的数据源切到新端点。

---

## 3. Phase 1 · 会话

### 3.1 数据形状

`data/conversations.json`（**加入 .gitignore**——含用户输入原文）：

```js
{
  "updatedAt": "2026-10-05T10:00:00.000Z",
  "items": [
    {
      "id": "C7f3a1b2c9",            // 'C' + 10 位 base36
      "visitorId": "v-9f2c…",        // 必填：Anonymous 归属
      "phone": null,                 // 登录认领后回填
      "title": "三千左右的沙发",       // 首条用户消息前 20 字，可在列表改名
      "createdAt": "…", "updatedAt": "…",
      "messages": [
        { "role": "user" | "ai", "content": "…", "at": "…",
          "cards": [ … ] }           // Phase 3 才有；Phase 1 一律 undefined
      ]
    }
  ]
}
```

容量：容器上限 **500 条**，超出按 `updatedAt` 从旧到新截断；单会话 `messages` 上限 **200 条**。

### 3.2 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/conversations` | 否 | **懒创建**（第一次提问时才调，不预建）。body `{visitorId, title?}` → `data:{id}` |
| GET | `/api/conversations` | 否 | 列会话。`?visitorId=` 或 `?phone=` **二选一**（都传则以 phone 为准），`updatedAt` 倒序，**不返回 messages**（列表只要摘要：`title/lastMessage/messageCount/updatedAt`） |
| GET | `/api/conversations/:id` | 否 | 取单个，含 `messages` |
| PATCH | `/api/conversations/:id` | 否 | `{title}`，1–40 字 |
| DELETE | `/api/conversations/:id` | 否 | 删会话 |

**消息只由一个写入方追加**：`/api/chat/guide`（Phase 3 起加上 `/api/fgw/sse/chat`）在拿到回复后，
把 user + ai 两条一起写进 `messages`。**不单独开放「追加消息」接口**——两个写入方迟早会写出重复条。
前端在 `conversationId` 还没建成的窗口期发的消息，由后端在建会话时把首条 user 消息一并带上
（`POST /api/conversations` 的 `title` 就取自它）。

**归属校验**（关键，防遍历）：`visitorId` 不匹配 → 403；已 `phone` 的会话要求 `phone` 匹配。仿现有 `GET /api/appointments/by-phone/:phone` 的写法。
**限额**：写操作按 IP `60 次/天`，读按 IP `300 次/天`（仿 `APPT_QUERY_LIMIT`）。超了 429，话术走「约到店 / 打电话」，**不把「登录后继续」当唯一出路**。

### 3.3 前端改动

**`app.js`**

```js
const defaultState = {
  …现有字段,
  conversationId: null,   // 当前会话；null = 还没开始聊
};
ctx.appendChat(role, text, cards) { emit('chat:message', { role, text: text || '', cards }); }
```

**`chat-composer.js`** —— `history` 从「模块内存」换成「当前会话的最近 N 轮」：

```js
// 进首页 / 切会话时同步；拿不到就用空数组（后端 history 上限 20，这里带 6 轮足够支撑指代）
ctx.on('conversation:loaded', (msgs) => { history = msgs.slice(-2 * HISTORY_TURNS); });
```

首次发送时序：

```
用户点发送
 → state.conversationId 为空？
     → POST /api/conversations {visitorId} 拿 id → setState({conversationId})
 → ctx.appendChat('user', text)            // 立即上屏，不等网络
 → POST /api/chat/guide（Phase 3 起改 SSE）
 → ctx.appendChat('ai', reply)
 → 后台 POST /api/conversations/:id/messages × 2（失败只静默，不打断对话）
```

**`view-home.js`** —— `chatRow()` 增第三个参数；访客进来时按 `conversationId` 拉历史渲染：

```js
addCleanup(ctx.on('chat:message', (m) => {
  timeline.appendChild(chatRow(ctx, m.role, m.text, m.cards));   // cards 为 undefined 时行为与今天完全一致
  scrollToEnd();
}));
```

**会话列表 UI**（视觉不动）：复用现有类的单页 `view-conversations`，**不进 Tab 栏**，入口两处 ——
Composer 的「＋」按钮（今天只能 `toast('更多功能还在来的路上')`）改成「开一个新话题」；
首页时间线空态时给一条「看看之前聊过什么」。

```
┌─────────────────────────────┐
│ ←  我的话题                  │  topbar（现成组件）
│ ┌─────────────────────────┐ │
│ │ 三千左右的沙发      ✎ 🗑 │ │  .card + .row--between
│ │ 昨天 21:14 · 8 条消息    │ │  .tiny.muted
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 客厅三米五放得下转角吗   │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

删除要二次确认（用 `confirm()`，不引弹窗组件）。

---

## 4. Phase 2 · 用户

### 4.1 游客身份

`localStorage['axing-visitor-v1']` = UUID，进站即生成（`app.js` 启动时），随所有匿名写入带上去。
字段名用 `visitorId` 而不叫 `userId`——参照项目的教训：它的 `UserID` 由请求体自报、网关不校验，**身份可冒充**。阿杏这一侧 `visitorId` 同样不可能是可信凭证，只做「同一台设备的记录归堆」，**绝不拿它做鉴权**。

### 4.2 登录认领

`/api/auth/login` 成功后追加一步**合并**（不新建概念）：

```
POST /api/auth/claim  {visitorId, phone}
 → 把 conversations / scenes / appointments 里 visitorId 匹配且 phone 为空的记录，phone 回填
 → 返回 {claimed: <n>}
```

只认领、不删除、不覆盖已有 phone 的记录。

### 4.3 「我的」页（`view-me.js`）

- 未登录：一行「用手机号登录，聊天记录和设备无关」+ 现有登录入口
- 已登录：手机号 + 退出 + 「清除本机聊天记录」（DELETE 全部本人会话）

用户气泡保持石灰底「我」字圆（阿杏没有顾客头像资产，这是已知允许偏差，见 handoff §8.2）。

---

## 5. Phase 3 · 网关协议面 + 卡片

### 5.1 新端点（不动老的）

```
POST /api/fgw/sse/chat        # 流式，事件规范见 5.2
GET  /api/fgw/status          # 排障：provider/model/ready
```

请求体（比 /fgw 少两层包装，保留「业务上下文由服务端注入」的形态）：

```json
{ "conversationId": "C7f3…", "query": "三千左右的沙发", "queryImage": null }
```

`visitorId` / `phone` / 商品库人设**全部由服务端从 session + body 注入**，不接受客户端自报身份。

### 5.2 SSE 事件（对齐 /fgw，前端状态机原样实现）

```
data:{"event":"message_start"}
data:{"event":"message","answer":"三千","displayResponseType":"TEXT"}
data:{"event":"message","answer":"左右的沙发很"…}
data:{"event":"tool_message","answer":"{\"templateId\":\"product-list\",\"kvMap\":{…},\"cardVersion\":1}"}
data:{"event":"message_end"}
```

| 事件 | 前端动作 |
|---|---|
| `message_start` | 建一个空的 AI 气泡，进入累加模式 |
| `message` | `answer` 追加进当前气泡 |
| `tool_message` | `answer` 是 **JSON 字符串**，解析后进卡片注册表 |
| `message_end` | 收尾：切回非流式态 |
| 其它（`message_output_*` / `tool_message_*` / `text_check_fail` / `knowledge_retrieve_end`） | 透传不消费（保留扩展位） |

**必须实现的两条硬规则**（参照项目踩过的）：
1. `answer` 是字符串，卡片要 `JSON.parse`；`tool_message` 也可能给 `contentList[]` 一次多张卡。
2. 130s 无数据超时 + `errorCode !== "0"` 即终止。

### 5.3 卡片注册表（原生等价物）

```js
// src/axing/js/cards/index.js
const registry = new Map();                       // templateId → (kvMap, ctx) => Node
export const registerCard = (id, fn) => registry.set(id, fn);
export const renderCards = (payload, ctx) => {    // 只返回 Node 数组，绝不自己 append 到页面
  const list = Array.isArray(payload?.contentList) ? payload.contentList : [payload];
  return list.map((raw) => {
    const kv = typeof raw?.cardData === 'string' ? safeParse(raw.cardData) : (raw?.cardData || raw?.kvMap || {});
    const fn = registry.get(raw?.templateId) || registry.get('template-fallback');
    try { return fn(kv, ctx); } catch { return fallbackCard(kv, ctx); }   // 单卡挂不拖垮整条时间线
  });
};
```

**首批 5 个 templateId**（都是阿杏真实用得上的，不造概念）：

| templateId | 渲染成 | 用什么现有类 |
|---|---|---|
| `product-list` | 2 列商品格，点格 `ctx.pickProduct` | `.p-grid` + `.p-card*` |
| `product-card` | 单商品大卡 +「去试摆」按钮 | `.card` + `.btn--apricot` |
| `booking-slots` | 三个时段 chip +「去预约」 | `.chip` + `.chip-row` |
| `scene-plan` | 方案摘要 +「打开 3D 看」 | `.card` + `.spec-row` |
| `template-fallback` | 兜底：把 kvMap 拍平成现有纯文本气泡 | `.ax-msg__bubble` |

### 5.4 后端要补的一步：把工具输出捡回来

`chat-guide-agent.js` 现在把工具返回丢了（只有 `ev.rawItem.name`）。补：

```js
if (ev.type === 'run_tool_call_output' && ev.rawItem) {   // Agents SDK 的 output 事件
  const out = typeof ev.output === 'string' ? safeParse(ev.output) : ev.output;
  if (out && out.templateId) yield { type: 'tool', ...out };   // 透传给 SSE 层
}
```

`/api/chat/guide`（非流式）**同步补**：返回体从 `{reply}` 扩成 `{reply, cards}`，`cards` 缺省 `[]`。
老前端不读 `cards` 也不会坏。

---

## 6. 测试（每批各自带，端口不碰 3000）

```
tests/axing-conv.test.js     # 端口 3430：conversations CRUD + 归属 403 + 限额 429 + 容量截断
tests/axing-conv-ui.test.js  # 端口 3431：刷新后历史还在 / 新建话题 / 切换 / 删除 / 无 pageerror
tests/axing-gateway.test.js  # 端口 3432：SSE 事件序列 + 卡片 JSON 解析 + contentList 多卡
                            #           + 未知 templateId 兜底 + 单卡抛错不拖垮时间线
```

沿用仓库既有模式：测试文件自己 `spawn('node', ['src/server.js'], { PORT })` 并轮询 `/api/products`。

---

## 7. 验收口径（可 Playwright 化）

| # | 口径 |
|---|---|
| V1 | 刷新 `/axing` 后，聊过的话还在（会话持久化） |
| V2 | Composer「＋」→ 新话题 → 时间线清空、顶部标题变成新会话 |
| V3 | 会话列表能改名、能删除（删有二次确认）、删除后首页不再出现 |
| V4 | 游客态发的话，登录同一手机号后能接上（认领生效） |
| V5 | `product-list` 卡片点一格 → 跳到商品详情且 `state.productId` 正确 |
| V6 | 后端返回未知 `templateId` → 前端渲染兜底文本，**不白屏、不报 pageerror** |
| V7 | 流式中途断网 → 已累加的文本保留 + 兜底话术，时间线不出现空洞 |
| V8 | 5 Tab / Composer / 配色的可见结构与今天逐像素一致（视觉回归，用截图 diff） |

---

## 8. 明确不做（YAGNI）

| 不做 | 理由 |
|---|---|
| `channel` / `securityData` / `com.finmall.mbank.` 前缀 / 双层冗余信封 | 参照项目的历史包袱；阿杏前后端同源同进程，没有跨组织 RPC 边界 |
| 车机 / Glass 系列 / 原生 jsBridge | 参照项目的硬件前提，阿杏只有浏览器 |
| 流式打字机逐字渲染 | 阿杏客群是老人，逐字跳动反而难读；`message` 增量够用 |
| WebSocket 替代 SSE | 现有 SSE 已能承载，且省一套基础设施 |
| 消息编辑 / 分支 / 重新生成 | 参照项目也没有；先解决「回得去、看得见」 |
| 删掉 `/api/chat/guide` 与 `/api/chat/guide/stream` | 有第三方在用且是回滚退路 |

---

## 9. 外部依赖与单点故障

| 依赖 | 失败时 |
|---|---|
| 阶跃 / 方舟 导购模型 | 现有兜底话术 + 429 引导打电话；`/api/fgw/status` 可见 |
| `data/conversations.json` 写失败 | 对话**照常进行**，只丢持久化（前端时间线是事实来源，不让写失败打断回答） |
| localStorage 被禁用 | 会话 id 存内存，刷新即新会话；不报错 |

---

## 10. 建议排期（1 人，参照 handoff §8.6 的 2 周口径）

| 阶段 | 工作量 | 产出 |
|---|---|---|
| Phase 1 | 2 天 | 6 接口 + Composer/首页会话化 + 会话列表 + 16 测试 |
| Phase 2 | 0.5 天 | visitorId + claim + 「我的」页身份区 + 6 测试 |
| Phase 3 | 3 天 | SSE 协议面 + 5 张卡 + 工具输出回捡 + 12 测试 |
| 缓冲 | 1.5 天 | 视觉回归 + 生产验证 |

**先做 Phase 1**：它是另外两批的地基（没有会话 id，卡片和认领都无处挂）。
