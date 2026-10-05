# /fgw 协议线上报文实测（复刻依据）

来源：`grid-ar-glasses/gateway`（FastAPI，13 个自带测试全过）+ mock backend 实测抓包。
抓包脚本思路：ASGITransport 把 gateway app 与 mock backend 串起来，直接打 `/fgw/...`。

## 1. 路径与方法名

```
POST /fgw/{app_id}/{rpc_method}          # 非流式
POST /fgw/sse/{app_id}/{rpc_method}      # 流式
GET  /health
```

`rpc_method` 允许带 `com.finmall.mbank.` 前缀，网关剥掉后匹配：
`createConversation` / `deleteConversation` / `stopMessage` / `agentStreamChatA`。
未知名 → `{"bodyOutData":"...error 404...","resHeaderData":{"errorCode":"404",...}}`。

## 2. 请求信封

```json
{
  "channel": "100001_dev",
  "data": {
    "bodyData": {
      "Query": "三千左右的沙发",
      "UserID": "u-001",
      "AppConversationID": "CONV-abc123",
      "ResponseMode": "streaming",
      "BotId": "bot1",
      "AppKey": "key1",
      "TaskID": null,
      "Inputs": {}
    }
  }
}
```

解析时 `bodyData` 缺省回退 `data.body`；所有字段可缺省（有默认值：`UserID→rpc_user`、
`ResponseMode→streaming`、`BotId→grid-ar-agent`）。

## 3. 非流式响应：三层嵌套（关键）

实测原文：

```json
{
  "bodyOutData": "{\"bodyOutData\": {\"Conversation\": {\"AppConversationID\": \"CONV-abc123\"}}, \"resHeaderData\": {\"errorCode\": \"0\", \"errorMsg\": \"\"}}",
  "resHeaderData": {"errorCode": "0", "errorMsg": ""}
}
```

**外层 `bodyOutData` 的类型是 `str`，不是对象。** 前端必须 `JSON.parse(result.bodyOutData)`
拿到内层 `{bodyOutData, resHeaderData}` 再解构。所以阿杏复刻时：

- 响应 = `{ bodyOutData: JSON.stringify({ bodyOutData: <业务对象>, resHeaderData: {...} }), resHeaderData: {...} }`
- 业务对象对 `createConversation` 是 `{Conversation:{AppConversationID}}`
- 错误时 `errorCode` 非 `"0"`，`bodyOutData` 内层为空对象

## 4. SSE 响应：原样透传，不二次包装

```
HTTP/1.1 200
content-type: text/event-stream; charset=utf-8
cache-control: no-cache
x-accel-buffering: no

data:{"event":"message_start"}

data:{"event":"tool_message","answer":"{\"cardId\":\"product-list\",\"cardData\":{\"kvMap\":{\"title\":\"三千左右的沙发\""}}}"}

data:{"event":"message","answer":"hello"}

data:{"event":"message_end"}
```

**网关不改写 SSE 事件**，后端流什么就吐什么。卡片藏在 `tool_message` 里：
`answer` 是一个 **JSON 字符串**，形状 `{cardId, cardData:{kvMap}, cardVersion}`；
`cardData` 也可能是 `contentList` 数组（一次多张卡）。

## 5. 事件类型全集（H5 前端的状态机）

```
message_start / message_replace / message / message_end
message_output_start / message_output_end
tool_message_start / tool_message_output_start / tool_message / tool_message_end / tool_message_output_end
text_check_fail / knowledge_retrieve_end
```

- 文本增量：`event:"message"`，字段 `answer`（增量字符串）
- 卡片：`event:"tool_message"`，`answer` 是 JSON 字符串
- 结束：`message_end` 或 `errorCode !== "0"`；130s 无数据超时

## 6. 阿杏现有事件 → 目标事件的映射

阿杏 `/api/chat/guide/stream` 现有：`status / thinking / delta / tool / done`。

| 现有 | /fgw 目标 | 说明 |
|---|---|---|
| `status` | 保留 | provider/model 信息 |
| `thinking` | 可映射到 `message_output_start` 前后或自留 | H5 无思考过程事件，可只透传不消费 |
| `delta` | `message` | 文本增量改名即可 |
| `tool`（只带 name） | `tool_message`（带 cardId/cardData） | **要补输出**：见 chat-guide-agent.js:445，现在把工具返回丢了 |
| `done` | `message_end` | 改名即可 |

## 7. 参照项目的三处安全缺口（阿杏复刻时必须补）

| 缺口 | 现状 | 阿杏要做 |
|---|---|---|
| 身份可冒充 | `UserID` 由请求体自报，网关不校验 | 从阿杏 cookie session 取手机号；未登录降级游客 UUID；校验 `AppConversationID` 归属 |
| CORS | `allow_origins="*"` 且 `allow_credentials=True`（ browsers 实际会拒） | 收敛白名单 |
| 限额 | 无任何限流 | 接阿杏现有 `checkChatGuideLimit`（IP 维度） |
