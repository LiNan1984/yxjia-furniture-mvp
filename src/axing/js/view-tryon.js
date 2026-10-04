// view-tryon.js — 阿杏 · AI 试摆（核心页）
// 约定：mount(root, ctx) 首次切到该 view 时调用一次，可返回 cleanup。
//
// 上游：房间图（ctx.roomFile / ctx.state.roomUrl）+ 选中商品（ctx.state.productId）
// 下游：api.tryonAnon（匿名，每 IP 每天 3 次）→ 结果图 / aiError / remaining

import { el } from './ui.js';

/** app.js 目前把 api.js 的命名空间（{ ApiError, api }）注入 ctx.api，
 *  这里兼容「包装器」和「命名空间」两种形状，壳改回去也不用动 view。 */
function resolveApi(ctx) {
  const a = (ctx && ctx.api) || {};
  const wrapped = a.api;
  if (wrapped && typeof wrapped === 'object' && typeof wrapped.products === 'function') return wrapped;
  return typeof a.products === 'function' ? a : wrapped || a;
}

/** 试摆预设：/api/tryon/presets 回的是 {presets:[...]}（没包 success/data），
 *  ctx.api.presets() 会解包成 undefined，所以这里直连接口兜底。 */
async function loadPresets(ctx) {
  try {
    const data = await resolveApi(ctx).presets();
    if (data && Array.isArray(data.presets) && data.presets.length) return data.presets;
  } catch { /* 走直连 */ }
  try {
    const res = await fetch('/api/tryon/presets');
    if (res.ok) {
      const body = await res.json();
      if (body && Array.isArray(body.presets) && body.presets.length) return body.presets;
    }
  } catch { /* 忽略，后面用空态 */ }
  return [];
}

/** 远程房间图 → File（没有 ctx.roomFile 时用，比如刷新后从 state.roomUrl 回填） */
async function fileFromUrl(url, name = 'room.jpg') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('房间图没读到，重新拍一张吧');
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

export async function mount(root, ctx) {
  const { axingSay, priceText } = ctx.ui;
  const api = resolveApi(ctx);

  // ---------- 本地状态 ----------
  /** @type {any[]} */
  let products = [];
  /** @type {{id:string,name:string,prompt:string}[]} */
  let presets = [];
  let presetId = '';
  let resultSrc = null;        // 当前结果图 src（可能是 base64）
  let timer = null;
  let running = false;

  // ---------- 页面骨架 ----------
  root.appendChild(el('p.sec-eyebrow', { text: 'STEP 03 · 摆进你家看看' }));
  root.appendChild(el('h2.sec-title', { text: 'AI 试摆' }));
  root.appendChild(el('p.sec-desc', {
    text: '选好家具和氛围，点「立即生成」。约 20-40 秒出图，不满意就换个氛围再来。',
  }));

  // 上游状态卡：房间图 + 当前商品
  const stageImg = el('img', {
    alt: '试摆结果',
    style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;',
  });
  const roomImg = el('img', {
    alt: '原始客厅',
    style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;',
    hidden: true,
  });
  const stageHint = el('div.stage__hint', {}, [el('div', { text: '这里会显示摆好的样子' })]);
  const compareBtn = el('button.btn.btn--ghost', {
    text: '对比',
    style: 'position:absolute;top:10px;right:10px;z-index:3;min-height:44px;padding:9px 16px;touch-action:none;opacity:.9;',
    hidden: true,
  });
  const stage = el('div.stage', {}, [stageImg, roomImg, stageHint, compareBtn]);
  root.appendChild(stage);

  const upRow = el('div.row', { style: 'margin-top:10px;flex-wrap:wrap;' });
  root.appendChild(upRow);

  // 家具 chips
  const prodRow = el('div.chip-scroll', { style: 'margin-top:4px;' });
  root.appendChild(el('p.tiny.muted', { text: '换一件家具试试', style: 'margin:18px 0 8px;' }));
  root.appendChild(prodRow);

  // 氛围 chips + 自定义 prompt
  const presetRow = el('div.chip-row');
  root.appendChild(el('p.tiny.muted', { text: '想要什么氛围', style: 'margin:18px 0 8px;' }));
  root.appendChild(presetRow);

  const promptInput = el('input', {
    type: 'text', maxlength: '120', placeholder: '比如：沙发靠窗放，暖光（选填）', autocomplete: 'off',
  });
  promptInput.setAttribute('aria-label', '自定义要求');
  root.appendChild(el('label.field', { style: 'margin-top:14px;' }, [
    el('span', { text: '还有别的要求' }), promptInput,
  ]));

  // 生成按钮 + 秒表
  const genBtn = el('button.btn.btn--apricot.btn--lg.btn--block', {
    text: '✨ 立即生成',
    style: 'margin-top:6px;',
  });
  genBtn.addEventListener('click', generate);
  root.appendChild(genBtn);
  const timerLine = el('div.loading-line', { text: '', style: 'margin-top:10px;' });
  root.appendChild(timerLine);

  // 阿杏提示区（loading / 成功 / 失败 / 限额都在这说话）
  const sayBox = el('div', { style: 'margin-top:16px;' });
  root.appendChild(sayBox);
  const metaLine = el('p.tiny.muted', { text: '' });
  root.appendChild(metaLine);

  // 结果下方操作
  const actionRow = el('div.stack--sm', { style: 'margin-top:16px;', hidden: true }, [
    el('button.btn.btn--lg.btn--block', {
      text: '🔁 换个氛围再试',
      onclick: () => {
        presetRow.querySelectorAll('button').forEach((b) => { b.className = 'chip'; });
        presetId = '';
        promptInput.value = '';
        clearResult();
        presetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    }),
    el('div.row', {}, [
      el('button.btn.btn--ghost.grow', { text: '◍ 3D 看看', onclick: () => ctx.go('view-3d') }),
      el('button.btn.btn--ghost.grow', { text: '✧ 存进方案', onclick: () => ctx.go('view-plans') }),
      el('button.btn.btn--ghost.grow', { text: '📅 预约到店', onclick: () => ctx.go('view-booking') }),
    ]),
  ]);
  root.appendChild(actionRow);

  // ---------- 渲染 ----------
  function renderUpstream() {
    const s = ctx.state;
    upRow.replaceChildren();
    upRow.appendChild(el('span.tiny.muted', { text: '房间：' }));
    if (s.roomUrl) {
      upRow.appendChild(el('span.tiny', { text: s.roomName || '我家客厅' }));
      upRow.appendChild(el('button.btn.btn--ghost', {
        text: '换一张', style: 'min-height:40px;padding:8px 14px;', onclick: () => ctx.go('view-upload'),
      }));
    } else {
      upRow.appendChild(el('span', { text: '还没有客厅照' }));
      upRow.appendChild(el('button.btn.btn--ghost', {
        text: '去拍照', style: 'min-height:40px;padding:8px 14px;', onclick: () => ctx.go('view-upload'),
      }));
    }
    if (s.productId) {
      upRow.appendChild(el('span.tiny.muted', { text: `家具：${s.productName || '已选'}` }));
      upRow.appendChild(el('button.btn.btn--ghost', {
        text: '换一件', style: 'min-height:40px;padding:8px 14px;', onclick: () => ctx.go('view-products'),
      }));
    } else {
      upRow.appendChild(el('span.tiny.muted', { text: '家具：还没选' }));
      upRow.appendChild(el('button.btn.btn--ghost', {
        text: '去挑选', style: 'min-height:40px;padding:8px 14px;', onclick: () => ctx.go('view-products'),
      }));
    }
    if (s.roomUrl && !roomImg.getAttribute('src')) roomImg.src = s.roomUrl;
  }

  function renderProducts() {
    const onSale = products.filter((p) => (p.status || '在售') !== '下架');
    prodRow.replaceChildren(...onSale.map((p) => {
      const active = p.id === ctx.state.productId;
      const b = el('button.chip', { text: `${p.name} · ${priceText(p.price)}` });
      b.style.minHeight = '40px';
      b.className = `chip${active ? ' active' : ''}`;
      b.addEventListener('click', () => {
        ctx.pickProduct(p);
        ctx.toast(`已选：${p.name}`);
        renderProducts();
        renderUpstream();
      });
      return b;
    }));
  }

  function renderPresets() {
    presetRow.replaceChildren(...presets.map((p) => {
      const b = el('button.chip', { text: p.name || p.id });
      b.style.minHeight = '40px';
      b.dataset.preset = p.id;
      b.className = `chip${presetId === p.id ? ' active' : ''}`;
      b.addEventListener('click', () => {
        presetId = presetId === p.id ? '' : p.id;
        renderPresets();
      });
      return b;
    }));
    if (!presetRow.childElementCount) {
      presetRow.replaceChildren(el('span.tiny.muted', { text: '氛围预设没读到，可以直接在下面写要求。' }));
    }
  }

  function showResult(src) {
    resultSrc = src;
    stageImg.src = src;
    stageImg.hidden = false;
    stageHint.hidden = true;
    compareBtn.hidden = !ctx.state.roomUrl;
    if (ctx.state.roomUrl) {
      roomImg.src = ctx.state.roomUrl;
      roomImg.hidden = true;
    }
  }

  function clearResult() {
    resultSrc = null;
    stageImg.hidden = true;
    stageImg.removeAttribute('src');
    roomImg.hidden = true;
    stageHint.hidden = false;
    compareBtn.hidden = true;
    actionRow.hidden = true;
    metaLine.textContent = '';
  }

  // 按住「对比」看原房间，松开看结果
  const showRoom = (on) => {
    if (!resultSrc || !ctx.state.roomUrl) return;
    roomImg.hidden = !on;
    stageImg.hidden = on;
    compareBtn.classList.toggle('active', on);
  };
  compareBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); showRoom(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) =>
    compareBtn.addEventListener(t, () => showRoom(false)));

  function say(node) {
    sayBox.replaceChildren(node);
  }

  // ---------- 生成 ----------
  async function getRoomFile() {
    if (ctx.roomFile) return ctx.roomFile;
    const url = ctx.state.roomUrl;
    if (!url) return null;
    return fileFromUrl(url);
  }

  function setRunning(on) {
    running = on;
    genBtn.disabled = on;
    genBtn.textContent = on ? '正在生成…' : '✨ 立即生成';
  }

  async function generate() {
    if (running) return;
    const productId = ctx.state.productId;
    if (!productId) {
      ctx.toast('先选一件家具吧');
      ctx.go('view-products');
      return;
    }
    let room = null;
    try {
      room = await getRoomFile();
    } catch (err) {
      ctx.toast(ctx.humanError(err));
      return;
    }
    if (!room) {
      ctx.toast('先拍一张客厅照');
      ctx.go('view-upload');
      return;
    }

    const preset = presets.find((p) => p.id === presetId);
    const prompt = (promptInput.value || '').trim();
    setRunning(true);
    const t0 = Date.now();
    timerLine.textContent = '已用 0.0 秒';
    timer = setInterval(() => {
      timerLine.textContent = `已用 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`;
    }, 100);
    say(axingSay('正在把家具搬进你家…大约 20-40 秒，好了我叫你。'));

    try {
      const data = await api.tryonAnon({ room, productId, prompt, preset: presetId });
      if (timer) clearInterval(timer);
      timerLine.textContent = `本次用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`;
      const src = data.compositionBase64 || data.compositionUrl;
      if (src) showResult(src);
      actionRow.hidden = false;

      const bits = [];
      if (data.preset && data.preset.name) bits.push(`氛围：${data.preset.name}`);
      if (typeof data.remaining === 'number') bits.push(`今天还能免费试 ${data.remaining} 次`);
      metaLine.textContent = bits.join(' · ');

      if (data.aiError) {
        // 诚实提示：AI 没出图，展示的是侧边预览
        say(el('div', {}, [
          axingSay(`AI 这次没出图（${data.aiError}），先看看侧边预览；也可以到店看实物。`),
          el('div.stack--sm', { style: 'margin-top:12px;' }, [
            el('button.btn.btn--lg.btn--block', { text: '🔁 再试一次', onclick: generate }),
            el('button.btn.btn--ghost.btn--block', {
              text: '📞 打店里电话 13359140982',
              onclick: () => { window.location.href = 'tel:13359140982'; },
            }),
          ]),
        ]));
      } else {
        const name = (data.product && data.product.name) || ctx.state.productName || '家具';
        say(el('div', {}, [
          axingSay(`摆好了！这是「${name}」在你家的样子。按住右上角「对比」可以看原来的房间。`),
        ]));
      }

      ctx.setState({ lastTryonUrl: data.compositionUrl || ctx.state.lastTryonUrl });
      ctx.emit('tryon:done', {
        productId,
        product: data.product || null,
        compositionUrl: data.compositionUrl || null,
        preset: data.preset || null,
        remaining: data.remaining,
        demoType: data.demoType || null,
      });
      stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      if (timer) clearInterval(timer);
      timerLine.textContent = '';
      if (err && err.status === 429) {
        say(el('div', {}, [
          axingSay('今天的免费试摆次数用完啦（每天 3 次）。登录后还能继续试，或者直接到店看实物。'),
          el('div.stack--sm', { style: 'margin-top:12px;' }, [
            el('button.btn.btn--apricot.btn--lg.btn--block', {
              text: '📅 预约到店体验',
              onclick: () => ctx.go('view-booking'),
            }),
            el('button.btn.btn--ghost.btn--block', {
              text: '📞 打店里电话 13359140982',
              onclick: () => { window.location.href = 'tel:13359140982'; },
            }),
          ]),
        ]));
      } else {
        ctx.toast(ctx.humanError(err));
        say(el('div', {}, [
          axingSay(`这次没成功：${ctx.humanError(err)}。稍等一下再点「立即生成」试试。`),
        ]));
      }
    } finally {
      setRunning(false);
    }
  }

  // ---------- 初始化 ----------
  const offPick = ctx.on('product:selected', () => { renderProducts(); renderUpstream(); });
  const offState = ctx.on('state:changed', () => renderUpstream());

  try {
    const data = await api.products();
    products = (data && data.products) || [];
  } catch (err) {
    products = [];
    ctx.toast(ctx.humanError(err));
  }
  presets = await loadPresets(ctx);
  presetId = presets.length ? presets[0].id : '';
  renderProducts();
  renderPresets();
  renderUpstream();
  if (!ctx.state.productId) {
    say(el('div', {}, [
      axingSay('先挑一件家具，再拍张客厅照，我就能摆给你看。'),
      el('div.stack--sm', { style: 'margin-top:12px;' }, [
        el('button.btn.btn--apricot.btn--lg.btn--block', { text: '去挑家具', onclick: () => ctx.go('view-products') }),
        el('button.btn.btn--ghost.btn--block', { text: '去拍客厅照', onclick: () => ctx.go('view-upload') }),
      ]),
    ]));
  }

  return () => {
    if (timer) clearInterval(timer);
    offPick();
    offState();
  };
}
