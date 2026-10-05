// ============================================================================
// markdown-render.spec.js —— Markdown 渲染引擎验收（质量 / XSS / 两色调 / 流式）
// ============================================================================
// 覆盖什么：
//   1. 语法全量   —— h1~h6 / ul / 表格 / 引用 / 代码块 / 行内代码 / 粗体 / 斜体 /
//                    删除线 / 分割线 / 链接 / 图片 / [[color:…]] 指令剥离
//   2. 无裸标记   —— 可见文本里不允许漏出 `#`、`**`、`| ---`、` ``` `
//   3. XSS（最高优先级）—— script / iframe / on* 属性 / javascript: / vbscript: /
//                    data:text-html / 内联 onclick，一律不进 DOM 且不抛异常
//   4. 两色调铁律 —— 渲染结果的 computed color 不许出现上游蓝 #2F7CF6 (47,124,246)
//                    与上游错误红 #B42318 (180,35,24)；也不该有别的原色
//   5. 流式       —— 半截 Markdown（表格只写到一半）不崩，finish() 后收敛成结构化
//   6. 边界       —— 空串 / null / undefined / 超长 / 单个巨大表格 / 深层嵌套
//
// 端口：3515（独立 spawn，不复用 playwright.config.js 的 3000，也不碰 3514 的 3D 组）
// 单独跑：./node_modules/.bin/playwright test tests/markdown-render.spec.js --reporter=line
//
// 只验收 src/axing/js/markdown.js 的对外契约：
//   renderMarkdown(src) -> DocumentFragment
//   createMarkdownStream(host) -> { push, reset, finish, snapshot }
//
// ⚠️ 已知取舍（不是本轮要改的）：上游 parser 把 `- a` 和 `1. a` 都输出 list_item 并丢掉序号，
//    渲染层统一成 <ul>，所以 **有序列表序号不保留**。CLAUDE.md §16 已记录。
//    本文件按现状断言（保证不假装通过），把「序号丢失」作为独立用例显式标注出来。
// ============================================================================
import { test, expect } from '@playwright/test';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 3515;                       // ⚠️ 被占用时改 3516 并在报告里说明
const BASE_URL = `http://127.0.0.1:${PORT}`;

// 两色调 + 辅色：允许出现的 color（来自 css/axing.css 的 token）
const ALLOWED_COLORS = new Set([
  'rgb(44, 44, 44)',      // --c-charcoal #2C2C2C
  'rgb(247, 244, 239)',   // --c-cream     #F7F4EF
  'rgb(217, 212, 205)',   // --c-stone     #D9D4CD
  'rgb(119, 114, 108)',   // --c-gray      #77726C
  'rgb(201, 143, 85)',    // --c-apricot-deep #C98F55
  'rgb(201, 113, 43)',    // --c-apricot-ink  #C9712B
  'rgb(44, 40, 24)',      // 深咖 #3A2818（主站老 token，卡片里偶见）
]);
// 上游 injectMarkdownStyle() 会注入的两个标志色，出现即越界
const FORBIDDEN_COLORS = {
  'rgb(47, 124, 246)': '上游品牌蓝 #2F7CF6',
  'rgb(180, 35, 24)': '上游错误红 #B42318',
};

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

async function waitServerReady(timeoutMs = 40000) {
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
  serverProc = spawn('node', ['src/server.js'], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitServerReady();
});

test.afterAll(() => { if (serverProc) serverProc.kill(); });

/** 探针：把 Markdown 渲染结果摘成可断言摘要 */
async function render(page, markdown, { stream = null } = {}) {
  await page.goto(`${BASE_URL}/axing#view-home`, { waitUntil: 'domcontentloaded' });
  return page.evaluate(async ({ md, chunks }) => {
    const m = await import('/axing/js/markdown.js');
    const box = document.createElement('div');
    box.id = 'md-probe';
    document.body.appendChild(box);

    const summary = () => {
      const q = (sel) => Array.from(box.querySelectorAll(sel));
      const all = Array.from(box.querySelectorAll('*'));
      // 每个块级元素的可见文字（单元格内容包在 .md-inline 里，必须用 textContent 才取得到）
      const blockTexts = q('.md-p, .md-h1, .md-h2, .md-h3, .md-h4, .md-h5, .md-h6, .md-li, .md-td, .md-th')
        .map((n) => n.textContent || '').join('');
      return {
        text: box.textContent || '',
        blockTexts,
        html: box.innerHTML,
        classes: Array.from(new Set(all.flatMap((n) => String(n.className || '').split(/\s+/)).filter((c) => c.startsWith('md-')))),
        hrefs: q('.md-a').map((a) => a.getAttribute('href')),
        imgSrcs: q('img').map((i) => i.getAttribute('src')),
        colors: Array.from(new Set(all.map((n) => getComputedStyle(n).color))),
        dangerous: {
          scripts: box.querySelectorAll('script').length,
          iframes: box.querySelectorAll('iframe').length,
          objects: box.querySelectorAll('object,embed').length,
          onAttrs: all.filter((n) => Array.from(n.attributes).some((a) => /^on/i.test(a.name))).length,
          badHrefs: Array.from(box.querySelectorAll('a[href]'))
            .map((a) => a.getAttribute('href'))
            .filter((h) => !/^(https?:|tel:|#|\/)/i.test((h || '').trim())).length,
          // innerHTML 里不该有「未转义」的危险标签。渲染器只产出 md-* 标签 + a/img/strong/em/del/hr，
          // 所以下面这些一旦以 <xxx 形式出现就是真注入。被转义成 &lt;script&gt; 的可见文字不算。
          // ⚠️ 不能查 ' onerror=' / ' javascript:' 这类裸子串——它们会命中转义后的文本。
          rawInHtml: ['<script', '<iframe', '<object', '<embed', '<base', '<meta', '<svg', '<form']
            .filter((needle) => (box.innerHTML || '').toLowerCase().includes(needle)),
          jsHrefs: Array.from(box.querySelectorAll('a[href]'))
            .filter((a) => /^\s*(javascript|vbscript|data|file):/i.test(a.getAttribute('href') || '')).length,
          onAttrElements: all.filter((n) => Array.from(n.attributes).some((a) => /^on/i.test(a.name))).length,
        },
      };
    };

    const out = {};
    if (chunks) {
      const s = m.createMarkdownStream(box);
      let threw = null;
      try { chunks.forEach((c) => s.push(c)); } catch (e) { threw = String(e); }
      out.midThrew = threw;
      out.mid = summary();
      s.finish(md);
      out.final = summary();
      out.snapshot = s.snapshot();
    } else {
      let threw = null;
      try { box.appendChild(m.renderMarkdown(md)); } catch (e) { threw = String(e); }
      out.threw = threw;
      out.final = summary();
    }
    // ⚠️ 不要把 reset() 检查写在这里：它会 host.textContent = '' 把宿主清空，
    //    调用方后面再查 DOM 就什么都拿不到。（reset 的行为由 7.5 单独验收。）
    return out;
  }, { md: markdown, chunks: stream });
}

const GUIDE_REPLY = [
  '好的，按你的预算推荐这两款：',
  '',
  '## 三千左右的布艺沙发',
  '',
  '| 商品 | 价格 | 特点 |',
  '| --- | --- | --- |',
  '| 植物印花弧形布艺沙发 | ¥2899 起 | 粗纺布艺，坐感偏软 |',
  '| 浅灰色弧形科技布沙发 | ¥3200 起 | 科技布，好打理 |',
  '',
  '- **适合**：客厅 3 米以上',
  '- 家有猫的话建议科技布',
  '',
  '> 到店可以实际坐一坐，感受下坐感。',
  '',
  '用 `科技布` 更耐猫抓。想看效果就上传一张客厅照片。',
].join('\n');

// ============================================================================
// 1. 语法全量渲染
// ============================================================================
test.describe('1 · 语法全量', () => {
  test('1.1 h1~h6 全部渲染成 .md-h1~.md-h6', async ({ page }) => {
    const r = await render(page, '# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六');
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(r.final.classes, `h${n} 应有 .md-h${n}`).toContain(`md-h${n}`);
    }
  });

  test('1.2 表格渲染成 .md-table，表头/表体/单元格都分开', async ({ page }) => {
    const md = ['| 商品 | 价格 |', '| --- | --- |', '| 沙发 | ¥2899 |', '| 床 | ¥1999 |'].join('\n');
    const r = await render(page, md);
    expect(r.final.classes).toContain('md-table');
    expect(r.final.classes).toContain('md-thead');
    expect(r.final.classes).toContain('md-tbody');
    const cells = await page.evaluate(() => ({
      th: document.querySelectorAll('#md-probe .md-th').length,
      td: document.querySelectorAll('#md-probe .md-td').length,
      tr: document.querySelectorAll('#md-probe .md-tr').length,
    }));
    expect(cells.th, '2 个表头单元格').toBe(2);
    expect(cells.td, '4 个数据单元格').toBe(4);
    expect(cells.tr, '3 行（1 表头 + 2 数据）').toBe(3);
    expect(r.final.blockTexts).toContain('¥2899');
  });

  test('1.3 真实导购回复整篇渲染：标题/表格/列表/引用/行内代码/粗体都在', async ({ page }) => {
    const r = await render(page, GUIDE_REPLY);
    const c = r.final.classes;
    for (const k of ['md-h2', 'md-table', 'md-ul', 'md-li', 'md-quote', 'md-codeinline', 'md-strong']) {
      expect(c, `导购回复应含 ${k}`).toContain(k);
    }
    expect(r.final.text).toContain('植物印花弧形布艺沙发');
    expect(r.final.text).toContain('¥2899');
    expect(r.threw, '不该抛异常').toBe(null);
  });

  test('1.4 删除线 ~~x~~ 与 __粗体__ 都被补齐（上游不直接支持）', async ({ page }) => {
    const r = await render(page, '~~已下架~~ 和 __重点__');
    expect(r.final.classes, '删除线应成 .md-del').toContain('md-del');
    expect(r.final.classes, '__粗体__ 应成 .md-strong').toContain('md-strong');
    expect(r.final.text).toContain('已下架');
    expect(r.final.text).toContain('重点');
  });

  test('1.5 [[color:…]] / [[pill:…]] 指令被剥成纯文字，不写死原色', async ({ page }) => {
    const r = await render(page, '[[color:blue|蓝色字]] 和 [[pill:红|红丸]] 和 [[style:custom|样式块]]');
    expect(r.final.text, '指令语法不该出现在可见文本里').not.toContain('[[');
    expect(r.final.text).toContain('蓝色字');
    expect(r.final.text).toContain('红丸');
    expect(r.final.text).toContain('样式块');
    for (const [hex, name] of [['rgb(0, 0, 255)', '纯蓝'], ['rgb(255, 0, 0)', '纯红'], ['rgb(255, 255, 0)', '纯黄']]) {
      expect(r.final.colors, `不该出现${name}`).not.toContain(hex);
    }
  });

  test('1.6 链接：http/https/tel 保留，站外链加 target=_blank + rel=noreferrer', async ({ page }) => {
    // 白名单只有 https?: / tel:（src/axing/js/markdown.js SAFE_HREF）。
    // 相对链接（/products）会被降级成纯文本节点——保守但安全，这里把现状钉住。
    const r = await render(page, '[官网](https://example.com) [门店](tel:13359140982) [站内](/products)');
    expect(r.final.hrefs).toEqual(['https://example.com', 'tel:13359140982']);
    expect(r.final.text, '被降级的相对链接应留下可读文字').toContain('站内');
    const rels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#md-probe .md-a')).map((a) => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel'), target: a.getAttribute('target') })));
    const ext = rels.find((x) => x.href === 'https://example.com');
    expect(ext.target, '站外链新开标签').toBe('_blank');
    expect(ext.rel, '站外链必须带 noreferrer').toContain('noreferrer');
    const tel = rels.find((x) => x.href.startsWith('tel:'));
    expect(tel.target, 'tel: 不该新开标签（老人友好：别顶掉页面）').toBe(null);
    const relLinks = await page.evaluate(() => Array.from(document.querySelectorAll('#md-probe a[href^="/"]')).length);
    expect(relLinks, '相对链接已被降级（非白名单协议一律不当链接）').toBe(0);
  });

  test('1.7 图片：合法 http 保留，非法协议退回说明文字', async ({ page }) => {
    const ok = await render(page, '![沙发](https://example.com/a.png)');
    expect(ok.final.imgSrcs, '合法 https 图应渲染').toEqual(['https://example.com/a.png']);
    const bad = await render(page, '![坏图](javascript:alert(1))');
    expect(bad.final.imgSrcs, '非法协议图不该渲染成 <img>').toEqual([]);
    expect(bad.final.dangerous.badHrefs, '不该留下坏 href').toBe(0);
  });
});

// ============================================================================
// 2. 不允许有裸标记残留
// ============================================================================
test.describe('2 · 无裸标记残留', () => {
  test('2.1 整篇导购回复的可见文本里没有漏出的 Markdown 记号', async ({ page }) => {
    const r = await render(page, GUIDE_REPLY);
    const t = r.final.text;
    expect(t, '不该漏出标题 #').not.toMatch(/(^|\s)#{1,6}\s/);
    expect(t, '不该漏出粗体 **').not.toContain('**');
    expect(t, '不该漏出删除线 ~~').not.toContain('~~');
    expect(t, '不该漏出表格分隔行 | ---').not.toContain('| ---');
    expect(t, '不该漏出代码块栅栏 ```').not.toContain('```');
    expect(t, '不该漏出链接语法 ](').not.toContain('](');
  });

  test('2.2 只写了一半的表格分隔行，不该把 `| ---` 漏给用户', async ({ page }) => {
    const r = await render(page, '| 商品 | 价格 |\n|---');
    expect(r.final.text, '半截表格也不该漏出竖线记号').not.toContain('| ---');
    expect(r.final.text, '表头文字应正常显示').toContain('商品');
  });

  test('2.3 内联样式指令 [[…]] 不残留', async ({ page }) => {
    const r = await render(page, '[[color:blue|彩色]]');
    expect(r.final.text).not.toContain('[[');
    expect(r.final.text).not.toContain(']]');
    expect(r.final.text).toContain('彩色');
  });
});

// ============================================================================
// 3. 有序列表序号（已知取舍，显式钉住现状）
// ============================================================================
test.describe('3 · 有序列表', () => {
  test('3.1 ⚠️ 已知缺口：1. 2. 3. 的序号不保留（渲染成 <ul>）', async ({ page }) => {
    const r = await render(page, '1. 先量客厅尺寸\n2. 再挑款式\n3. 最后看颜色');
    // 现状：全部渲染成无序列表，序号在解析阶段就被丢掉
    expect(r.final.classes, '当前实现渲染成 .md-ul').toContain('md-ul');
    expect(r.final.classes, '当前实现没有 .md-ol').not.toContain('md-ol');
    const olCount = await page.evaluate(() => document.querySelectorAll('#md-probe ol').length);
    expect(olCount, '当前不产出 <ol>（上游 parser 的已知限制）').toBe(0);
    // 三条文字都在，只是没有序号
    expect(r.final.text).toContain('先量客厅尺寸');
    expect(r.final.text).toContain('再挑款式');
    expect(r.final.text).toContain('最后看颜色');
    // 「序号丢失」这件事本身：可见文本里找不到 1/2/3
    expect(/1[\s.]*先量/.test(r.final.text), '序号确实没保留（见报告的质量缺口）').toBe(false);
  });

  test('3.2 无序列表渲染成 .md-ul + .md-li，每条一项', async ({ page }) => {
    const r = await render(page, '- 甲\n- 乙\n* 丙');
    expect(r.final.classes).toContain('md-ul');
    expect(r.final.html.match(/md-li/g)?.length, '三条无序项').toBe(3);
    expect(r.final.text).toBe('甲乙丙');
  });
});

// ============================================================================
// 4. XSS 防护（最高优先级）
// ============================================================================
test.describe('4 · XSS 防护', () => {
  const EVIL = [
    ['script 标签', '<script>alert(1)</script>'],
    ['img onerror', '<img src="x" onerror="alert(1)">'],
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['div onclick', '<div onclick="alert(1)">点我</div>'],
    ['svg onload', '<svg onload="alert(1)"></svg>'],
    ['body onload', '<body onload="alert(1)">'],
    ['input onfocus', '<input onfocus="alert(1)" autofocus>'],
    ['details ontoggle', '<details open ontoggle="alert(1)">'],
    ['style expression', '<div style="background:url(javascript:alert(1))">x</div>'],
    ['form action', '<form action="javascript:alert(1)"><button>go</button></form>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
    ['base href', '<base href="javascript:alert(1)">'],
    ['a javascript', '[点我](javascript:alert(1))'],
    ['a vbscript', '[点我](vbscript:alert(1))'],
    ['a data html', '[点我](data:text/html,<script>alert(1)</script>)'],
    ['a file', '[点我](file:///etc/passwd)'],
    ['img javascript', '![x](javascript:alert(1))'],
    ['img data html', '![x](data:text/html,<script>alert(1)</script>)'],
    ['混合段落', '正常文字 <script>alert(1)</script> 更多正常文字'],
  ];

  for (const [name, md] of EVIL) {
    test(`4.x ${name} —— 不进 DOM 且不抛异常`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const r = await render(page, md);
      const d = r.final.dangerous;
      expect(d.scripts, 'script 标签不该进 DOM').toBe(0);
      expect(d.iframes, 'iframe 不该进 DOM').toBe(0);
      expect(d.objects, 'object/embed 不该进 DOM').toBe(0);
      expect(d.onAttrs, '任何 on* 事件属性都不该进 DOM').toBe(0);
      expect(d.rawInHtml, 'innerHTML 里出现未转义的危险标签（真注入）').toEqual([]);
      expect(d.jsHrefs, '任何 a 都不该带 javascript/vbscript/data/file 协议').toBe(0);
      expect(d.onAttrElements, '任何元素都不该带 on* 属性').toBe(0);
      expect(d.badHrefs, '不该留下非白名单协议的 href').toBe(0);
      expect(r.threw, '渲染不该抛异常').toBe(null);
      expect(errors, '不该有 pageerror').toEqual([]);
    });
  }

  test('4.y 恶意输入不白屏：正常内容照常渲染', async ({ page }) => {
    const md = ['<script>alert(1)</script>', '', '## 还能用的标题', '', '- 正常列表项'].join('\n');
    const r = await render(page, md);
    expect(r.final.classes, '标题仍应渲染').toContain('md-h2');
    expect(r.final.classes, '列表仍应渲染').toContain('md-ul');
    expect(r.final.text).toContain('正常列表项');
  });
});

// ============================================================================
// 5. 两色调铁律
// ============================================================================
test.describe('5 · 两色调铁律', () => {
  test('5.1 导购回复的 computed color 全部落在两色调 + 灰阶内', async ({ page }) => {
    const r = await render(page, GUIDE_REPLY);
    for (const c of r.final.colors) {
      const forbidden = FORBIDDEN_COLORS[c];
      expect(forbidden, `不许出现 ${forbidden || c}`).toBeUndefined();
      expect(ALLOWED_COLORS.has(c), `颜色 ${c} 不在两色调 token 里（越界）`).toBe(true);
    }
  });

  test('5.2 不注入上游 injectMarkdownStyle() 的 <style>，也不含上游品牌色', async ({ page }) => {
    const r = await render(page, GUIDE_REPLY);
    const injected = await page.evaluate(() => Boolean(document.querySelector('style[data-ynet-markdown="true"]')));
    expect(injected, '不许调用上游 injectMarkdownStyle()（会注入蓝/红）').toBe(false);
    expect(r.final.html, 'HTML 里不该出现上游蓝').not.toContain('#2F7CF6');
    expect(r.final.html, 'HTML 里不该出现上游蓝小写').not.toContain('#2f7cf6');
    expect(r.final.html, 'HTML 里不该出现上游错误红').not.toContain('#B42318');
    expect(r.final.html, 'HTML 里不该出现上游错误红小写').not.toContain('#b42318');
    expect(r.final.colors, 'computed color 不该有上游蓝').not.toContain('rgb(47, 124, 246)');
    expect(r.final.colors, 'computed color 不该有上游错误红').not.toContain('rgb(180, 35, 24)');
  });

  test('5.3 不泄漏上游 ynet-md-* 类名', async ({ page }) => {
    const r = await render(page, GUIDE_REPLY);
    const leaked = r.final.classes.filter((c) => c.includes('ynet-md'));
    expect(leaked, '上游类名应在渲染层改写成 md-*').toEqual([]);
    expect(r.final.html).not.toContain('ynet-md-');
  });
});

// ============================================================================
// 6. 流式渲染
// ============================================================================
test.describe('6 · 流式渲染', () => {
  test('6.1 半截表格不崩，finish 后收敛成结构化表格', async ({ page }) => {
    const md = ['| 商品 | 价格 |', '| --- | --- |', '| 沙发 | ¥2899 |'].join('\n');
    const r = await render(page, md, { stream: ['| 商品 | 价格 |\n', '| --- | --- |\n', '| 沙'] });
    expect(r.midThrew, '半截输入不该抛异常').toBe(null);
    expect(r.final.classes, 'finish 后应收敛出表格').toContain('md-table');
    expect(r.final.text).toContain('沙发');
    expect(r.final.text).toContain('¥2899');
  });

  test('6.2 逐字流式一段导购回复，中途不抛异常且最终完整', async ({ page }) => {
    const r = await render(page, GUIDE_REPLY, { stream: [GUIDE_REPLY] });
    expect(r.midThrew).toBe(null);
    expect(r.final.classes).toContain('md-table');
    expect(r.final.classes).toContain('md-strong');
    expect(r.final.text).toContain('植物印花弧形布艺沙发');
  });

  test('6.3 snapshot() 给出结构化节点清单（供上层判断是否稳定）', async ({ page }) => {
    const md = '## 标题\n\n段落一\n\n- 列表项';
    const r = await render(page, md, { stream: ['## 标题\n\n段落一\n\n- 列表项'] });
    expect(Array.isArray(r.snapshot)).toBe(true);
    expect(r.snapshot.length).toBeGreaterThan(0);
    for (const n of r.snapshot) {
      expect(n, '每个节点应有 id').toHaveProperty('id');
      expect(n).toHaveProperty('type');
    }
  });

  test('6.4 恶意内容走流式同样安全', async ({ page }) => {
    const md = '<script>alert(1)</script>\n\n![x](javascript:alert(1))';
    const r = await render(page, md, { stream: ['<script>alert(1)</script>\n\n![x](javascript:alert(1))'] });
    expect(r.midThrew, '流式恶意输入不该抛异常').toBe(null);
    expect(r.final.dangerous.scripts).toBe(0);
    expect(r.final.dangerous.onAttrs).toBe(0);
    expect(r.final.dangerous.badHrefs).toBe(0);
  });
});

// ============================================================================
// 7. 边界
// ============================================================================
test.describe('7 · 边界', () => {
  test('7.1 空串 / null / undefined 不抛异常', async ({ page }) => {
    await page.goto(`${BASE_URL}/axing#view-home`, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const m = await import('/axing/js/markdown.js');
      const out = {};
      for (const [k, v] of [['empty', ''], ['null', null], ['undef', undefined], ['spaces', '   \n\n  ']]) {
        try { m.renderMarkdown(v); out[k] = 'ok'; } catch (e) { out[k] = String(e); }
      }
      return out;
    });
    for (const [k, v] of Object.entries(r)) expect(v, `${k} 不该抛`).toBe('ok');
  });

  test('7.2 超长内容（100KB）不炸且能渲染出内容', async ({ page }) => {
    const md = ('一二三四五六七八九十'.repeat(2000)) + '\n\n## 结尾标题\n\n- 结尾项';
    const r = await render(page, md);
    expect(r.threw, '超长内容不该抛异常').toBe(null);
    expect(r.final.text.length, '应有实际内容').toBeGreaterThan(5000);
    expect(r.final.classes).toContain('md-h2');
  });

  test('7.3 单个巨大表格（60 行）不崩', async ({ page }) => {
    const rows = Array.from({ length: 60 }, (_, i) => `| 商品${i} | ¥${1000 + i} |`);
    const md = ['| 名称 | 价格 |', '| --- | --- |', ...rows].join('\n');
    const r = await render(page, md);
    expect(r.threw).toBe(null);
    expect(r.final.html.match(/md-tr/g)?.length, '61 行（1 表头 + 60 数据）').toBe(61);
  });

  test('7.4 createMarkdownStream 不传宿主应抛错（静默烂尾比报错更糟）', async ({ page }) => {
    await page.goto(`${BASE_URL}/axing#view-home`, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const m = await import('/axing/js/markdown.js');
      try { m.createMarkdownStream(null); return 'no-throw'; } catch { return 'threw'; }
    });
    expect(r).toBe('threw');
  });

  test('7.5 reset() 后宿主真被清空，再 push 能重新开始', async ({ page }) => {
    await page.goto(`${BASE_URL}/axing#view-home`, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(async () => {
      const m = await import('/axing/js/markdown.js');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const s = m.createMarkdownStream(host);
      s.push('## 第一段');
      s.reset();
      const afterReset = (host.textContent || '').trim();
      s.push('## 第二段');
      s.finish('## 第二段');
      return { afterReset, afterPush: (host.textContent || '').trim(), hasH2: !!host.querySelector('.md-h2') };
    });
    expect(r.afterReset, 'reset 后应为空').toBe('');
    expect(r.afterPush).toContain('第二段');
    expect(r.hasH2, '重推后仍能渲染结构').toBe(true);
  });
});
