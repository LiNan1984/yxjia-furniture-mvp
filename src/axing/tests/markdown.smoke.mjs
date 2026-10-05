// markdown.smoke.mjs — A 号（Markdown 引擎）冒烟测试
// 自带独立端口 3431 的服务器实例（不碰 3000 / 3400），用 Playwright 开真浏览器，
// 在页面里 import('/axing/js/markdown.js') 后跑断言。node 直接跑，退出码非 0 即失败。
//
// 覆盖（对应阿杏交互规范 §4 + 落地契约 §1.1 硬约束）：
//   块级：标题层级 / 表格 / 引用 / 代码块 / 无序+有序列表 / 分割线 / 图片兜底
//   行内：粗体 / __粗体__ / 斜体 / 行内代码 / 删除线 / 链接
//   流式：半截表格不崩、增量 diff 不重复建块、finish 兜住
//   安全：<script> / javascript: 链接 / 非法协议图片 全被中和
//   两色调：渲染结果无 ynet-md 类、无 #2F7CF6 / #B42318、未注入 ynet 的 <style>
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { chromium } from 'playwright';

const PORT = 3431;
const BASE = `http://127.0.0.1:${PORT}`;

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${p}`, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

async function waitReady(timeoutMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('测试服务器启动超时');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// 在页面里跑的断言。返回 { passed, failed: string[] }。
// 整个函数体会被 Playwright 序列化后 eval，不能用闭包变量。
function runInPage() {
  const results = { passed: 0, failed: [] };
  const ok = (name, cond, extra) => {
    if (cond) results.passed += 1;
    else results.failed.push(extra ? `${name} → ${extra}` : name);
  };

  return import('/axing/js/markdown.js').then((md) => {
    const host = document.createElement('div');
    host.id = 'smoke-host';
    document.body.appendChild(host);

    const htmlOf = (frag) => {
      const box = document.createElement('div');
      box.appendChild(frag);
      return box.innerHTML;
    };

    // ---------- 一次性渲染 ----------
    const sample = [
      '# 一级标题',
      '',
      '## 推荐这几款',
      '',
      '正文一段，带**粗体**、__下线粗体__、*斜体*、`行内代码`、~~删除线~~ 和 [门店链接](https://example.com)。',
      '',
      '- 无序一',
      '- 无序二',
      '',
      '1. 有序一',
      '2. 有序二',
      '',
      '> 到店试坐，不合适不买。',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '| 商品 | 价格 |',
      '| --- | --- |',
      '| 三人位布艺沙发 | ¥2999起 |',
      '',
      '---',
      '',
      '结束段。',
    ].join('\n');

    const frag = md.renderMarkdown(sample);
    const html = htmlOf(frag);
    ok('标题渲染', html.includes('class="md-h1"') && html.includes('class="md-h2"'), '缺 md-h1/md-h2');
    ok('标题文本', html.includes('一级标题') && html.includes('推荐这几款'));
    ok('段落', html.includes('class="md-p"'));
    ok('粗体', html.includes('<strong') && html.includes('class="md-strong"'));
    ok('__粗体__ 归一化', (html.match(/<strong/g) || []).length >= 2, `strong 数=${(html.match(/<strong/g) || []).length}`);
    ok('斜体', html.includes('<em') && html.includes('class="md-em"'));
    ok('行内代码', html.includes('class="md-codeinline"'));
    ok('删除线', html.includes('<del') && html.includes('class="md-del"'));
    ok('链接', html.includes('class="md-a"') && html.includes('https://example.com'));
    ok('无序列表成组', html.includes('class="md-ul"') && (html.match(/md-li/g) || []).length >= 4,
      `md-li 数=${(html.match(/md-li/g) || []).length}`);
    // 上游把有序列表也输出成 list_item 且丢掉序号，渲染层统一 <ul>（见 markdown.js 注释）
    ok('有序项也进 <ul>', (html.match(/<ul/g) || []).length === 1, `ul 数=${(html.match(/<ul/g) || []).length}`);
    ok('引用块', html.includes('class="md-quote"') && html.includes('到店试坐'));

    // 代码块：单独渲染一份，确认代码里的 ** 不被当成粗体、~~ 不被当成删除线
    const codeOnly = htmlOf(md.renderMarkdown('```js\nconst a = **notBold** ~~notDel~~;\n```'));
    ok('代码块不做行内解析', codeOnly.includes('md-pre') && !codeOnly.includes('<strong') && !codeOnly.includes('<del'),
      codeOnly);
    ok('表格', html.includes('class="md-table"') && html.includes('md-th') && html.includes('md-td'));
    ok('表格内容', html.includes('三人位布艺沙发') && html.includes('¥2999起'));
    ok('分割线', html.includes('class="md-hr"'));
    ok('结尾段落', html.includes('结束段'));

    // ---------- 两色调铁律 ----------
    ok('无 ynet-md 类', !html.includes('ynet-md'), '渲染结果里还有 ynet-md-* 类');
    ok('无上游蓝 #2F7CF6', !html.includes('#2F7CF6'));
    ok('无上游红 #B42318', !html.includes('#B42318'));
    ok('未注入上游 <style>', !document.querySelector('style[data-ynet-markdown]'), 'injectMarkdownStyle 被调用了');

    // ---------- 安全 ----------
    const evil = md.renderMarkdown([
      '<script>alert(1)</script>',
      '',
      '[点我](javascript:alert(1))',
      '',
      '![图](javascript:alert(1))',
      '',
      '![图](data:text/html;base64,PHNjcmlwdD4=)',
      '',
      '| a | b |',
      '| --- | --- |',
      '| <img src=x onerror=alert(1)> | 安全 |',
    ].join('\n'));
    const evilHtml = htmlOf(evil);
    ok('script 标签被文本化', !/<script/i.test(evilHtml), '出现真 <script>');
    ok('javascript: 链接降级', !evilHtml.includes('href="javascript:'), '仍有 javascript: href');
    ok('data: 图片不渲染', !evilHtml.includes('src="data:'), '仍有 data: src');
    ok('表格内 HTML 被文本化', evilHtml.includes('&lt;img') || !evilHtml.includes('<img src=x'), '表格单元格里的 HTML 没被文本化');

    // ---------- 流式 ----------
    const streamHost = document.createElement('div');
    document.body.appendChild(streamHost);
    const stream = md.createMarkdownStream(streamHost);

    stream.push('## 正在生成');
    ok('流式首块', streamHost.querySelector('.md-h2') !== null);
    const h2El = streamHost.querySelector('.md-h2');
    stream.push('\n\n第一段。');
    ok('流式增量追加', streamHost.querySelector('.md-p') !== null);
    ok('已稳定块不重建', streamHost.querySelector('.md-h2') === h2El, '标题块被重建了');

    // 半截表格：只有表头行、没有 | --- | 分隔行，此时还不是 table
    stream.reset();
    stream.push('| 商品 | 价格 |');
    ok('半截表格不崩', streamHost.children.length > 0, '半截表格没渲染出任何块');
    ok('半截表格不当 table', streamHost.querySelector('.md-table') === null, '半截表格被误判成表格');
    const halfPara = streamHost.querySelector('.md-p, .md-unknown');
    ok('半截表格退回段落', halfPara !== null && halfPara.textContent.includes('商品'));

    // 分隔行到达 → 变表格
    stream.push('\n| --- | --- |\n| 三人位 | ¥2999起 |');
    ok('分隔行到达后成表格', streamHost.querySelector('.md-table') !== null, '补齐分隔行后仍不是表格');
    ok('表格含数据行', (streamHost.querySelectorAll('.md-td') || []).length >= 2);

    // 完整表格一步到位
    stream.reset();
    stream.push(['| 商品 | 价格 |', '| --- | --- |', '| 床 | ¥4500起 |'].join('\n'));
    ok('完整表格流式', streamHost.querySelectorAll('.md-td').length === 2);

    // diff 不重复建块：新段落要用空行隔开，否则上游会把连续两行合并成同一个段落（这是正确行为）
    stream.reset();
    stream.push('## A\n\n段落一\n\n段落二\n');
    const countAfterFirst = streamHost.children.length;
    const headEl = streamHost.querySelector('.md-h2');
    stream.push('\n\n段落三');
    ok('新块追加', streamHost.children.length === countAfterFirst + 1,
      `children ${countAfterFirst} → ${streamHost.children.length}`);
    ok('已稳定块不重建', streamHost.querySelector('.md-h2') === headEl, '标题块被重建了');
    ok('合并同一段落的两行不新增块', (() => {
      const n = streamHost.children.length;
      stream.push('续一行');
      return streamHost.children.length === n;
    })(), '同一段落的续行被当成了新块');

    // finish 兜底：把流式里可能留下的半截结构一次性标准化
    stream.reset();
    stream.push('| 商品 | 价格 |');
    stream.finish('## 最终\n\n| 商品 | 价格 |\n| --- | --- |\n| 床 | ¥4500起 |\n');
    ok('finish 清掉半截结构', streamHost.querySelector('.md-h2') !== null && streamHost.querySelector('.md-table') !== null);
    ok('finish 后无残留', !streamHost.textContent.includes('商品 | 价格 |\n') || streamHost.querySelector('.md-table') !== null);
    stream.reset();
    ok('reset 清空宿主', streamHost.children.length === 0);

    // ---------- 边界 ----------
    ok('空串不炸', md.renderMarkdown('').childNodes.length === 0);
    ok('null 不炸', md.renderMarkdown(null).childNodes.length === 0);
    const onlySpace = md.createMarkdownStream(document.createElement('div'));
    onlySpace.push('   ');
    ok('纯空白流式不炸', true);

    // ---------- parseNodeBatch / parseMarkdown 也能从适配层拿到 ----------
    const batch = md.parseMarkdown('## x', false);
    ok('parseMarkdown 可用', Array.isArray(batch.nodes) && batch.nodes[0].type === 'heading');
    const viaBatch = md.parseNodeBatch(JSON.stringify(batch));
    ok('parseNodeBatch 可用', Array.isArray(viaBatch) && viaBatch.length === 1);

    return results;
  }).catch((err) => {
    results.failed.push(`import/运行抛错: ${err && err.message}`);
    return results;
  });
}

let server = null;
let browser = null;
try {
  server = spawn('node', [path.join('src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), MINIO_ENDPOINT: '127.0.0.1' },
    stdio: 'ignore',
  });
  await waitReady();

  browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  await page.goto(`${BASE}/axing`, { waitUntil: 'domcontentloaded' });

  const r = await page.evaluate(runInPage);

  console.log(`markdown smoke: ${r.passed} passed, ${r.failed.length} failed`);
  if (pageErrors.length) {
    console.log('pageerror:');
    pageErrors.forEach((e) => console.log('  - ' + e));
  }
  if (r.failed.length) {
    console.log('failed:');
    r.failed.forEach((f) => console.log('  - ' + f));
  }
  process.exitCode = r.failed.length || pageErrors.length ? 1 : 0;
} catch (err) {
  console.error('smoke 跑挂了:', err && err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill('SIGTERM');
}
