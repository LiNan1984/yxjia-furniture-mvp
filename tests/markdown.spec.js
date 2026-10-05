// ============================================================================
// Markdown 渲染器验收（docs/阿杏交互规范.md §4）
// ============================================================================
// 覆盖什么：
//   1. 结构化渲染 —— 阿杏回复里的标题 / 表格 / 列表 / 引用 / 粗体都变成 .md-* DOM，
//                    不漏裸的 ## 、| --- 、| 商品 |
//   2. 流式收敛   —— push(chunk) 逐段喂完再接 finish(整篇)，结果仍是结构化表格
//   3. XSS        —— <img onerror> / <script> / [x](javascript:) 不进 DOM
//   4. 列表       —— `- a` 进 .md-ul/.md-li
//   5. 边界       —— reset() 清空宿主、空串不炸、不泄漏 .ynet-md-* 类、不注入上游 <style>
//
// 端口：3425（独立 spawn，不复用 playwright.config.js 的 3000，也不碰
//       3100 / 3412 / 3420 / 3430 / 3431 / 3432 / 3433 的阿杏其他测试文件）
// 单独跑：./node_modules/.bin/playwright test tests/markdown.spec.js --reporter=line
//
// 说明：只验收 `src/axing/js/markdown.js` 的对外契约
//         renderMarkdown(src) -> DocumentFragment
//         createMarkdownStream(host) -> { push(delta), reset(), finish(fullText), snapshot() }
//       chat-core 怎么接线它，是 axing-interaction.test.js A4 的事，这里不碰。
//
// ⚠️ 上游（vendor 的 ynet 解析器）把 `- a` 和 `1. a` 都输出成 list_item，
//    且 stripListPrefix 会丢掉序号（上游文档原文：「有序列表只保留文本，不保留序号」）。
//    所以渲染层统一成 <ul>，**没有 .md-ol**。要 <ol> 得改上游 parser，
//    不是这层适配能补的——因此本文件不断言 .md-ol。
// ============================================================================
import { test, expect } from '@playwright/test';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 3425;                       // ⚠️ 被占用时改 3426 并在报告里说明
const BASE_URL = `http://127.0.0.1:${PORT}`;

const MD_REPLY = [
  '为你找到一款合适的：',
  '',
  '## 植物印花弧形布艺沙发',
  '',
  '| 商品 | 价格 | 编号 |',
  '| --- | --- | --- |',
  '| 植物印花弧形布艺沙发 | ¥2899起 | p-1 |',
  '',
  '- **材质**：粗纺布艺软包',
  '- 库存：现货在售',
  '',
  '> 到店试坐，感受下坐感。',
  '',
  '用 `科技布` 更好打理。',
].join('\n');

let serverProc = null;

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${pathname}`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
  });
}

async function waitServerReady(timeoutMs = 30000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error(`Markdown 测试服务器启动超时（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  // ⚠️ 不能传 NODE_ENV=test：server.js 的 listen() 被 `if (process.env.NODE_ENV !== 'test')` 包着
  serverProc = spawn('node', ['src/server.js'], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitServerReady();
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
});

/** 探针：把 renderMarkdown / createMarkdownStream 的真实能力摘成可断言的摘要 */
async function renderInPage(page, markdown, { stream = null } = {}) {
  // 必须先 goto 到本实例的域名下：动态 import 的裸绝对路径 '/axing/js/markdown.js'
  // 要按文档 baseURL 解析，挂在 about:blank 上会 Failed to resolve module specifier。
  await page.goto(`${BASE_URL}/axing#view-home`, { waitUntil: 'domcontentloaded' });
  return page.evaluate(async ({ md, chunks }) => {
    const m = await import('/axing/js/markdown.js');
    const box = document.createElement('div');
    document.body.appendChild(box);

    const q = (sel) => Array.from(box.querySelectorAll(sel));
    const summary = () => ({
      html: box.innerHTML,
      text: box.textContent || '',
      counts: {
        h2: q('.md-h2').length,
        table: q('.md-table').length,
        th: q('.md-table .md-th').length,
        td: q('.md-table .md-td').length,
        li: q('.md-li').length,
        ul: q('.md-ul').length,
        quote: q('.md-quote').length,
        strong: q('.md-strong').length,
        codeinline: q('.md-codeinline').length,
        hr: q('.md-hr').length,
        pre: q('.md-pre').length,
        ynet: q('[class*="ynet-md"]').length,
      },
      hrefs: q('.md-a').map((a) => a.getAttribute('href')),
      dangerous: {
        script: box.querySelectorAll('script').length,
        imgOnerror: box.querySelectorAll('img[onerror]').length,
        jsHref: q('a').filter((a) => (a.getAttribute('href') || '').startsWith('javascript:')).length,
      },
      ynetStyleInjected: !!document.querySelector('style[data-ynet-markdown]'),
    });

    const out = {
      hasRenderMarkdown: typeof m.renderMarkdown === 'function',
      hasCreateStream: typeof m.createMarkdownStream === 'function',
    };
    if (chunks) {
      const s = m.createMarkdownStream(box);
      chunks.forEach((c) => s.push(c));
      out.midStream = summary();
      s.finish(md);
    } else {
      box.appendChild(m.renderMarkdown(md));
    }
    out.final = summary();

    // 边界：空串不炸
    let emptyOk = true;
    try { m.renderMarkdown(''); } catch { emptyOk = false; }
    out.emptyOk = emptyOk;
    // 边界：reset() 清空宿主
    const s2 = m.createMarkdownStream(box);
    s2.push('## hello');
    s2.reset();
    out.resetCleared = box.textContent === '';
    // 边界：createMarkdownStream 不给宿主要抛错（否则是静默烂尾）
    let throwsWithoutHost = false;
    try { m.createMarkdownStream(null); } catch { throwsWithoutHost = true; }
    out.throwsWithoutHost = throwsWithoutHost;
    return out;
  }, { md: markdown, chunks: stream });
}

// ---------------------------------------------------------------- 1. 结构化渲染

test('markdown: 阿杏回复渲染成 .md-* 结构化 DOM，不漏裸 # / 表格竖线', async ({ page }) => {
  const r = await renderInPage(page, MD_REPLY);

  expect(r.hasRenderMarkdown, 'markdown.js 应导出 renderMarkdown').toBe(true);
  expect(r.hasCreateStream, 'markdown.js 应导出 createMarkdownStream').toBe(true);

  const c = r.final.counts;
  expect(c.h2, '二级标题应渲染成 .md-h2').toBe(1);
  expect(c.table, '表格应渲染成 .md-table').toBe(1);
  expect(c.th, '表头应有 3 个 .md-th').toBe(3);
  expect(c.td, '数据行应有 3 个 .md-td').toBe(3);
  expect(c.li, '两条列表项应渲染成 .md-li').toBe(2);
  expect(c.ul, '列表容器应是 .md-ul').toBe(1);
  expect(c.quote, '引用块应渲染成 .md-quote').toBe(1);
  expect(c.strong, '**材质** 应渲染成 .md-strong').toBe(1);
  expect(c.codeinline, '`科技布` 应渲染成 .md-codeinline').toBe(1);

  // 不许把 Markdown 骨架裸着吐给顾客
  expect(r.final.text, '正文里不该出现裸的 ## 标题符').not.toContain('##');
  expect(r.final.text, '正文里不该出现表格分隔行').not.toContain('| ---');
  expect(r.final.text, '正文里不该出现裸的表格竖线').not.toContain('| 商品 |');
  expect(r.final.html, '表格标题文字应在 DOM 里').toContain('植物印花弧形布艺沙发');
});

// ---------------------------------------------------------------- 2. 流式收敛

test('markdown: 流式 push 逐段喂 + finish 兜底 → 收敛成结构化表格', async ({ page }) => {
  const chunks = MD_REPLY.match(/[\s\S]{1,7}/g) || [];
  const r = await renderInPage(page, MD_REPLY, { stream: chunks });

  const c = r.final.counts;
  expect(c.h2, 'finish 后应仍是 1 个 .md-h2').toBe(1);
  expect(c.table, 'finish 后应仍是 1 个 .md-table').toBe(1);
  expect(c.th, 'finish 后表头仍是 3 列').toBe(3);
  expect(c.td, 'finish 后数据行仍是 3 格').toBe(3);
  expect(r.final.text).not.toContain('| ---');

  // 半截表格（只有表头行、没有 | --- | 分隔行）时也不许崩、不许留成表格
  const half = await page.evaluate(async () => {
    const m = await import('/axing/js/markdown.js');
    const box = document.createElement('div');
    document.body.appendChild(box);
    const s = m.createMarkdownStream(box);
    s.push('| 项目 | 详情 |');
    const mid = { tables: box.querySelectorAll('.md-table').length, text: box.textContent };
    s.finish('| 项目 | 详情 |');
    return { mid, after: { tables: box.querySelectorAll('.md-table').length } };
  });
  expect(half.mid.tables, '只有表头行时不该被当成表格渲染').toBe(0);
});

// ---------------------------------------------------------------- 3. XSS

test('markdown: XSS——script / onerror / javascript: 链接都不进 DOM', async ({ page }) => {
  const evil = [
    '<script>alert(1)</script>',
    '',
    '<img src="x" onerror="alert(1)">',
    '',
    '[点我](javascript:alert(1))',
    '',
    '[正常链接](https://example.com)',
    '',
    '![图](https://example.com/a.png)',
  ].join('\n');
  const r = await renderInPage(page, evil);
  const d = r.final.dangerous;
  expect(d.script, 'script 标签不该进 DOM').toBe(0);
  expect(d.imgOnerror, '带 onerror 的 img 不该进 DOM').toBe(0);
  expect(d.jsHref, 'javascript: 链接必须降级').toBe(0);
  expect(r.final.hrefs, '合法 https 链接应保留为 .md-a').toContain('https://example.com');
});

// ---------------------------------------------------------------- 4. 列表与分割线

test('markdown: §4-2 语法清单——h1~h6 / ul / 引用 / 代码块 / 分割线', async ({ page }) => {
  const md = [
    '# 一级', '## 二级', '### 三级', '#### 四级', '##### 五级', '###### 六级',
    '',
    '- 无序一', '* 无序二',
    '',
    '> 引用内容',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '---',
  ].join('\n');
  const r = await renderInPage(page, md);
  const c = r.final.counts;
  expect(c.ul, '无序列表应渲染成 .md-ul').toBe(1);
  expect(c.li, '两条无序项').toBe(2);
  expect(c.quote, '引用块').toBe(1);
  expect(c.pre, '代码块应渲染成 .md-pre').toBe(1);
  expect(c.hr, '分割线应渲染成 .md-hr').toBe(1);
  // 六个标题层级都要在
  const heads = await page.evaluate(async (src) => {
    const m = await import('/axing/js/markdown.js');
    const box = document.createElement('div');
    document.body.appendChild(box);
    box.appendChild(m.renderMarkdown(src));
    return [1, 2, 3, 4, 5, 6].map((n) => box.querySelectorAll(`.md-h${n}`).length);
  }, md);
  expect(heads, 'h1~h6 各应有一个').toEqual([1, 1, 1, 1, 1, 1]);
});

// ---------------------------------------------------------------- 5. 边界与上游污染

test('markdown: clear/reset 清空宿主，空串不炸，不泄漏 ynet 类与上游 <style>', async ({ page }) => {
  const r = await renderInPage(page, MD_REPLY);

  expect(r.emptyOk, 'renderMarkdown("") 不该抛错').toBe(true);
  expect(r.throwsWithoutHost, 'createMarkdownStream(null) 应该抛错，而不是静默烂尾').toBe(true);
  expect(r.resetCleared, 'reset() 后宿主应被清空').toBe(true);

  // 上游引擎的类名与内联样式都不该漏到阿杏这边（两色调铁律）
  expect(r.final.counts.ynet, '不该出现 ynet-md-* 类').toBe(0);
  expect(r.final.ynetStyleInjected, '不该注入上游的 injectMarkdownStyle <style>（含 #2F7CF6 蓝 / #B42318 红）').toBe(false);
  expect(r.final.html, '不该出现上游写死的品牌蓝').not.toContain('#2F7CF6');
  expect(r.final.html, '不该出现上游写死的错误红').not.toContain('#B42318');
});
