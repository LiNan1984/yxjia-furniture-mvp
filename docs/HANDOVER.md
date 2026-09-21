# 银杏家具 MVP · 交接文档

> 交接时间：2026-09-18 · 交接人：林安（Claude Code 会话产出）
> 线上地址：https://yxjia.harness-agent.app/ （HTTPS，nginx 反代 → 127.0.0.1:3300）
> 当前状态：**语音导购话筒点击无反应（未修复，见 §6.1）**，其余功能在线可用

---

## 1. 项目一句话

为柞水县银杏家具店做的家具电商 MVP + AI 试摆 + AI 语音导购。
顾客发客厅照 → AI 把店里沙发合成进客厅；或直接跟 AI 语音导购对话问商品。

## 2. 当前进度（截至交接）

| 功能 | 状态 | 说明 |
|------|------|------|
| 电商基础（浏览/下单/后台/用户） | ✅ 线上 | 8 月初完成，42 个 E2E 测试 |
| 试摆合成（gpt-image-2 主路径） | ✅ 线上 | 兜底链：gpt-image-2 → 阶跃 step-image-edit-2 → Pollinations |
| 全屋定制 Phase 1 | ✅ 线上 | 多房间风格分析（commit 02a3bc6） |
| 商品识别（step-3.7-flash） | ✅ 线上 | 09-17 从 doubao 切换，doubao 保留兜底 |
| AI 文字导购（step-3.7-flash） | ✅ 线上 | OpenAI 兼容接入，带真实商品库工具调用 |
| 语音导购-一次性模式（/api/voice/ask） | ✅ 线上 | ASR→LLM→TTS，端到端 8–12s |
| 语音导购-实时通话（/api/voice/realtime） | ⚠️ 已部署但**前端点击无反应** | 服务端链路实测全通（WSS 直连验证过），问题在前端/链路某处，见 §6.1 |
| 公网部署 | ✅ | 源码 systemd 部署（09-18 起），Docker 已停用 |

**代码状态**：git 提交停在 `02a3bc6`（08-24）。09-17 之后的全部改动（Step 接入、语音、实时通话、部署调整）**都在工作区未提交**。

## 3. 架构

```
浏览器 (src/index.html)
  ├─ 试摆：multipart 上传 → /api/tryon/ai-custom
  │     兜底链：twofishai gpt-image-2 → 阶跃 step-image-edit-2 → Pollinations
  ├─ 文字导购：/api/chat/guide (Agents SDK，step-3.7-flash + 商品库工具)
  └─ 语音：
      ├─ 实时模式：WS /api/voice/realtime（服务端 WS 代理）
      │    → wss://api.stepfun.com/step_plan/v1/realtime?model=stepaudio-2.5-realtime
      │    前端：mic 推 pcm16@16k → 客户端能量 VAD 自动断句 → commit+response.create
      │          → response.audio.delta 流式播放（首包 ~0.7s）；支持打断（AEC）
      └─ 一次性模式：POST /api/voice/ask（WAV 上传 → stepaudio-2.5-asr → step-3.7-flash → stepaudio-2.5-tts）
```

- 识别/导购/语音统一走阶跃 **Step Plan**（base `https://api.stepfun.com/step_plan/v1`），方舟 doubao 兜底（`visionProvider()` 双 provider）
- 导购人设（真实商品库 + 口语约束）在服务端注入（`buildVoiceGuideInstructions()`），客户端不可覆盖
- 语音 WS 代理：白名单事件转发 + 并发上限 3（`VOICE_RT_MAX_SESSIONS`）+ 网络错误自动重试（`withStepRetry`）

## 4. 部署（源码模式，非 Docker）

- 服务器：`root@72.60.193.189`（sshpass 密码登录可用；密钥认证也已配好）
- 目录：`/root/yxjia-mvp`（= 本仓库，rsync 同步）
- 进程：**systemd 单元 `yxjia.service`**（`node src/server.js`，端口 3300，崩溃 3s 自动重启，开机自启）
- 日志：`/var/log/yxjia.log`
- 历史教训：`server.js` 读 `PORT` 在 dotenv 加载 `.env` **之前** → systemd 必须显式 `Environment=PORT=3300`（已配）；3000 被 new-api 容器占用，勿用
- 旧 Docker 镜像 `yxjia-mvp:latest` 保留可回滚（容器已删；注意容器版 MINIO_ENDPOINT 用 `yxjia-minio`，源码版用 `127.0.0.1`）

**常用命令**：

```bash
rsync -rc src/ root@72.60.193.189:/root/yxjia-mvp/src/   # 同步前端+服务端
ssh root@72.60.193.189 'systemctl restart yxjia'          # 重启
ssh root@72.60.193.189 'tail -50 /var/log/yxjia.log'      # 日志
curl -s https://yxjia.harness-agent.app/api/voice/status  # 语音就绪状态
```

**凭证位置**（勿提交 git）：本地 `.env` 与服务器 `/root/yxjia-mvp/.env`：`TWO_FISH_API_KEY`、`ARK_API_KEY`、`STEP_API_KEY`（阶跃 Pro 套餐）、`MINIO_*`、`ADMIN_*`。

## 5. 关键文件

| 文件 | 内容 |
|------|------|
| `src/server.js` | 全部后端（Express 单进程 + WS upgrade 代理） |
| `src/chat-guide-agent.js` | 文字导购 Agent（@openai/agents + 工具），provider 链 OpenAI→Step→ARK |
| `src/index.html` | 顾客首页 + 试摆 + **语音通话前端状态机**（search `实时通话模式`） |
| `docs/Step案例素材-银杏家.md` | 阶跃案例素材表（含模型调研/定价/下线公告） |
| `tests/api.test.js` | Playwright API 测试（**有 14 个存量失败**，products.json 数据漂移导致，非代码问题） |

## 6. 已知问题与下一步

### 6.1 ✅ 已修复（09-18）：语音导购话筒点击无反应

**根因**：语音状态机重写时变量改名（`voiceLastAudioUrl` → `rtLastAudioUrl`），但 `toggleVoiceRecording` 等处仍引用旧名，点击时同步抛 `ReferenceError`，整个点击处理中断且无任何提示。

**修复**：统一改名（sed 全局替换）；Playwright 无头复现验证——点击后 WS 成功建立、状态进入"请讲… 说完停一下我就回答"。

**遗留的次要告警**（不影响功能）：ScriptProcessorNode 弃用警告（建议后续迁移 AudioWorkletNode）；页面有 3 个无关的 401/404 资源加载报错（auth/me 等，属存量）。

**诊断方法论**（供下次参考）：Playwright 无头 + `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` 授权假麦克风，监听 console/pageerror/websocket 事件，本地即可复现线上语音问题。

### 6.2 其他待办

- [ ] **语音体验进阶参考（GPT voice 类项目）**：OpenAI Realtime Console（openai/openai-realtime-console，WebRTC + ephemeral token）、LiveKit Agents / Pipecat（服务端 Silero VAD + 打断）、`@ricky0123/vad-web`（浏览器版 Silero VAD，可替代手写能量检测）；前端 ScriptProcessorNode 建议迁移 AudioWorkletNode

- [ ] **提交代码**：02a3bc6 之后的改动全部未 commit（Step 接入 / 语音 / 部署配置），建议按 conventional commits 拆分
- [ ] **阶跃图像接口 10-10 停服**：兜底链中的 step-image-edit-2 会自然失效；建议提前换国内按量计费的图像编辑 API（智谱/通义万相/硅基流动），只改 `callStepImageEdit` 一层
- [ ] StepAudio 3 系列在 Pro 套餐不可用（实测），语音已固定用 2.5 系列；如阶跃放开再升级
- [ ] 素材发布前：二维码生成、用户量数据积累、与阶跃确认图像下线口径（见 `docs/Step案例素材-银杏家.md` 附录 D）
- [ ] 验证码仍是固定 `123456`，生产要接短信

## 7. 本地开发

```bash
npm install
node src/server.js           # http://127.0.0.1:3000（.env 里 STEP_API_KEY 已配）
./node_modules/.bin/playwright test tests/api.test.js
```

注意：本地 MinIO 未启动时自动走本地文件兜底；测试基线 = 14 failed / 34 passed，以此对比回归。
