// markdown.js — 阿杏的 Markdown 渲染入口（唯一对外出口）
//
// 引擎是 vendor 进来的 ynet H5 核心（js/vendor/markdown，逐字节同上游，见 VENDOR.md），
// 本文件只做「阿杏化」：块级渲染层、.md-* 类名、两色调收敛、链接协议白名单、
// __粗体__ / ~~删除线~~ 补齐、流式节点 diff。
//
// 硬约束（docs/阿杏交互规范.md §4）：
//   - 禁止调用上游 injectMarkdownStyle()（它注入 #2F7CF6 蓝 / #B42318 红，违反两色调铁律）
//   - 只走 createElement / createTextNode / textContent，禁止 innerHTML 赋原始 Markdown
//   - 链接 href 仅允许 http: / https: / tel:，其余降级为纯文本
//   - 样式全部在 css/markdown.css，且只准用 :root token，本文件不写死任何色值

import { parseInlineTo } from './vendor/markdown/inline.js';
import {
  parseMarkdown,
  parseNodeBatch,
  splitTableRow,
  MarkdownStreamEngine,
} from './vendor/markdown/parser.js';

export { parseMarkdown, parseNodeBatch, splitTableRow, MarkdownStreamEngine };

const SAFE_HREF = /^(https?:|tel:)/i;

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function clampLevel(level) {
  const n = Number.parseInt(level, 10);
  return Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : 1;
}

// ---------------------------------------------------------------- 行内：归一化

/** 剥掉上游的内联样式指令 [[color:…]] / [[pill:…]] / [[style:…|文字]] → 只留「文字」。
 *  这些指令会写死原色（纯蓝 #0000FF、纯红…），违反两色调铁律；后端 instructions 也明确不让用。 */
function stripInlineDirectives(text) {
  return text
    .replace(/\[\[(?:color|pill|style):[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[[^\]]*\]\]/g, '');
}

/** 上游只认 **粗体**，这里把 __粗体__ 归一化成同一种 */
function normalizeInline(text) {
  return stripInlineDirectives(String(text ?? '')).replace(/__([^_]+)__/g, '**$1**');
}

// ---------------------------------------------------------------- 行内：后处理

/** 上游类名 → 阿杏类名（契约 §4-5）。上游叫法和我们的命名不一致，逐个映射，
 *  剩下没列到的按 ynet-md-x → md-x 的通用规则走。 */
const CLASS_ALIAS = {
  'ynet-md-inline-code': 'md-codeinline',
  'ynet-md-link': 'md-a',
  'ynet-md-pill': 'md-pill',
  'ynet-md-root': 'md-root',
};

/** 把上游产出的 ynet-md-* 类改写成 md-*；顺手给 <strong>/<em> 补上 .md-strong/.md-em */
function renameClasses(root) {
  root.querySelectorAll('*').forEach((node) => {
    const raw = typeof node.className === 'string' ? node.className : '';
    if (raw.includes('ynet-md-')) {
      node.className = raw.split(/\s+/).filter(Boolean)
        .map((c) => CLASS_ALIAS[c] || (c.startsWith('ynet-md-') ? `md-${c.slice('ynet-md-'.length)}` : c))
        .join(' ');
    }
    if (node.tagName === 'STRONG') node.classList.add('md-strong');
    if (node.tagName === 'EM') node.classList.add('md-em');
  });
}

/** 链接协议白名单：javascript: / data: / vbscript: 一律降级成纯文本节点 */
function sanitizeLinks(root) {
  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href || !SAFE_HREF.test(href.trim())) {
      const text = a.textContent || '';
      a.replaceWith(document.createTextNode(text));
      return;
    }
    // 站外链接不新开标签（老人友好：别把唯一的页面顶掉）
    a.setAttribute('rel', 'noreferrer');
    if (/^https?:/i.test(href.trim())) a.setAttribute('target', '_blank');
  });
}

/** 上游不解析 ~~删除线~~，这里在文本节点上补。跳过 <code>/<pre>——那里的 ~~ 是字面量。 */
function applyDeletions(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const parent = textNode.parentElement;
    if (!parent || parent.closest('code, pre')) continue;
    if (textNode.nodeValue.includes('~~')) targets.push(textNode);
  }
  targets.forEach((textNode) => {
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    const re = /~~([^~]+)~~/g;
    let last = 0;
    let m = null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const del = el('del', 'md-del');
      del.textContent = m[1];
      frag.appendChild(del);
      last = m.index + m[0].length;
    }
    if (last === 0) return;                       // 没有成对 ~~，原样留着
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  });
}

/** 文本 → 行内片段（span 包一层，方便外层统一管理类名与间距） */
export function renderInline(text) {
  const span = el('span', 'md-inline');
  parseInlineTo(span, normalizeInline(text), { type: 'inline', text: String(text ?? '') });
  renameClasses(span);
  sanitizeLinks(span);
  applyDeletions(span);
  return span;
}

// ---------------------------------------------------------------- 块级渲染

function renderTable(node) {
  const rows = Array.isArray(node.rows) ? node.rows : [];
  const wrap = el('div', 'md-table-wrap');
  if (!rows.length) {
    wrap.appendChild(el('p', 'md-p'));
    return wrap;
  }
  const table = el('table', 'md-table');
  const head = el('thead', 'md-thead');
  const headRow = el('tr', 'md-tr');
  rows[0].forEach((cell) => {
    const th = el('th', 'md-th');
    th.appendChild(renderInline(cell));
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  const body = el('tbody', 'md-tbody');
  rows.slice(1).forEach((row) => {
    const tr = el('tr', 'md-tr');
    (Array.isArray(row) ? row : []).forEach((cell) => {
      const td = el('td', 'md-td');
      td.appendChild(renderInline(cell));
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  table.appendChild(head);
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function renderImage(node) {
  const m = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(String(node.text || ''));
  const img = el('img', 'md-img');
  const url = m ? m[2] : '';
  if (!SAFE_HREF.test(url)) {
    // 非法协议的图不当图渲染，退回它自己的说明文字
    const p = el('p', 'md-p');
    p.textContent = m ? m[1] || url : String(node.text || '');
    return p;
  }
  img.src = url;
  img.alt = m ? m[1] : '';
  img.loading = 'lazy';
  img.addEventListener('error', () => { img.hidden = true; });
  return img;
}

function renderNode(node) {
  switch (node.type) {
    case 'heading': {
      const level = clampLevel(node.level);
      const h = el(`h${level}`, `md-h${level}`);
      h.appendChild(renderInline(node.text));
      return h;
    }
    case 'paragraph': {
      const p = el('p', 'md-p');
      p.appendChild(renderInline(node.text));
      return p;
    }
    case 'list_item': {
      const li = el('li', 'md-li');
      li.appendChild(renderInline(node.text));
      return li;
    }
    case 'blockquote': {
      const q = el('blockquote', 'md-quote');
      q.appendChild(renderInline(node.text));
      return q;
    }
    case 'code_block': {
      const pre = el('pre', 'md-pre');
      const code = el('code', 'md-code');
      if (node.language) code.dataset.lang = node.language;
      code.textContent = String(node.text ?? '');     // 代码块不做任何行内解析
      pre.appendChild(code);
      return pre;
    }
    case 'divider': return el('hr', 'md-hr');
    case 'table': return renderTable(node);
    case 'image': return renderImage(node);
    default: {
      // custom / styled_block / 未来新增节点：退回段落，至少把 text 显示出来
      const p = el('p', 'md-p');
      p.textContent = String(node.text ?? '').trim();
      return p.textContent ? p : el('div', 'md-unknown');
    }
  }
}

/** 节点数组 → 块元素数组。连续的 list_item 合成一个 <ul>，否则浏览器不给列表语义。
 *  注意：上游 parser 把 `- a` 和 `1. a` 都输出成 list_item，且 stripListPrefix 丢掉了序号
 *  （上游 Markdown语法支持清单原文：「有序列表只保留文本，不保留序号」）。所以这里无法
 *  区分有序/无序，统一成 <ul>——不自己发明序号，避免和上游语义打架。
 *  块的 key 带首尾节点 id：列表长出一条时 key 变化 → 整个 <ul> 重建（只重建含未稳定节点的那组）。 */
function buildBlocks(nodes) {
  const blocks = [];
  let group = null;
  const flush = () => {
    if (!group) return;
    group.el.dataset.mdKey = `ul:${group.firstId}..${group.lastId}`;
    blocks.push({ key: `ul:${group.firstId}..${group.lastId}`, el: group.el });
    group = null;
  };
  nodes.forEach((node) => {
    if (node.type === 'list_item') {
      if (!group) group = { firstId: node.id, lastId: node.id, el: el('ul', 'md-ul') };
      group.lastId = node.id;
      group.el.appendChild(renderNode(node));
      return;
    }
    flush();
    const key = `${node.type}:${node.id}:${node.version}`;
    blocks.push({ key, el: renderNode(node) });
  });
  flush();
  return blocks;
}

/** 增量 diff：key 不变的块原地不动，只重建 key 变了的那个——流式时表格/列表不抖。 */
function reconcile(host, blocks) {
  const existing = Array.from(host.children);
  blocks.forEach((block, i) => {
    const cur = existing[i];
    if (cur && cur.dataset.mdKey === block.key) return;
    block.el.dataset.mdKey = block.key;
    if (cur) host.replaceChild(block.el, cur);
    else host.appendChild(block.el);
  });
  while (host.children.length > blocks.length) host.removeChild(host.lastChild);
}

// ---------------------------------------------------------------- 对外 API

/** Markdown → DocumentFragment（一次性全量渲染） */
export function renderMarkdown(src) {
  const frag = document.createDocumentFragment();
  const nodes = parseMarkdown(String(src ?? ''), false).nodes || [];
  buildBlocks(nodes).forEach((b) => frag.appendChild(b.el));
  return frag;
}

/** 流式渲染器：delta 逐段喂进来，只重画未稳定节点。 */
export function createMarkdownStream(host) {
  if (!host) throw new Error('createMarkdownStream 需要一个宿主元素');
  const engine = new MarkdownStreamEngine();
  let parsed = [];

  const paint = () => {
    const blocks = buildBlocks(parsed);
    reconcile(host, blocks);
  };

  return {
    host,
    /** append() 返回的是 JSON 字符串（内部 JSON.stringify(parseMarkdown(buffer, true))），
     *  过 parseNodeBatch 才拿到节点数组；streaming=true 才会产出 stable:false 的未闭合节点。 */
    push(delta) {
      parsed = parseNodeBatch(engine.append(String(delta ?? '')));
      paint();
      return parsed;
    },
    reset() {
      engine.reset();
      parsed = [];
      host.textContent = '';
    },
    /** done：用完整文本做一次全量标准化渲染，兜住流式可能留下的半截结构 */
    finish(fullText) {
      const text = String(fullText ?? '');
      if (!text.trim()) {
        this.reset();
        return;
      }
      parsed = parseMarkdown(text, false).nodes || [];
      host.textContent = '';
      paint();
    },
    snapshot() {
      return parsed.map((n) => ({ id: n.id, type: n.type, stable: n.stable }));
    },
  };
}
