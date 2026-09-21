import { test, expect } from '@playwright/test';
import http from 'http';
import { buildOrderPushBody, pushOrderToWechat } from '../src/serverchan.js';

// 本地 mock Server酱：记录收到的 title/desp，按 key 前缀决定成功/失败
let mockServer;
let mockBase;
let lastPush = null;

test.beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      lastPush = { path: req.url, title: params.get('title'), desp: params.get('desp') };
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/failkey')) {
        res.statusCode = 200;
        res.end(JSON.stringify({ code: 1024, message: 'SendKey 不对' }));
      } else {
        res.end(JSON.stringify({ code: 0, message: '', data: { pushid: 'x' } }));
      }
    });
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockBase = `http://127.0.0.1:${mockServer.address().port}`;
});

test.afterAll(() => new Promise((resolve) => mockServer.close(resolve)));

const sampleOrder = {
  id: 'O2609ABC',
  name: '张先生',
  phone: '13800138000',
  productName: '新中式三人沙发',
  productPrice: '¥2999起',
  quantity: 1,
  address: '商洛市柞水县农机路',
  spec: '',
  note: '',
  createdAt: '2026-09-21T10:00:00.000Z',
};

test('buildOrderPushBody：标题、正文字段、空 spec/note 被过滤、数量倍数', () => {
  const { title, desp } = buildOrderPushBody({ ...sampleOrder, quantity: 2, spec: '要深色', note: '' });
  expect(title).toBe('新订单 O2609ABC');
  expect(desp).toContain('张先生');
  expect(desp).toContain('13800138000');
  expect(desp).toContain('新中式三人沙发');
  expect(desp).toContain('×2');
  expect(desp).toContain('要深色');
  expect(desp).not.toContain('**备注**'); // note 空 → 不出现备注行
});

test('无 sendKey 时跳过推送', async () => {
  const r = await pushOrderToWechat(sampleOrder, { apiBase: mockBase });
  expect(r.skipped).toBe(true);
});

test('enabled:false 时跳过推送', async () => {
  const r = await pushOrderToWechat(sampleOrder, { sendKey: 'goodkey', enabled: false, apiBase: mockBase });
  expect(r.skipped).toBe(true);
});

test('配置齐全时推送成功且内容正确送达', async () => {
  lastPush = null;
  const r = await pushOrderToWechat(sampleOrder, { sendKey: 'goodkey', apiBase: mockBase });
  expect(r.ok).toBe(true);
  expect(lastPush).not.toBeNull();
  expect(lastPush.path).toBe('/goodkey.send');
  expect(lastPush.title).toBe('新订单 O2609ABC');
  expect(lastPush.desp).toContain('13800138000');
});

test('上游返回非 0 code 时 ok:false 且不抛错', async () => {
  const r = await pushOrderToWechat(sampleOrder, { sendKey: 'failkey', apiBase: mockBase });
  expect(r.ok).toBe(false);
});

test('上游不可达时 ok:false 且不抛错（fire-and-forget 安全）', async () => {
  const r = await pushOrderToWechat(sampleOrder, { sendKey: 'goodkey', apiBase: 'http://127.0.0.1:1' });
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
});
