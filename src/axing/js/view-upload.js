// view-upload.js — 阿杏 · 拍照上传客厅照
// 约定：mount(root, ctx) 首次切到该 view 时调用一次，可返回 cleanup。
//
// 关键约定：选中的房间文件统一挂到 ctx.roomFile（本地拍照 / 相册 / 示例房间三条路径都挂），
// 同时 ctx.setState({ roomUrl, roomName }) 供上游展示与「直接去试摆」使用。

import { el } from './ui.js';

/** app.js 目前把 api.js 的命名空间（{ ApiError, api }）注入 ctx.api，
 *  这里兼容「包装器」和「命名空间」两种形状，壳改回去也不用动 view。 */
function resolveApi(ctx) {
  const a = (ctx && ctx.api) || {};
  const wrapped = a.api;
  if (wrapped && typeof wrapped === 'object' && typeof wrapped.products === 'function') return wrapped;
  return typeof a.products === 'function' ? a : wrapped || a;
}

const MAX_EDGE = 1600;          // 长边压到 1600（合成足够，上传快）
const MAX_BYTES = 15 * 1024 * 1024;

function fileInput(capture, onPick) {
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  if (capture) input.setAttribute('capture', 'environment');
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) onPick(file);
  });
  return input;
}

/** 读图：优先 createImageBitmap，退回 <img>（老 Safari） */
function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file).catch(() => loadImg(file));
  }
  return loadImg(file);
}

function loadImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图读不出来，换一张试试')); };
    img.src = url;
  });
}

/** 压缩到长边 ≤1600 的 JPEG；任何一步失败就原样返回（后端仍接受 ≤15MB） */
async function compress(file) {
  try {
    const src = await loadBitmap(file);
    const sw = src.width || src.naturalWidth || 0;
    const sh = src.height || src.naturalHeight || 0;
    if (!sw || !sh) return file;
    const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return file;
    ctx2d.drawImage(src, 0, 0, w, h);
    if (typeof src.close === 'function') src.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], 'room.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** 远程图 → File（示例房间图、试摆页回填房间都用它） */
async function fileFromUrl(url, name = 'room.jpg') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('这张图片没读到，换一张试试');
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

export async function mount(root, ctx) {
  const { axingSay } = ctx.ui;
  const api = resolveApi(ctx);

  // ---------- 页面骨架 ----------
  root.appendChild(el('p.sec-eyebrow', { text: 'STEP 02 · 拍一张客厅' }));
  root.appendChild(el('h2.sec-title', { text: '把家具搬进你家' }));
  root.appendChild(el('p.sec-desc', {
    text: '拍一张完整的客厅，尽量把地面和墙面都拍进去，这样摆进去更准。',
  }));

  // 房间预览
  const stageImg = el('img', {
    alt: '我的客厅',
    style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;',
  });
  const stageHint = el('div.stage__hint', {}, [
    el('div', { text: '还没有客厅照' }),
    el('div.tiny', { text: '拍一张，或用下面的示例房间试试' }),
  ]);
  const stage = el('div.stage', {}, [stageImg, stageHint]);
  root.appendChild(stage);

  const roomNameLine = el('p.tiny.muted', { text: '' });
  root.appendChild(roomNameLine);

  // 两个上传入口（label 包 input，点按钮就是开相机/相册）
  const camInput = fileInput(true, (f) => handleFile(f));
  const albumInput = fileInput(false, (f) => handleFile(f));
  const camBtn = el('label.btn.btn--apricot.btn--lg.btn--block', {}, [
    '📷 拍一张客厅照', camInput,
  ]);
  const albumBtn = el('label.btn.btn--lg.btn--block', {}, [
    '🖼 从相册选择', albumInput,
  ]);
  root.appendChild(el('div.stack--sm', { style: 'margin-top:16px;' }, [camBtn, albumBtn]));

  // 已传过：重新拍照 / 直接去试摆
  const roomRow = el('div.row', { hidden: true }, [
    el('button.btn.btn--ghost.grow', { text: '↻ 重新拍照', onclick: () => camInput.click() }),
    el('button.btn.btn--apricot.grow', { text: '直接去试摆 →', onclick: () => ctx.go('view-tryon') }),
  ]);
  root.appendChild(roomRow);

  // 示例房间
  const catRow = el('div.chip-scroll');
  const catWrap = el('div', { style: 'margin-top:20px;' }, [
    el('p.tiny.muted', { text: '没有照片？用示例房间试试', style: 'margin:0 0 8px;' }),
    catRow,
  ]);
  root.appendChild(catWrap);

  const busyLine = el('div.loading-line', { text: '', style: 'margin-top:14px;' });
  root.appendChild(busyLine);

  const sayBox = el('div', { style: 'margin-top:16px;' });
  root.appendChild(sayBox);

  // ---------- 状态 ----------
  /** @type {any[]} */
  let cats = [];
  let pickedCat = null;
  let busy = false;

  function setBusy(on, text) {
    busy = on;
    busyLine.textContent = on ? (text || '') : '';
    [camBtn, albumBtn].forEach((b) => {
      b.style.pointerEvents = on ? 'none' : '';
      b.style.opacity = on ? '.5' : '';
    });
  }

  function renderRoom() {
    const url = ctx.state.roomUrl;
    if (url) {
      stageImg.src = url;
      stageImg.hidden = false;
      stageHint.hidden = true;
      roomNameLine.textContent = `当前房间：${ctx.state.roomName || '我家客厅'}`;
      roomRow.hidden = false;
    } else {
      stageImg.hidden = true;
      stageImg.removeAttribute('src');
      stageHint.hidden = false;
      roomNameLine.textContent = '';
      roomRow.hidden = true;
    }
  }

  function paintCats() {
    catRow.replaceChildren(...cats.map((c) => {
      const active = pickedCat === c.id;
      const b = el('button.chip.row', { style: 'min-height:44px;align-items:center;gap:6px;' }, [
        el('img', {
          src: c.defaultRoom, alt: '', loading: 'lazy',
          // 示例房间图缺失时把缩略图藏掉，别留一个碎图占位
          onerror: (e) => { if (e && e.currentTarget) e.currentTarget.hidden = true; },
          style: 'width:22px;height:22px;border-radius:6px;object-fit:cover;flex:0 0 auto;',
        }),
        el('span', { text: c.name || c.id }),
      ]);
      b.className = `chip row${active ? ' active' : ''}`;
      b.addEventListener('click', () => pickCategory(c));
      return b;
    }));
  }

  // ---------- 三条取图路径 ----------
  async function pickCategory(c) {
    if (busy) return;
    pickedCat = c.id;
    paintCats();
    setBusy(true, '正在准备示例房间…');
    try {
      const file = await fileFromUrl(c.defaultRoom);
      ctx.roomFile = file;
      ctx.setState({ roomUrl: c.defaultRoom, roomName: `示例房间 · ${c.name || c.id}` });
      renderRoom();
      sayBox.replaceChildren(axingSay(`先用${c.name || '示例'}的房间试试，选好家具我帮你摆进去。`, { small: true }));
      ctx.toast('已选示例房间');
    } catch (err) {
      pickedCat = null;
      paintCats();
      ctx.toast(ctx.humanError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file) {
    if (busy) return;
    if (!/^image\//.test(file.type || '')) {
      ctx.toast('请选一张图片（客厅照片）');
      return;
    }
    if (file.size > MAX_BYTES) {
      ctx.toast('照片超过 15MB 了，换一张小一点的');
      return;
    }
    setBusy(true, '正在上传照片…');
    let uploaded = file;
    try {
      uploaded = await compress(file);
      const data = await api.uploadRoom(uploaded, {
        phone: ctx.state.phone,
        productId: ctx.state.productId,
      });
      ctx.roomFile = uploaded;
      ctx.setState({ roomUrl: data.url, roomName: '我家客厅' });
      renderRoom();
      const who = ctx.state.productName
        ? `我先把「${ctx.state.productName}」给你摆进去看看。`
        : '接着选件家具，我帮你摆进去看看。';
      sayBox.replaceChildren(axingSay(`拍得真清楚！${who}`));
      setBusy(true, '好了，去试摆…');
      setTimeout(() => ctx.go('view-tryon'), 700);
    } catch (err) {
      ctx.toast(ctx.humanError(err));
      setBusy(false);
    }
  }

  // ---------- 初始化 ----------
  try {
    const data = await api.categories();
    cats = ((data && data.categories) || []).filter((c) => c.enabled !== false && c.defaultRoom);
  } catch (err) {
    cats = [];
    ctx.toast(ctx.humanError(err));
  }
  if (cats.length) paintCats();
  else catWrap.hidden = true;
  renderRoom();

  const offState = ctx.on('state:changed', renderRoom);
  return () => offState();
}
