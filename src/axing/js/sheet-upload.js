// sheet-upload.js — 阿杏 · 上传客厅照（底部浮窗，交互规范 §1-2 / §5-2）
// 约定：openUploadSheet / closeUploadSheet 管浮窗开合；mountUploadSheetBody 管内容，返回 cleanup。
//
// 为什么从全屏 view 改成底部浮窗：上传客厅照的入口有三个（首页上传卡 / Composer 相册键 /
// AI 回复里的「拍照试摆」），而内容又重（预览 + 相机 + 相册 + 示例房间 + 拍照提示）。
// 做成全屏 view 会让人「离开对话」——实测顾客在 #view-upload 里发消息看不到自己那条（P2）。
// 浮窗从底部推入 0.15s、最高 724px、超出滚动、蒙版/下拉取消（喜豆 spec §1-2）。
//
// 关键契约（与原 view-upload.js 完全一致）：
// 选中的房间文件统一挂 ctx.roomFile（拍照 / 相册 / 示例房间三条路径都挂），
// 同时 ctx.setState({ roomUrl, roomName }) 供上游展示与「直接去试摆」使用。

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

// ---------------------------------------------------------------- 浮窗开合

let bodyCleanup = null;         // mountUploadSheetBody 返回的 cleanup（内容只建一次）
let shellBound = false;         // 蒙版 / Esc / 下拉把手只绑一次

function sheetNodes() {
  return {
    root: document.getElementById('sheetRoot'),
    mask: document.getElementById('sheetMask'),
    panel: document.getElementById('sheetPanel'),
    phone: document.getElementById('phone'),
  };
}

/** 确保内容已挂进 #sheetPanel。懒挂：首次打开才建，之后复用同一份 DOM 与状态。 */
function ensureBody(ctx) {
  const { panel } = sheetNodes();
  if (!panel || bodyCleanup !== null) return;
  panel.replaceChildren();
  bodyCleanup = mountUploadSheetBody(panel, ctx);
}

/** 绑定浮窗壳事件（蒙版 / Esc / 下拉把手）。只绑一次，避免每次打开都叠监听。 */
function bindShell() {
  if (shellBound) return;
  shellBound = true;
  const { root, mask, panel } = sheetNodes();
  if (mask) mask.addEventListener('click', closeUploadSheet);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root && root.classList.contains('is-open')) {
      e.preventDefault();
      closeUploadSheet();
    }
  });

  // 下拉把手取消：pointerdown 记起点，**向下**拖超过 60px 即关。
  // ⚠️ 方向必须是「下拉」（clientY 变大）。交互规范 §1-2 写的是「点击蒙版或下拉可直接
  // 取消浮窗」，而这里原先判的是 startY - e.clientY > 60，也就是上滑——手势反了，
  // 按规范去下拉的顾客什么都不会发生。而且往上拖 60px 指针就飞出面板顶边，本来就做不成。
  // 必须 setPointerCapture：监听器挂在 panel 上，而手指一旦拖到浮窗顶边之外，
  // pointermove 的 target 就变成蒙版了——触屏有隐式捕获所以看着是好的，
  // 笔记本触控板/鼠标拖拽全程收不到事件，把手完全失效（实测 Y5）。
  // setPointerCapture 让同一个 pointerId 的后续事件固定送回把手，鼠标和触屏才一致。
  if (panel) {
    let startY = null;
    let activePointer = null;
    panel.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest && e.target.closest('.ax-sheet__grip');
      if (!grip) return;
      startY = e.clientY;
      activePointer = e.pointerId;
      if (typeof grip.setPointerCapture === 'function' && activePointer != null) {
        try { grip.setPointerCapture(activePointer); } catch { /* 捕获失败也不影响按下 */ }
      }
    });
    panel.addEventListener('pointermove', (e) => {
      if (startY == null || (activePointer != null && e.pointerId !== activePointer)) return;
      if (e.clientY - startY > 60) {
        startY = null;
        closeUploadSheet();
      }
    });
    const endDrag = (e) => {
      if (startY == null) return;
      if (activePointer != null && e.pointerId !== activePointer) return;
      startY = null;
      activePointer = null;
    };
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
    panel.addEventListener('lostpointercapture', endDrag);
  }
}

/** 打开上传浮窗。幂等：已开着就什么都不做。 */
export function openUploadSheet(ctx) {
  const { root, panel, phone } = sheetNodes();
  if (!root || !panel) return;
  bindShell();
  ensureBody(ctx);
  if (root.classList.contains('is-open')) return;
  // 先 hidden=false 再强制回流，transition 才会真的播（否则浏览器把两次改动合并成一次）
  root.hidden = false;
  void panel.offsetHeight;
  root.classList.add('is-open');
  if (phone) phone.dataset.sheet = 'on';
}

/** 关闭上传浮窗。取消不销毁已选房间：ctx.state.roomUrl 保留，下次打开直接显示。 */
export function closeUploadSheet() {
  const { root, phone } = sheetNodes();
  if (!root || !root.classList.contains('is-open')) return;
  root.classList.remove('is-open');
  if (phone) delete phone.dataset.sheet;
  // 等 0.15s 推退动画播完再真的隐藏，否则看不到收回去的过程
  setTimeout(() => {
    if (!root.classList.contains('is-open')) root.hidden = true;
  }, 150);
}

/** 浮窗当前是否开着（测试与其它 view 用） */
export function isUploadSheetOpen() {
  const root = document.getElementById('sheetRoot');
  return !!(root && root.classList.contains('is-open'));
}

// ---------------------------------------------------------------- 取图工具

function fileInput(capture, onPick) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
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

// ---------------------------------------------------------------- 浮窗内容

/**
 * 把上传内容渲染进 panel，返回 cleanup。
 * @param {HTMLElement} panel
 * @param ctx
 * @param {{chrome?: boolean}} [opts] chrome=false 时不画把手/标题（view-upload 适配器用）
 */
export function mountUploadSheetBody(panel, ctx, opts = {}) {
  const { el, icon, axingSay } = ctx.ui;
  const api = resolveApi(ctx);
  const offs = [];
  const on = (fn) => offs.push(fn);

  if (opts.chrome !== false) {
    panel.appendChild(el('div.ax-sheet__grip'));
    panel.appendChild(el('h2.sec-title', { text: '把家具搬进你家', style: 'font-size:21px;' }));
    panel.appendChild(el('p.sec-desc', {
      text: '拍一张完整的客厅，尽量把地面和墙面都拍进去，这样摆进去更准。',
      style: 'margin-bottom:6px;',
    }));
    // 「怎么关掉这个窗口」必须是看得见的。浮窗开着时底部 Tab 被 pointer-events:none
    // 挡着（chat.css #phone[data-sheet=on]），顾客的出口只剩顶部小横条、蒙版那一条、
    // 和 Esc——这三样对老人都是隐形的。写一句话，比让他猜强。
    panel.appendChild(el('p.tiny.muted', {
      text: '↑ 上滑顶部小横条，或点旁边变暗的地方，就能收起这个窗口',
      style: 'text-align:center;margin:0 0 14px;letter-spacing:.02em;line-height:1.6;',
    }));
  }

  // 房间预览：object-fit:contain，避免裁掉顾客的墙边
  const stageImg = el('img', {
    alt: '我的客厅',
    style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;',
  });
  const stageHint = el('div.stage__hint', {}, [
    el('div', { text: '还没有客厅照' }),
    el('div.tiny', { text: '拍一张，或用下面的示例房间试试' }),
  ]);
  const stage = el('div.stage', {}, [stageImg, stageHint]);
  panel.appendChild(stage);

  const roomNameLine = el('p.tiny.muted', { text: '', style: 'margin-top:8px;' });
  panel.appendChild(roomNameLine);

  // 两个上传入口（label 包 input，点按钮就是开相机/相册）
  const camInput = fileInput(true, (f) => handleFile(f));
  const albumInput = fileInput(false, (f) => handleFile(f));
  const camBtn = el('label.btn.btn--apricot.btn--lg.btn--block', {}, [icon('camera'), '拍一张客厅照', camInput]);
  const albumBtn = el('label.btn.btn--lg.btn--block', {}, [icon('image'), '从相册选择', albumInput]);
  panel.appendChild(el('div.stack--sm', { style: 'margin-top:16px;' }, [camBtn, albumBtn]));

  // 已传过：重新拍照 / 直接去试摆
  // ⚠️ 「直接去试摆」必须先收浮窗再跳。只 ctx.go() 的话浮窗还开着，蒙版会把整个
  // 试摆页盖住——顾客点了「立即生成」实际点在蒙版/label 上，整条试摆链路就断了。
  // 这是真实顾客旅程（示例房间 → 直接去试摆 → 立即生成）实测打断的地方。
  const roomRow = el('div.row', { hidden: true }, [
    el('button.btn.btn--ghost.grow', { text: '↻ 重新拍照', style: 'min-height:44px;', onclick: () => camInput.click() }),
    el('button.btn.btn--apricot.grow', { text: '直接去试摆 →', style: 'min-height:44px;', onclick: () => {
      closeUploadSheet();
      ctx.go('view-tryon');
    } }),
  ]);
  panel.appendChild(roomRow);

  // 示例房间
  const catRow = el('div.chip-scroll');
  const catWrap = el('div', { style: 'margin-top:18px;' }, [
    el('p.tiny.muted', { text: '没有照片？用示例房间试试', style: 'margin:0 0 8px;' }),
    catRow,
  ]);
  panel.appendChild(catWrap);

  const busyLine = el('div.loading-line', { text: '', style: 'margin-top:14px;' });
  panel.appendChild(busyLine);

  const sayBox = el('div', { style: 'margin-top:14px;' });
  panel.appendChild(sayBox);

  // ---------- 状态 ----------
  /** @type {any[]} */
  let cats = [];
  let pickedCat = null;
  let busy = false;

  function setBusy(onFlag, text) {
    busy = onFlag;
    busyLine.textContent = onFlag ? (text || '') : '';
    [camBtn, albumBtn].forEach((b) => {
      b.style.pointerEvents = onFlag ? 'none' : '';
      b.style.opacity = onFlag ? '.5' : '';
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
      // 上传成功就收浮窗去试摆——顾客要的是「看效果」，不是停在选图页
      setTimeout(() => {
        closeUploadSheet();
        ctx.go('view-tryon');
      }, 700);
    } catch (err) {
      ctx.toast(ctx.humanError(err));
      setBusy(false);
    }
  }

  // ---------- 初始化 ----------
  renderRoom();
  (async () => {
    try {
      const data = await api.categories();
      cats = ((data && data.categories) || []).filter((c) => c.enabled !== false && c.defaultRoom);
    } catch {
      cats = [];
    }
    if (cats.length) paintCats();
    else catWrap.hidden = true;

    // 上游提前挑好的照片：顾客已经在系统相册里选过了，直接上传，
    // 不能让他在浮窗里再挑一遍。上传入口统一走 ctx.openUpload() 后，
    // 这条路径目前没有生产者，但浮窗是「相册/拍照」的唯一落点，
    // 保留消费端比让照片静默丢失安全（db24052 之前正是丢过一次）。
    const pre = ctx.roomFile;
    if (pre && !ctx.state.roomUrl) {
      ctx.roomFile = null;
      handleFile(pre);
      return;
    }

    // 首页示例缩略图带过来的品类：直接替用户选中，少一次点击
    // （原 view-upload.js 存了 sampleCategoryId 却从没用它 auto-select，这里补上）
    const want = ctx.state && ctx.state.sampleCategoryId;
    const hit = want ? cats.find((c) => c.id === want) : null;
    if (hit && !ctx.state.roomUrl) pickCategory(hit);
  })();

  on(ctx.on('state:changed', renderRoom));

  return () => {
    offs.forEach((off) => { try { off(); } catch { /* 忽略单个解绑异常 */ } });
    offs.length = 0;
    bodyCleanup = null;
  };
}
