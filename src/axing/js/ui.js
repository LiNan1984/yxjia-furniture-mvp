// 阿杏前端共享 UI 工具：view 模块（view-*.js）都从这里取工具，保证视觉与交互一致。
import { renderMarkdown } from './markdown.js';

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

// 阿杏头像：用同一 IP 的裁切版本（v2.1 spec §38.2）。JPEG 而非 PNG——同画质省 87% 体积，
// 首屏要同时出 hero + 头像，spec §47 的首屏预算不能浪费在 alpha 通道上。
const AVATAR_IMG = '/axing/images/axing-avatar.jpg';

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
  const img = el('img', { src: '/axing/images/axing-hero.jpg', alt: '阿杏', loading: 'eager' });
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

/** 骨架块 */
export function skeleton(style = '') {
  const s = el('div.skeleton');
  if (style) s.setAttribute('style', style);
  return s;
}

/** 商品卡片（结构与 css 的 .p-card 对应）。
 *  ops.speaker 默认 true——§2-4 要求阿杏代言的卡片左边都有头像；
 *  传 false 可退回无头像的裸卡片（例如后台式的密集列表）。 */
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
  // 头像在卡片外侧左侧：不占卡片内 padding，也不挤压 1:1 主图
  if (ops.speaker === false) return card;
  return el('div.ax-card-ava.ax-card-ava--pcard', {}, [avatar('sm'), card]);
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

/** Markdown → 安全 DOM 节点。实现从 markdown.js 来（ynet 引擎适配层，见 docs/阿杏交互规范 §4）。
 *  这里只做薄封装：view 模块继续用 mdToNodes(md) 的老签名，不必知道底层换过引擎。
 *  阿杏气泡里的 Markdown 由后端 GUIDE_INSTRUCTIONS 产出（标题 / 列表 / 引用 / 表格 / 粗体），
 *  旧的「只认 **粗体** 和 - 列表」实现会把表格和标题原样漏出来，所以必须走完整解析器。 */
export function mdToNodes(md) {
  return renderMarkdown(md);
}

/** 阿杏说一句话（头像 + 气泡横排，气泡内容走 Markdown 渲染） */
export function axingSay(text, opts = {}) {
  const row = el('div.ax-row', {}, [
    avatar(opts.small ? 'sm' : ''),
    el('div.ax-bubble.grow'),
  ]);
  row.lastChild.appendChild(mdToNodes(text));
  return row;
}

/** 阿杏卡片（§2-4）：所有由阿杏产出/代言的卡片，左边都有阿杏头像。
 *  opts = { title, desc?, icon?, tone?: 'apricot'|'stone', body?: Node[], trailing?: Node, onClick? }
 *  头像在卡片**外侧左侧**，不占卡片内 padding；尺寸与聊天气线头像对齐（30px）。
 *  trailing 放在标题行最右（例：› 箭头）。 */
export function axingCard(opts = {}) {
  const body = el('div.card__body');
  if (opts.title || opts.trailing) {
    const head = el('div.ax-card-ava__head');
    if (opts.icon) {
      head.appendChild(el(`div.ax-card-ava__ico.ax-card-ava__ico--${opts.tone || 'apricot'}`, {}, [icon(opts.icon)]));
    }
    const txt = el('div.grow', {}, [el('div.ax-card-ava__title', { text: opts.title || '' })]);
    if (opts.desc) txt.appendChild(el('div.ax-card-ava__desc', { text: opts.desc }));
    head.appendChild(txt);
    if (opts.trailing) head.appendChild(opts.trailing);
    body.appendChild(head);
  }
  (Array.isArray(opts.body) ? opts.body : [opts.body]).flat().forEach((n) => {
    if (n != null && n !== false) body.appendChild(typeof n === 'string' ? el('p', { text: n }) : n);
  });
  const card = el('div.card', {}, [body]);
  const wrap = el('div.ax-card-ava', {}, [avatar('sm'), card]);
  if (opts.onClick) {
    card.classList.add('ax-card-ava__card--tap');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.style.cursor = 'pointer';
    card.addEventListener('click', opts.onClick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        opts.onClick(e);
      }
    });
  }
  return wrap;
}
