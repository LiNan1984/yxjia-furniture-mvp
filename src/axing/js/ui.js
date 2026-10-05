// 阿杏前端共享 UI 工具：view 模块（view-*.js）都从这里取工具，保证视觉与交互一致。

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 创建元素：el('div.card', { onclick }, [children|string]) */
export function el(tag, attrs = {}, children = []) {
  const [name, ...rest] = tag.split('.');
  const node = document.createElement(name || 'div');
  rest.forEach((cls) => node.classList.add(cls));
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') node.className += ` ${v}`;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  });
  const kids = Array.isArray(children) ? children : [children];
  kids.flat().forEach((c) => {
    if (c == null || c === false) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

export function toast(msg, ms = 2400) {
  let t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}

/** 价格字符串 → 数字（无法解析回 null）：
 *  "¥5xxx 起" → 5000；"¥2899起" → 2899；"到店询价" → null */
export function parsePrice(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\s*(xxx)?/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  return m[2] ? n * 1000 : n;
}

export function priceText(raw) {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '到店询价';
}

// 阿杏头像：用同一 IP 的裁切版本（v2.1 spec §38.2）。图片加载失败回退成文字圆，绝不出现破图。
const AVATAR_IMG = '/axing/images/axing-avatar.png';

/** 阿杏头像 */
export function avatar(size = '') {
  const node = el(`div.ax-avatar${size ? `.ax-avatar--${size}` : ''}`);
  const img = el('img', { src: AVATAR_IMG, alt: '阿杏', loading: 'eager' });
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:top center;';
  img.addEventListener('error', () => { node.textContent = '杏'; });
  node.appendChild(img);
  return node;
}

/** 阿杏半身像（首页 hero，v2.1 spec §38.1：开心、挥手、面向用户） */
export function axingHero() {
  const wrap = el('div.ax-hero__girl');
  const img = el('img', { src: '/axing/images/axing-hero.png', alt: '阿杏', loading: 'eager' });
  img.addEventListener('error', () => { wrap.textContent = '杏'; });
  wrap.appendChild(img);
  return wrap;
}

/** 图标：icon('camera') → <svg class="ico"><use href="#i-camera"/></svg>，颜色跟随 currentColor */
export function icon(name, cls = 'ico') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/** 阿杏说一句话（头像 + 气泡横排） */
export function axingSay(text, opts = {}) {
  return el('div.ax-row', {}, [
    avatar(opts.small ? 'sm' : ''),
    el('div.ax-bubble.grow', { text }),
  ]);
}

/** 骨架块 */
export function skeleton(style = '') {
  const s = el('div.skeleton');
  if (style) s.setAttribute('style', style);
  return s;
}

/** 商品卡片（结构与 css 的 .p-card 对应） */
export function productCard(p, ops = {}) {
  const card = el('div.p-card');
  const imgWrap = el('div.p-card__img');
  if (p.image) {
    const img = el('img', { src: p.image, alt: p.name || '', loading: 'lazy' });
    imgWrap.appendChild(img);
  } else {
    imgWrap.appendChild(skeleton('position:absolute;inset:0;'));
  }
  if (p.badge) imgWrap.appendChild(el('span.p-card__badge', { text: p.badge }));
  if (p.stock && p.stock !== '现货' && p.stock !== '有货') {
    imgWrap.appendChild(el('span.p-card__badge', { text: p.stock }));
  }
  const body = el('div.p-card__body');
  body.appendChild(el('p.p-card__name', { text: p.name || '未命名商品' }));
  const attr = [p.subtitle, p.size].filter(Boolean).join(' · ');
  if (attr) body.appendChild(el('p.p-card__attr', { text: attr }));
  body.appendChild(el('p.p-card__price', { text: priceText(p.price) }));
  const opsRow = el('div.p-card__ops');
  if (ops.onDetail) {
    opsRow.appendChild(el('button.btn.btn--ghost', { text: '详情', onclick: () => ops.onDetail(p) }));
  }
  if (ops.onPick) {
    opsRow.appendChild(el('button.btn', { text: ops.pickLabel || '选它', onclick: () => ops.onPick(p) }));
  }
  body.appendChild(opsRow);
  card.appendChild(imgWrap);
  card.appendChild(body);
  return card;
}

/** 事件总线（view 之间解耦） */
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, payload) {
  (listeners.get(evt) || []).forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(`[axing] listener ${evt} failed`, e); }
  });
}

/** 错误提示统一走这里：把后端/网络错误翻成人话 */
export function humanError(err) {
  if (err && err.status === 429) return err.message || '今天体验次数已用完，欢迎到店看实物';
  if (err && err.status === 503) return err.message || '服务暂时不可用，请稍后再试';
  return (err && err.message) || '出了点小问题，请再试一次';
}

/** 把常见 Markdown（加粗 / 列表 / 标题）安全地转成文本节点混排，防 XSS */
export function mdToNodes(md) {
  const frag = document.createDocumentFragment();
  if (!md) return frag;
  const lines = String(md).split('\n');
  let list = null;
  const flushList = () => { if (list) { frag.appendChild(list); list = null; } };
  const inline = (text) => {
    const span = el('span');
    text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) span.appendChild(el('strong', { text: part.slice(2, -2) }));
      else if (part) span.appendChild(document.createTextNode(part));
    });
    return span;
  };
  lines.forEach((line) => {
    const t = line.trim().replace(/^#{1,6}\s*/, ''); // 剥 Markdown 标题符，纯展示
    if (/^[-*·]\s+/.test(t)) {
      if (!list) list = el('div', { style: 'padding-left:14px;' });
      list.appendChild(el('div', { text: `· ${t.replace(/^[-*·]\s+/, '')}` }));
      return;
    }
    flushList();
    if (!t) return;
    frag.appendChild(el('div', {}, [inline(t)]));
  });
  flushList();
  return frag;
}
