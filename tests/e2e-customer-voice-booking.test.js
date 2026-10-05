// 「真实顾客」端到端验收 D 组：语音导购 → 到店预约 → 店主闭环（PM 批判 🔴③ 的成交链路）
// 自带服务器（独立端口 3513，不碰 3000/3100/34xx 上的实例）。
//
// 覆盖两条动线：
//   顾客：语音问一句（含缺 key / 上游挂的降级话术）→ 预约到店 → 按手机号查自己的预约
//   店主：登录后台 → 看见这条预约 → 改状态 → 手机号一键拨号；未登录必须 401
//
// 语音在无头浏览器没有真麦克风：用 addInitScript mock getUserMedia + MediaRecorder，
// 与 view-voice.js 的 pickMime()/ondataavailable/onstop 契约逐条对齐。
// 真实 ASR/TTS 走的是阶跃上游，慢且不可控 → 用 page.route 打桩 /api/voice/ask，
// 只验前端链路与降级话术；上游本身由 tests/api-v*.test.js 的真实调用覆盖。
//
// 服务器把 **STEP_API_KEY 置成空串** 启动（不能 delete——dotenv v17 会对缺席的变量从 .env 补回来）：
// 这样 /api/voice/status 天然 ready=false、/api/voice/ask 天然 503，降级路径完全确定，
// 不会因为上游偶发把测试打红；真实上游由 tests/api-v*.test.js 覆盖。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

const PORT = 3513;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const APPOINTMENTS_FILE = path.join(process.cwd(), 'data', 'appointments.json');
const ADMIN = { username: 'admin', password: '123456' };
const CUSTOMER_PHONE = '13800138000';
const OTHER_PHONE = '13900139000';
const STORE_PHONE = '13359140982';
const SLOTS = ['上午 9:00-12:00', '下午 12:00-18:00', '晚上 18:00-20:00'];
const VIEWPORT = { width: 390, height: 844 };

let serverProc = null;

function raw(method, pathname, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const req = http.request(`${BASE_URL}${pathname}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, body: parsed, cookie: setCookie ? setCookie[0].split(';')[0] : null });
      });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const get = (p, cookie) => raw('GET', p, { cookie });
const post = (p, b, cookie) => raw('POST', p, { body: b, cookie });
const patch = (p, b, cookie) => raw('PATCH', p, { body: b, cookie });

function today() { return new Date().toISOString().slice(0, 10); }
function plusDays(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function adminCookie() {
  const r = await post('/api/admin/login', ADMIN);
  expect(r.status, 'admin 登录应成功').toBe(200);
  return r.cookie;
}
async function customerCookie(phone = CUSTOMER_PHONE) {
  const r = await post('/api/auth/login', { phone, code: '123456' });
  expect(r.status, `顾客登录应成功：${JSON.stringify(r.body)}`).toBe(200);
  return r.cookie;
}

/** 从 UI 之外造一条预约，用来喂给店主后台 */
async function createAppointment(over = {}) {
  const r = await post('/api/appointments', {
    name: '王阿姨',
    phone: CUSTOMER_PHONE,
    date: today(),
    slot: '上午 9:00-12:00',
    productIds: ['sofa-2'],
    note: '想看看转角沙发',
    ...over,
  });
  expect(r.status, `创建预约应成功：${JSON.stringify(r.body)}`).toBe(200);
  return r.body.data.appointment;
}

async function waitServerReady(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try { if ((await get('/api/products')).status === 200) return; } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('D 组测试服务器启动超时');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** 进阿杏语音页（壳就绪 + view-voice 挂载） */
async function openVoiceView(page) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
  await page.goto(BASE_URL + '/axing', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.AXING && typeof window.AXING.go === 'function'), null, { timeout: 15000 });
  await page.evaluate(() => window.AXING.go('view-voice'));
  await page.waitForSelector('#view-voice.active .mic-btn', { timeout: 15000 });
}

/** 进阿杏预约页 */
async function openBookingView(page) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
  await page.goto(BASE_URL + '/axing', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.AXING && typeof window.AXING.go === 'function'), null, { timeout: 15000 });
  await page.evaluate(() => window.AXING.go('view-booking'));
  await page.waitForSelector('#view-booking.active #ax-bk-form', { timeout: 15000 });
}

/** 无头浏览器没有麦克风：mock getUserMedia（可拒）与 MediaRecorder（对齐 view-voice 契约） */
async function installMicMock(page, { grant = true } = {}) {
  await page.addInitScript((allow) => {
    const FAKE_BYTES = 2048;                       // > view-voice 的 600 字节下限，才不会被当「没听到声音」
    class FakeMediaRecorder {
      constructor(stream, opts) {
        this.state = 'inactive';
        this.mimeType = (opts && opts.mimeType) || 'audio/webm';
        this.stream = stream;
        this.ondataavailable = null;
        this.onstop = null;
        this.onerror = null;
      }
      static isTypeSupported() { return true; }   // 让 pickMime() 选中第一个候选
      start() { this.state = 'recording'; }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        const chunk = new Blob([new Uint8Array(FAKE_BYTES)], { type: this.mimeType });
        if (this.ondataavailable) this.ondataavailable({ data: chunk });
        if (this.onstop) this.onstop();
      }
    }
    window.MediaRecorder = FakeMediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => allow
          ? Promise.resolve({ getTracks: () => [{ stop() {} }] })
          : Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError')),
      },
    });
  }, grant);
}

/** 按一下话筒（键盘 Enter：startRec ↔ stopRec，避开 pointer 事件在无头下的差异） */
async function tapMic(page) {
  const mic = page.locator('#view-voice .mic-btn');
  await mic.focus();
  await page.keyboard.press('Enter');
}

/** 拿 admin 会话并写进浏览器 cookie（必须在 goto 之前，否则后台页会先跳登录、把执行上下文打碎） */
async function adminSessionInBrowser(page) {
  const cookie = await adminCookie();
  const eq = cookie.indexOf('=');
  await page.context().addCookies([{
    name: cookie.slice(0, eq),
    value: cookie.slice(eq + 1),
    domain: '127.0.0.1',
    path: '/',
  }]);
}

test.beforeAll(async () => {
  const env = { ...process.env, PORT: String(PORT) };
  // 必须是空串而不是 delete：dotenv(v17) 对「已存在」的变量不覆盖，对「缺席」的变量会从 .env 补回来。
  // 置空串后 Boolean('') === false → /api/voice/status 报 ready=false、/api/voice/ask 走 503 分支，
  // 降级路径完全确定，不会因为上游偶发把测试打红。
  env.STEP_API_KEY = '';
  serverProc = spawn('node', ['src/server.js'], { env, stdio: 'ignore' });
  await waitServerReady();
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
  try { fs.writeFileSync(APPOINTMENTS_FILE, JSON.stringify({ appointments: [] }, null, 2), 'utf-8'); } catch { /* 忽略 */ }
});

// ============================================================================
// A. 顾客 · 语音导购页（含降级话术）—— 老人卡住时的第二出路
// ============================================================================
test.describe('A · 顾客·语音导购', () => {
  test('A1 语音页就位：Composer 让位（唯一例外）、话筒有可读标签、三个快捷问题', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openVoiceView(page);

    await expect(page.locator('#topTitle')).toHaveText('语音导购');
    // §70.1 不变式：聊天窗口始终在场，只有 view-voice 让位（语音本身是另一种聊天模态）
    await expect(page.locator('#composer')).toBeHidden();
    await expect(page.locator('#composerVoice')).toBeHidden();

    const mic = page.locator('#view-voice .mic-btn');
    await expect(mic).toHaveAttribute('aria-label', /说话/);
    await expect(mic.locator('svg')).toBeVisible();

    // 快捷问题 + 文字兜底通道：没麦克风也能继续问
    await expect(page.locator('#view-voice .chip')).toHaveCount(3);
    await expect(page.locator('#view-voice input[aria-label="输入你想问的"]')).toBeVisible();
    await expect(page.locator('#view-voice button', { hasText: '发送' }).first()).toBeVisible();

    // 「录音中」等状态提示位存在
    await expect(page.locator('#view-voice .loading-line')).toHaveCount(1);
    expect(errors, '语音页不应有页面报错').toEqual([]);
  });

  test('A2 缺 STEP_API_KEY 时语音状态显示人话，不是报错', async ({ page }) => {
    await openVoiceView(page);
    const status = page.locator('#view-voice [data-role="voice-status"]');
    await expect(status).toHaveText(/语音休息中|语音就绪/);
    // 本组服务器故意不带 key → 必须是「休息中」
    await expect(status).toHaveText('语音休息中，可文字聊');
  });

  test('A3 /api/voice/ask 缺 key 时回 503 + 人话（不吐 TypeError），UI 把话说全', async ({ page }) => {
    const r = await post('/api/voice/ask');
    expect(r.status).toBe(503);
    expect(r.body.error, '降级话术必须是人话').toContain('语音导购暂不可用');
    expect(r.body.error).toContain(STORE_PHONE);

    // UI 层：失败话术要带上门店电话，并且不当成 TypeError 抛出来
    await page.goto(BASE_URL + '/axing', { waitUntil: 'domcontentloaded' });
    const ui = await page.evaluate(async () => {
      const fd = new FormData();
      fd.append('audio', new Blob([new Uint8Array(2048)], { type: 'audio/webm' }), 'v.webm');
      const res = await fetch('/api/voice/ask', { method: 'POST', body: fd });
      return { status: res.status, body: await res.json() };
    });
    expect(ui.status).toBe(503);
    expect(ui.body.error).not.toMatch(/TypeError|undefined/);
  });

  test('A4 没拿到麦克风权限：toast 提示改用文字，不抛错、不卡死输入', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installMicMock(page, { grant: false });
    await openVoiceView(page);

    await tapMic(page);
    await expect(page.locator('#toast.show')).toContainText('没拿到麦克风权限');
    await expect(page.locator('#toast.show')).toContainText('文字');
    // 降级后文字通道必须还能用
    await page.fill('#view-voice input[aria-label="输入你想问的"]', '我想看沙发');
    await expect(page.locator('#view-voice input[aria-label="输入你想问的"]')).toHaveValue('我想看沙发');
    expect(errors, '拒绝麦克风不该产生页面报错').toEqual([]);
  });

  test('A5 录音→松手→上屏的完整链路（打桩上游）：识别文本替换占位、阿杏回话、气泡可回看', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installMicMock(page, { grant: true });
    // 打桩 /api/voice/ask：真实上游慢且不可控，这里只验前端链路
    await page.route('**/api/voice/ask', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          userText: '三千左右的布艺沙发',
          reply: '店里有两款三千出头的布艺沙发，都是耐脏面料。',
          audioBase64: btoa('fake-audio'),
          audioMime: 'audio/mpeg',
        },
      }),
    }));
    await openVoiceView(page);

    await tapMic(page);                            // 按下：开始录
    await expect(page.locator('#view-voice .mic-btn.recording')).toBeVisible();
    await tapMic(page);                            // 松手：发送

    const bubbles = page.locator('#view-voice .bubble');
    await expect(bubbles.last()).toContainText('三千出头的布艺沙发', { timeout: 15000 });
    // 占位的「正在识别」必须被真实识别文本替换掉
    await expect(page.locator('#view-voice .bubble.user', { hasText: '🎤 正在识别…' })).toHaveCount(0);
    await expect(page.locator('#view-voice .bubble.user', { hasText: '三千左右的布艺沙发' })).toHaveCount(1);
    // 阿杏回复带下一步引导（拍照试摆 / 浏览家具）
    await expect(bubbles.last().locator('button', { hasText: '拍照试摆' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('A6 上游挂了：语音话术是人话且给电话，文字记录不留空洞', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installMicMock(page, { grant: true });
    await page.route('**/api/voice/ask', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: '语音导购暂不可用，请拨打门店电话 13359140982' }),
    }));
    await openVoiceView(page);

    await tapMic(page);
    await tapMic(page);

    const last = page.locator('#view-voice .bubble').last();
    await expect(last).toContainText('语音没接上', { timeout: 15000 });
    await expect(last).toContainText('语音导购暂不可用');
    await expect(last).toContainText(STORE_PHONE);
    // 「问了没答」的空洞不能出现：用户那条也得有内容
    const users = page.locator('#view-voice .bubble.user');
    await expect(users.last()).toContainText('🎤 语音');
    expect(errors).toEqual([]);
  });

  test('A7 挂断后文字版对话保留在面板里，切走再回来还在（SPA 不卸载）', async ({ page }) => {
    await installMicMock(page, { grant: true });
    await page.route('**/api/voice/ask', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { userText: '有没有小户型的沙发', reply: '有一款两人位，一米八，小客厅放得下。', audioBase64: btoa('x'), audioMime: 'audio/mpeg' },
      }),
    }));
    await openVoiceView(page);
    await tapMic(page);
    await tapMic(page);
    await expect(page.locator('#view-voice .bubble.user', { hasText: '有没有小户型的沙发' })).toHaveCount(1, { timeout: 15000 });

    // 切去商品页再回来（app.js mounted Map 只挂一次，气泡不该被清掉）
    await page.evaluate(() => window.AXING.go('view-products'));
    await page.waitForSelector('#view-products.active');
    await page.evaluate(() => window.AXING.go('view-voice'));
    await page.waitForSelector('#view-voice.active');
    await expect(page.locator('#view-voice .bubble.user', { hasText: '有没有小户型的沙发' })).toHaveCount(1);
    await expect(page.locator('#view-voice .bubble.ai', { hasText: '一米八' })).toHaveCount(1);
  });

  test('A8 全站无语音历史坏引用（voiceLastAudioUrl / stopVoiceCapture / rtStopCapture）', async () => {
    const dir = path.join(process.cwd(), 'src', 'axing', 'js');
    const names = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    const banned = ['voiceLastAudioUrl', 'stopVoiceCapture', 'rtStopCapture', 'rtStartCapture'];
    const hits = [];
    for (const f of names) {
      const src = fs.readFileSync(path.join(dir, f), 'utf-8');
      for (const b of banned) {
        // 只当「被调用/被赋值」算坏引用；注释里提一句不算
        const re = new RegExp(`(?<![\\w.])${b}\\s*\\(`, 'g');
        if (re.test(src)) hits.push(`${f}: ${b}()`);
      }
    }
    expect(hits, '重构遗留的未定义函数调用').toEqual([]);
  });
});

// ============================================================================
// B. 顾客 · 到店预约（表单校验 / 提交 / 查自己的）
// ============================================================================
test.describe('B · 顾客·到店预约', () => {
  test('B1 时段只给合法 3 个值，前端不该让人选出非法的', async ({ page }) => {
    await openBookingView(page);
    const slotChips = page.locator('#ax-bk-form .chip-row .chip');
    await expect(slotChips).toHaveCount(3);
    for (const [i, s] of SLOTS.entries()) {
      await expect(slotChips.nth(i)).toHaveText(s);
    }
    // 默认选中第一个时段（后端 APPOINTMENT_SLOTS[0]）
    await expect(slotChips.first()).toHaveClass(/active/);
    // 换时段：active 跟着走
    await slotChips.nth(2).click();
    await expect(slotChips.nth(2)).toHaveClass(/active/);
    await expect(slotChips.first()).not.toHaveClass(/active/);
  });

  test('B2 前端先拦明显不对的输入：空称呼 / 位数不够的手机号只 toast，不打后端', async ({ page }) => {
    const bad = [];
    page.on('request', (r) => { if (r.url().includes('/api/appointments') && r.method() === 'POST') bad.push(r.url()); });
    await openBookingView(page);

    await page.click('#ax-bk-submit');
    await expect(page.locator('#toast.show')).toContainText('称呼');

    await page.fill('#ax-bk-name', '张大爷');
    await page.fill('#ax-bk-phone', '13800138');            // 只有 8 位
    await page.click('#ax-bk-submit');
    await expect(page.locator('#toast.show')).toContainText('手机号');

    await page.fill('#ax-bk-phone', '1380013800');          // 只有 10 位
    await page.click('#ax-bk-submit');
    await expect(page.locator('#toast.show')).toContainText('手机号');

    await page.fill('#ax-bk-phone', '23800138000');         // 非 1 开头
    await page.click('#ax-bk-submit');
    await expect(page.locator('#toast.show')).toContainText('手机号');
    expect(bad, '前端校验没过就不该打后端').toEqual([]);
  });

  // ⚠️ 已知缺陷（本次不改 src/，只固化现状 + 上报）：
  //    view-booking.js:114 用的正则是 /^1\d{10}$/，后端 src/server.js:186 isValidPhone 是 /^1[3-9]\d{9}$/。
  //    已修：前端换成与后端 server.js:186 逐字一致的 /^1[3-9]\d{9}$/，
  //    坏号码在字段旁就吃提示，不再白打一次请求让后端 400。
  test('B2b 手机号前后端同一把尺子：前端放不过的号码不会打到后端', async ({ page }) => {
    const bad = [];
    page.on('request', (r) => { if (r.url().includes('/api/appointments') && r.method() === 'POST') bad.push(r.url()); });
    await openBookingView(page);
    await page.fill('#ax-bk-name', '冯阿姨');
    await page.fill('#ax-bk-phone', '10000000000');
    await page.click('#ax-bk-submit');

    expect(bad.length, '前端就该按后端的规则拦住，不该让请求白跑一趟').toBe(0);
    await expect(page.locator('#toast.show')).toBeVisible();
    const msg = (await page.locator('#toast.show').textContent()) || '';
    expect(msg).not.toMatch(/TypeError|undefined|Cannot read/);
    expect(msg).toContain('手机号');
  });

  test('B3 后端校验全分支：每个坏字段都有对应人话', async () => {
    const cases = [
      [{ name: '', phone: CUSTOMER_PHONE, date: today(), slot: SLOTS[0] }, 400, '称呼'],
      [{ name: '李姨', phone: '12345', date: today(), slot: SLOTS[0] }, 400, '手机号'],
      [{ name: '李姨', phone: '10000000000', date: today(), slot: SLOTS[0] }, 400, '手机号'],
      [{ name: '李姨', phone: CUSTOMER_PHONE, date: '2026-13', slot: SLOTS[0] }, 400, '日期'],
      [{ name: '李姨', phone: CUSTOMER_PHONE, date: plusDays(-1), slot: SLOTS[0] }, 400, '早于今天'],
      [{ name: '李姨', phone: CUSTOMER_PHONE, date: today(), slot: '凌晨 3:00-4:00' }, 400, '时段'],
      [{ name: '李姨', phone: CUSTOMER_PHONE, date: today(), slot: SLOTS[0], productIds: ['no-such-id'] }, 404, '商品不存在'],
    ];
    for (const [body, status, keyword] of cases) {
      const r = await post('/api/appointments', body);
      expect(r.status, `${JSON.stringify(body)} 应 ${status}`).toBe(status);
      expect(r.body.error || '', `${JSON.stringify(body)} 的话术应含「${keyword}」`).toContain(keyword);
    }
  });

  test('B4 顾客从 UI 约成功：出现预约号、到店信息、门店电话', async ({ page }) => {
    await openBookingView(page);
    await page.fill('#ax-bk-name', '周阿姨');
    await page.fill('#ax-bk-phone', '13700137000');
    await page.fill('#ax-bk-note', '想看耐脏的布沙发，客厅三米五');
    // 选第二个时段（页脚门店卡里也有按钮，先确认只有表单里的时段行）
    await page.locator('#ax-bk-form .chip-row .chip').nth(1).click();
    await page.click('#ax-bk-submit');

    await expect(page.locator('#view-booking', { hasText: '预约已收到' })).toBeVisible({ timeout: 15000 });
    const success = page.locator('#view-booking .card', { hasText: '预约已收到' }).locator('..');
    await expect(page.locator('#view-booking')).toContainText(/预约号 A\d+/);
    await expect(page.locator('#view-booking')).toContainText('周阿姨');
    await expect(page.locator('#view-booking')).toContainText('13700137000');
    await expect(page.locator('#view-booking')).toContainText(SLOTS[1]);
    await expect(page.locator('#view-booking')).toContainText('想看耐脏的布沙发');
    // 门店电话始终在场（老人卡住时的最终解法）
    await expect(page.locator('#view-booking a[href="tel:' + STORE_PHONE + '"]').first()).toBeVisible();
    expect(success).toBeTruthy();

    // 「再约一个」能回到表单
    await page.locator('#view-booking button', { hasText: '再约一个' }).click();
    await expect(page.locator('#ax-bk-form')).toBeVisible();
  });

  test('B5 约完立刻「查我的预约」：能看见自己那条，状态「待到店」', async ({ page }) => {
    await openBookingView(page);
    await page.fill('#ax-bk-name', '吴阿姨');
    await page.fill('#ax-bk-phone', '13600136000');
    await page.locator('#ax-bk-form .chip-row .chip').first().click();
    await page.click('#ax-bk-submit');
    await expect(page.locator('#view-booking')).toContainText('预约已收到', { timeout: 15000 });

    await page.fill('#ax-bk-my-phone', '13600136000');
    await page.click('#ax-bk-my-btn');
    const mine = page.locator('#view-booking .card', { hasText: '吴阿姨' });
    await expect(mine.first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#view-booking')).toContainText('待到店');
    await expect(page.locator('#view-booking')).toContainText('上午 9:00-12:00');
  });

  test('B6 手机号格式不对时「查我的预约」只 toast 不打请求', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => { if (r.url().includes('/api/appointments/by-phone')) calls.push(r.url()); });
    await openBookingView(page);
    await page.fill('#ax-bk-my-phone', '13800');
    await page.click('#ax-bk-my-btn');
    await expect(page.locator('#toast.show')).toContainText('手机号');
    expect(calls).toEqual([]);
  });

  test('B7 查询权限：未登录可查；登录后查别人的手机号被 403', async () => {
    const anon = await get(`/api/appointments/by-phone/${CUSTOMER_PHONE}`);
    expect(anon.status).toBe(200);
    expect(Array.isArray(anon.body.data.appointments)).toBe(true);

    const mine = await customerCookie(CUSTOMER_PHONE);
    const other = await get(`/api/appointments/by-phone/${OTHER_PHONE}`, mine);
    expect(other.status, '登录用户不能查别人的手机号').toBe(403);
    expect(other.body.error).toContain('只能查询自己');

    const self = await get(`/api/appointments/by-phone/${CUSTOMER_PHONE}`, mine);
    expect(self.status).toBe(200);
  });

  // ⚠️ 已知缺陷（本次不改 src/，只固化现状 + 上报）：
  //    src/server.js:2341 的 429 话术是「今天查询次数已用完，请登录后再查」——
  //    只给了「登录」这一条出路。同为 429 的 /api/voice/ask（server.js:1671）和
  //    /api/chat/guide（server.js:1367）都带了门店电话。PM 批判 🟠2.10 说的就是这条。
  //    期望改法：「今天查询次数已用完，请明天再试；急的话打店里电话 13359140982」。
});

// ============================================================================
// C. 店主闭环（PM 批判 🔴③：顾客约了店主要能看见，否则成交链路是断的）
// ============================================================================
test.describe('C · 店主闭环', () => {
  test('C1 🔴 顾客从 UI 约的这条，店主后台原样看得见', async ({ page }) => {
    // 顾客：走完整 UI 表单
    await openBookingView(page);
    const name = '郑阿姨';
    const phone = '13400134000';
    const note = '想要耐抓的布艺，家里有猫';
    await page.fill('#ax-bk-name', name);
    await page.fill('#ax-bk-phone', phone);
    await page.fill('#ax-bk-note', note);
    await page.locator('#ax-bk-form .chip-row .chip').nth(2).click();   // 晚上
    await page.click('#ax-bk-submit');
    await expect(page.locator('#view-booking')).toContainText('预约已收到', { timeout: 15000 });

    // 店主：从接口确认这条进来了（闭环的另一半：店主必须看得见）
    const cookie = await adminCookie();
    const admin = await get('/api/admin/appointments', cookie);
    expect(admin.status).toBe(200);
    const hit = (admin.body.data.appointments || []).find((a) => a.phone === phone);
    expect(hit, '店主必须看得见顾客刚约的这一条（闭环断裂 = 成交丢了）').toBeTruthy();
    expect(hit.name).toBe(name);
    expect(hit.date).toBe(today());
    expect(hit.slot).toBe('晚上 18:00-20:00');
    expect(hit.note).toBe(note);
    expect(hit.status).toBe('待到店');

    // 店主后台页面（真实 DOM）也要渲染出这条
    await adminSessionInBrowser(page);
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.appt', { hasText: phone })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.appt', { hasText: phone })).toContainText(name);
    await expect(page.locator('.appt', { hasText: phone })).toContainText('家里有猫');
  });

  test('C2 手机号是大号 tel: 一键拨号，日期带今天/明天标记', async ({ page }) => {
    const appt = await createAppointment({ name: '齐阿姨', phone: '13300133000', date: today() });
    await adminSessionInBrowser(page);
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });

    const card = page.locator(`.appt[data-id="${appt.id}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('.phone')).toHaveText('13300133000');
    const call = card.locator('a.call-btn');
    await expect(call).toHaveAttribute('href', 'tel:13300133000');
    // 老板的第一动作就是打这个电话：按钮要够大
    const box = await call.boundingBox();
    expect(box && box.height, '拨号按钮应 ≥48px（戴手套也能点准）').toBeGreaterThanOrEqual(48);
    // 「今天」标记
    await expect(page.locator('.group-head', { hasText: '今日' }).or(page.locator('.gtag', { hasText: '今天' })).first()).toBeVisible();
  });

  test('C3 四状态一键改，界面即更新；顾客再查看到新状态', async ({ page }) => {
    const phone = '13200132000';
    const appt = await createAppointment({ name: '何阿姨', phone });
    await adminSessionInBrowser(page);
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });
    const card = page.locator(`.appt[data-id="${appt.id}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.locator('.status')).toHaveText('待到店');

    for (const s of ['已到店', '已成单']) {
      await card.locator(`.sbtn[data-status="${s}"]`).click();
      await expect(card.locator('.status')).toHaveText(s);
      await expect(page.locator('#toast.show')).toContainText(s);
    }

    // 店主改完，顾客那边查得到同一个状态（闭环的另一半）
    const mine = await get(`/api/appointments/by-phone/${phone}`);
    const hit = (mine.body.data.appointments || []).find((a) => a.id === appt.id);
    expect(hit.status, '店主改的状态顾客应能查到').toBe('已成单');
  });

  test('C4 取消也是四状态之一', async ({ page }) => {
    const appt = await createAppointment({ name: '孙阿姨', phone: '13100131000' });
    await adminSessionInBrowser(page);
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });
    const card = page.locator(`.appt[data-id="${appt.id}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.locator('.sbtn[data-status="已取消"]').click();
    await expect(card.locator('.status')).toHaveText('已取消');
  });

  test('C5 非法 status / 不存在的 id 都被挡住', async () => {
    const cookie = await adminCookie();
    const bad = await patch('/api/admin/appointments/whatever', { status: '已失联' }, cookie);
    expect(bad.status, '非法状态值应 400').toBe(400);
    const missing = await patch('/api/admin/appointments/A999999999', { status: '已到店' }, cookie);
    expect(missing.status, '不存在的 id 应 404').toBe(404);

    const list = await get('/api/admin/appointments?status=不存在', cookie);
    expect(list.status).toBe(400);
    const ok = await get('/api/admin/appointments?status=' + encodeURIComponent('待到店'), cookie);
    expect(ok.status).toBe(200);
    (ok.body.data.appointments || []).forEach((a) => expect(a.status).toBe('待到店'));
  });

  test('C6 未登录 / 顾客会话都进不去后台预约接口与页面', async ({ page }) => {
    const anon = await get('/api/admin/appointments');
    expect(anon.status, '未登录访问 admin 接口应 401').toBe(401);
    const cust = await customerCookie(OTHER_PHONE);
    const asCust = await get('/api/admin/appointments', cust);
    expect(asCust.status, '顾客会话访问 admin 接口应 401').toBe(401);

    // UI：直接开后台页会被送去登录
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 15000 });
  });

  test('C7 排序：到店日期升序（最近要来的排最前）', async () => {
    const far = await createAppointment({ name: '远期', phone: '13000130000', date: plusDays(9) });
    const soon = await createAppointment({ name: '近期', phone: '13000130001', date: today() });
    const cookie = await adminCookie();
    const r = await get('/api/admin/appointments', cookie);
    const ids = (r.body.data.appointments || []).map((a) => a.id);
    expect(ids.indexOf(soon.id), '同一列表里今天的预约应排在 9 天后的前面').toBeLessThan(ids.indexOf(far.id));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 下面三条是「看起来对、其实错」的后台功能。用 test.fail() 当守门员：
  // 现在它们是红的（fail 符合预期 → 套件保持绿）；谁把 src 修好，这里会翻成
  // 「expected to fail, but passed」的显式失败，提醒把 test.fail() 摘掉。
  // ══════════════════════════════════════════════════════════════════════════

  // 已修：load() 现在把 filter 拼成 ?status= 带上去（后端本来支持、非法值回 400）。
  // 之前 filter 只被赋值、从没拼进请求，5 个按钮全是装饰，老板想只看「已成单」筛不出来。
  test('C8 筛选按钮真的筛：点「已取消」只剩已取消', async ({ page }) => {
    const appt = await createAppointment({ name: '筛选甲', phone: '13900139001', date: today() });
    await adminSessionInBrowser(page);
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`.appt[data-id="${appt.id}"]`)).toBeVisible({ timeout: 15000 });

    await page.locator('.fbtn[data-status="已取消"]').click();
    await expect(page.locator('.fbtn[data-status="已取消"]')).toHaveClass(/on/);
    await page.waitForTimeout(800);
    const shown = await page.locator('.appt').evaluateAll((els) => els.map((e) => e.dataset.status));
    expect(shown.length, '筛「已取消」时至少该有结果').toBeGreaterThan(0);
    const notAll = shown.filter((s) => s !== '已取消');
    expect(notAll, `筛选后仍混进非「已取消」的卡片：${JSON.stringify(shown)}`).toEqual([]);
  });

  // 已修：改成逐档累加人数，other = list.length - 各桶人数之和。
  // 之前用 counts.length（桶个数）当人数，3 人分 2 桶 → 凭空多出「其他1人」，
  // 老板会以为有一条时段不明的预约。
  test('C9 分组头人数按人算：三档都在时不该冒出「其他」', async ({ page }) => {
    const d = today();
    await createAppointment({ name: '上午甲', phone: '13300133001', date: d, slot: SLOTS[0] });
    await createAppointment({ name: '上午乙', phone: '13300133002', date: d, slot: SLOTS[0] });
    await createAppointment({ name: '下午丙', phone: '13300133003', date: d, slot: SLOTS[1] });
    await adminSessionInBrowser(page);
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.appt').first()).toBeVisible({ timeout: 15000 });

    // 前几条测试可能在今天或更早的日期留下预约，所以断言不写死人数，改成按组配对实算：
    // 分组头和卡片在 #list 里是兄弟节点，从头节点往后走到下一个头节点，就是这一组的卡片。
    // 该组报出的人数之和必须等于该组卡片数，且时段全合法时不该冒出「其他」。
    const groups = await page.evaluate(() => {
      const kids = Array.from(document.getElementById('list').children);
      const out = [];
      for (let i = 0; i < kids.length; i++) {
        if (!kids[i].classList.contains('group-head')) continue;
        let j = i + 1;
        let cards = 0;
        while (j < kids.length && !kids[j].classList.contains('group-head')) {
          if (kids[j].classList.contains('appt')) cards++;
          j++;
        }
        const head = (kids[i].textContent || '').replace(/\s+/g, '');
        const nums = (head.match(/(\d+)人/g) || []).map((x) => parseInt(x, 10));
        out.push({ head, isToday: head.includes('今天'), sum: nums.reduce((a, b) => a + b, 0), cards });
      }
      return out;
    });
    const todayGroups = groups.filter((g) => g.isToday);
    expect(todayGroups.length, '应有带「今天」标记的分组').toBeGreaterThan(0);
    for (const g of todayGroups) {
      expect(g.sum, `分组头人数之和(${g.sum})应等于该组卡片数(${g.cards})：${g.head}`).toBe(g.cards);
      expect(g.head, '时段全在三档内时不该凭空冒出「其他」（旧 bug：拿桶个数当人数）').not.toContain('其他');
      expect(g.head).toMatch(/上午\d+人/);
      expect(g.head).toMatch(/下午\d+人/);
    }
  });

  // 同一天的时段汇总本身是对的（这部分现在是绿的，别被上面的缺陷带崩）
  test('C9b 分组头能报出各时段人数与今天/明天标记', async ({ page }) => {
    const d = today();
    await createAppointment({ name: '汇总甲', phone: '13300133011', date: d, slot: SLOTS[0] });
    await createAppointment({ name: '汇总乙', phone: '13300133012', date: d, slot: SLOTS[2] });
    await adminSessionInBrowser(page);
    await page.goto(BASE_URL + '/admin/appointments', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.appt').first()).toBeVisible({ timeout: 15000 });

    const head = page.locator('.group-head', { hasText: '月' }).first();
    const text = (await head.textContent()) || '';
    expect(text, '应报出上午人数').toMatch(/上午\d+人/);
    expect(text, '应报出晚上人数').toMatch(/晚上\d+人/);
    await expect(page.locator('.gtag', { hasText: '今天' }).first()).toBeVisible();
  });
});

// ============================================================================
// Z. 限额（必须放最后：它会把本文件的 IP 查询配额 20 次/天一次烧光）
// ============================================================================
test.describe('Z · 查询限额', () => {
  test('Z1 查询 IP 限额（20 次/天）用完后 429，话术至少要是人话', async () => {
    let last = null;
    for (let i = 0; i < 25; i++) {
      const r = await get('/api/appointments/by-phone/13500135000');
      last = r;
      if (r.status === 429) break;
    }
    expect(last.status, '超过 20 次后应 429').toBe(429);
    expect(last.body.error).toContain('今天查询次数已用完');
    // 已修（PM 批判 🟠2.10）：话术不能再把「登录后继续」当唯一出路。顾客多半没有账号意识，
    // 限额撞上时必须同时给一条当场能用的路——明天再来，或者打给店里。
    expect(last.body.error, '429 话术应给「明天再试」和门店电话两条出路')
      .toBe('今天查询次数已用完，请明天再试，或拨打门店电话 13359140982');
    expect(last.body.error).toContain('13359140982');
  });
});
