// 阿杏 App 壳：view 路由（按需 import view-*.js）+ 跨 view 状态 + Tab/返回 + 全局 ctx。
// 每个 view 模块约定：export function mount(root, ctx) { ...; return optional cleanup }
import * as apiModule from './api.js';
import * as ui from './ui.js';
import { initComposer } from './chat-composer.js';
import { initChat } from './chat-core.js';

const { $, $$, el, toast, humanError, on, emit } = ui;

const STATE_KEY = 'axing-state-v1';
const defaultState = {
  productId: null,
  productName: null,
  productPrice: null,
  productImage: null,
  roomUrl: null,       // 已上传客厅照（/api/upload/room 返回的 url）
  roomName: null,
  phone: '',           // 顾客手机号（试摆/预约/方案归属）
  lastTryonUrl: null,
  pendingRoomFile: null,  // Composer 相册键挑好、还没进浮窗的文件名
};
function loadState() {
  try { return { ...defaultState, ...(JSON.parse(localStorage.getItem(STATE_KEY)) || {}) }; }
  catch { return { ...defaultState }; }
}
const state = loadState();
function setState(patch) {
  Object.assign(state, patch);
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* 隐私模式 */ }
  emit('state:changed', state);
  return state;
}

// ---------- view 注册表 ----------
const VIEWS = {
  'view-home':     { module: () => import('./view-home.js'),     tab: true },
  'view-products': { module: () => import('./view-products.js'), tab: true },
  'view-3d':       { module: () => import('./view-3d.js'),       tab: true },
  'view-plans':    { module: () => import('./view-plans.js'),    tab: true },
  'view-me':       { module: () => import('./view-me.js'),       tab: true },
  'view-voice':    { module: () => import('./view-voice.js') },
  // 上传不再当独立全屏页用：主入口走底部浮窗（ctx.openUpload）。
  // 这里保留路由，供 hash 直入、其它 view 的 ctx.go('view-upload') 与既有测试兜底。
  'view-upload':   { module: () => import('./view-upload.js') },
  'view-tryon':    { module: () => import('./view-tryon.js') },
  'view-material': { module: () => import('./view-material.js') },
  'view-booking':  { module: () => import('./view-booking.js') },
};

const mounted = new Map();   // viewId -> cleanup fn
const history = [];
let current = null;

const ctx = {
  api: apiModule.api, ui, state, setState, on, emit,
  go, back, toast,
  humanError,
  get current() { return current; },   // chat-core 靠它判断「现在是不是在对话流里」
  pickProduct(product) {
    setState({
      productId: product.id,
      productName: product.name,
      productPrice: product.price,
      productImage: product.image || null,
    });
    emit('product:selected', product);
  },
  // 兼容旧调用：转成正儿八经的聊天气泡，而不是只 emit 一个没人消费的事件。
  // 首页 chips 现在直接调 ctx.chat.send()，不会再走这条半截链路（P3）。
  appendChat(role, text) {
    if (role === 'user') ctx.chat.appendUser(text);
    else ctx.chat.appendAi(text);
  },
};

// 常驻对话中枢（交互规范 §1-6）：时间线归它持有，不随 view 卸载销毁。
// 必须先于 initComposer——Composer 的发送键直接调 ctx.chat.send()。
ctx.chat = initChat(ctx);

// v2.1 spec §70/§71「聊天窗口始终在页面上」：Composer 在几乎所有 view 都在场，
// 只有 view-voice 让位——语音本身就是另一种聊天输入模态，全屏收音更不容易误触。
const COMPOSER_HIDDEN_VIEWS = new Set(['view-voice']);

function setActive(viewId) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === viewId));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === viewId));
  const section = document.getElementById(viewId);
  $('#topTitle').textContent = (section && section.dataset.title) || '阿杏';
  $('#backBtn').hidden = history.length === 0;
  const phone = $('#phone');
  if (phone) phone.dataset.composer = COMPOSER_HIDDEN_VIEWS.has(viewId) ? 'off' : 'on';
  const views = $('#views');
  if (views) views.scrollTop = 0;
}

async function show(viewId, { push = true } = {}) {
  if (!VIEWS[viewId]) return;
  if (current === viewId) return;
  if (current && push) history.push(current);
  current = viewId;
  setActive(viewId);
  if (mounted.has(viewId)) return;
  const section = document.getElementById(viewId);
  try {
    const mod = await VIEWS[viewId].module();
    const cleanup = await mod.mount(section, ctx);
    if (typeof cleanup === 'function') mounted.set(viewId, cleanup);
  } catch (err) {
    console.error(`[axing] mount ${viewId} failed`, err);
    section.appendChild(el('div.empty', { text: '这个页面加载失败了，返回重试一下' }));
  }
}

function go(viewId) {
  if (viewId === current) return;
  return show(viewId);
}

function back() {
  const prev = history.pop();
  return prev ? show(prev, { push: false }) : go('view-home');
}

// ---------- 绑定壳事件 ----------
$('#tabbar').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) go(tab.dataset.view);
});
$('#backBtn').addEventListener('click', back);

// ---------- 底部浮窗：上传客厅照 ----------
// sheet-upload.js 由 cards/sheet agent 交付。先同步挂一个降级实现（整页跳转），
// 模块到了再热替换成浮窗——否则并行开发期间点击会撞上 undefined。
ctx.openUpload = () => go('view-upload');
ctx.closeUpload = () => {};

(async function bindUploadSheet() {
  try {
    const mod = await import('./sheet-upload.js');
    ctx.openUpload = () => mod.openUploadSheet(ctx);
    ctx.closeUpload = () => mod.closeUploadSheet(ctx);
  } catch { /* 保持降级实现 */ }
})();

// 供浏览器地址栏 #view-3d 直入（调试/分享用）
function fromHash() {
  const id = location.hash.replace('#', '');
  return VIEWS[id] ? id : 'view-home';
}

show(fromHash());

window.AXING = ctx;
initComposer(ctx);
