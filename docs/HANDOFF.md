# 交接文档 · 银杏家具 MVP

> 最后更新：2026-09-20 · 基线 commit `d78f5ed`（main 分支）
> 适用对象：接手这个仓库的下一个开发者 / 下一个 Claude 会话

---

## 1. 项目一句话

柞水县银杏家具店的电商 MVP + AI 试摆 + AI 语音导购。
顾客发客厅照 → AI 把店里沙发合成进客厅 → 满意来店下单。
店铺电话 **13359140982**，地址：陕西省商洛市柞水县乾佑街道农机路河西。

技术栈：Node 22 + Express 4，0 数据库（JSON 文件），MinIO 对象存储，
纯 HTML/CSS 前端（不引框架），Playwright 测试 71 个。

---

## 2. 本次会话已完成并提交（3 笔 commit）

| Commit | 说明 |
|---|---|
| `b620fdd` | **feat: AI 语音导购**（实时通话 + 接通打招呼 + 文字版对话记录）。整个语音模块此前一直是未提交 WIP，本次首次入库 |
| `4a07edb` | **fix: 找回 6 款核心商品** + 4 个 tryon 测试补登录会话 |
| `d78f5ed` | **docs: CLAUDE.md 同步**（测试数 42→71、坑表） |

### 2.1 语音导购（本次重点）

- **点话筒无反应的根因**：重构遗留 3 处坏引用（`voiceLastAudioUrl`、
  `stopVoiceCapture`、`rtStopCapture` 未定义），点击第一行就抛
  ReferenceError，整个接通流程静默中断。已全部修复。
- **交互**（参考 OpenAI Realtime Console / ChatGPT 语音模式）：
  点话筒=接通 → 导购先打招呼 → 免提连续对话（说完自动回答、回答完自动
  继续听、说话可打断）→ 再点=挂断。
- **文字版对话记录**：气泡式（用户右对齐深咖底 / 导购左对齐奶白底），
  流式追加，**挂断后保留可回看**。
- **回退路径**：WS 5 秒没接通 → 自动切 `/api/voice/ask` 一次性问答。

### 2.2 商品数据修复

`products.json` 曾被 admin 上传流程**整体覆盖**，手工预填的 6 款核心商品
（sofa-1/2/3、cabinet-1、bed-1、table-1）丢失，首页只剩 3 款 AI 识别沙发。
已从 git 历史（`5b9f0c6`）找回合并，当前共 **9 款在售**。
⚠️ 教训：以后改 products.json 必须走合并，不能整体覆盖。

---

## 3. 当前运行状态（接手先看这里）

| 项 | 状态 |
|---|---|
| 3000 端口服务 | **在跑**，PID 57593（22:05 启动），工作区版 server.js |
| 3001 端口 | 已停掉（那是我验证用的测试实例） |
| MinIO (9000) | **没启动** → 上传走本地回退，日志有 `ECONNREFUSED 127.0.0.1:9000`，功能不阻塞 |
| 测试 | Node 48 + Python 23 = **71 全绿**（在 commit `d78f5ed` 代码上验证过） |
| 商品数据 | 9 款在售（6 核心 + 3 AI 识别） |

---

## 4. ⚠️ 待决 / 阻塞事项（按优先级）

### 4.1 【高】语音 realtime 模型默认值已坏（需决策）

`src/server.js:3542-3543` 的**未提交 WIP** 把默认模型改成了：

```
stepaudio-3-realtime-preview  @  https://api.stepfun.com/v1
```

实测该路径直接失败：`response.create` 返回
`400 continue_final_message ... chat template` 错误，
表现为**打招呼静默失败**（无音频、无转写、无报错提示）。

已验证可用的是 **`stepaudio-2.5-realtime` @ `step_plan/v1`**
（`STEP_RT_MODEL` / `STEP_RT_BASE_URL` 环境变量可切）。
建议：默认值改回 2.5，等 3 正式版再评估。这行改动不是我做的，
动之前最好和改它的人确认。

### 4.2 【高】有并行会话在改同一批文件

工作区有大量未提交改动（18 个 M + 46 个未跟踪，+3261 行），
来自“全屋定制 Phase 1”的后续 WIP（server.js / whole-home.html /
admin 页面 / index.html / scene-styles.json / package.json 等）。
我提交时刻意只提交了语音和商品数据部分，**WIP 一行未动**。
接手时先 `git status` 看 WIP 是否还在演进，避免撞车。

### 4.3 【中】data/ 下有 31 张微信商品图未跟踪

`data/微信图片_*.jpg` 是店里实拍的商品图（未入库）。需要的话补一个
上传流程或至少 gitignore 处理，别让它们一直飘在 status 里。

### 4.4 【中】Python venv 的 playwright 被降级过

venv 里是 playwright 1.50，缺 `chromium_headless_shell-1155`，
我已补装。若之后有人升级/降级 playwright，跑 Python 测试前先确认
浏览器 revision 对得上，否则 19 个测试会集体报
"Executable doesn't exist"。

---

## 5. 环境注意事项（踩过的坑）

1. **linter 会偷偷改文件**：排查期间它自动把 `voiceLastAudioUrl`
   改名成了 `rtLastAudioUrl`，害我一度以为变量没问题。改完前端代码
   必须重启/刷新验证，别信你刚读到的文件内容。
2. **服务器端口**：宿主机 3000 可能被别的服务占（new-api 占 3300 的
   说法见 CLAUDE.md）；起测试实例用 `PORT=3001 node src/server.js`。
3. **server.js 读 PORT 在 dotenv 之前**：环境变量必须在命令行显式传，
   写 .env 不生效（生产用 systemd 的 `Environment=PORT=`）。
4. **阶跃图像接口 2026-10-10 下线**：试摆合成保持 twofishai 主路径 +
   Pollinations 兜底，别迁去阶跃图像模型。

---

## 6. 建议的下一步（按优先级）

1. 决策 4.1 的 realtime 模型默认值（改回 2.5），然后**真机**点一遍
   话筒验证（模拟麦克风测不出音质/打断手感）。
2. 收尾“全屋定制 Phase 1”WIP：跑通 `whole-home.html` 主流程后单独提交。
3. 给语音导购补 Playwright 用例（招呼语气泡出现 + 挂断后记录保留），
   防止回归——这次的 bug 如果有用例根本不会发生。
4. 短信验证码替换固定 `123456`（ROADMAP v2.2，安全相关）。
5. 启动 MinIO 或明确改用本地存储，消除日志里的 ECONNREFUSED。

---

## 7. 常用命令

```bash
# 起服务（端口必须命令行传）
PORT=3000 node src/server.js

# 语音排障：看 realtime 握手
VOICE_RT_DEBUG=1 PORT=3000 node src/server.js
curl http://127.0.0.1:3000/api/voice/status

# 全量测试
./node_modules/.bin/playwright test tests/api.test.js
source .venv/bin/activate
python3 -m pytest tests/test_01_browse.py tests/test_02_call_button.py \
  tests/test_03_browse_products.py tests/test_04_order_flow.py \
  tests/test_05_api.py tests/test_06_admin_user_system.py -q

# 模拟浏览器点话筒（回归验证必做）
node --input-type=module -e "
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:3000/');
await p.click('#voiceFab'); await p.click('#voiceMic');
await p.waitForFunction(() => { const e = document.querySelector('#voiceChat .bubble.guide'); return e && e.textContent && rtState === 'listening'; }, null, { timeout: 25000 });
console.log(await p.textContent('#voiceChat .bubble.guide'));
await b.close();"
```

---

*交接人：Claude Opus 5 · 2026-09-20*
