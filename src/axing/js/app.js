// 阿杏 App 壳：view 路由（按需 import view-*.js）+ 跨 view 状态 + Tab/返回 + 全局 ctx。
// 每个 view 模块约定：export function mount(root, ctx) { ...; return optional cleanup }
import * as apiModule from './api.js';
import * as ui from './ui.js';
import { initComposer } from './chat-composer.js';

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
  appendChat(role, text) { emit('chat:message', { role, text }); },
  pickProduct(product) {
    setState({
      productId: product.id,
      productName: product.name,
      productPrice: product.price,
      productImage: product.image || null,
    });
    emit('product:selected', product);
  },
};

function setActive(viewId) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === viewId));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === viewId));
  const section = document.getElementById(viewId);
  $('#topTitle').textContent = (section && section.dataset.title) || '阿杏';
  $('#backBtn').hidden = history.length === 0;
  // v2.1 spec §70：Composer 只在 tab 级 view 出现，非 tab 的工作流页面让位给表单
  const phone = $('#phone');
  if (phone) phone.dataset.composer = VIEWS[viewId] && VIEWS[viewId].tab ? 'on' : 'off';
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

// 供浏览器地址栏 #view-3d 直入（调试/分享用）
function fromHash() {
  const id = location.hash.replace('#', '');
  return VIEWS[id] ? id : 'view-home';
}

show(fromHash());

// 阿杏全局问候（首页 view 也会用自己的问候，这里只做兜底提示）
window.AXING = ctx;
initComposer(ctx);
