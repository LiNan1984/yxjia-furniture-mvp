// view-plans.js — 我的方案：保存当前选中家具为方案 + 按手机号查方案列表 + 接着看/预约到店。
// 约定：export async function mount(root, ctx)，可 return cleanup 函数。
import { COLOR_SWATCHES } from './furniture.js';

const MATERIAL_LABELS = {
  fabric: '布艺', tech: '科技布', leather: '真皮', wood: '实木', mdf: '密度板',
};

function todayLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 颜色值归一化。历史上「颜色」这一条被三条路径送过三种东西：
 *  view-3d 存方案送色板 id（'rust'）、scene:style 广播送 hex（'#A9683C'）、
 *  还有直接送中文名的。三种都认——取中文名当标签（顾客看得懂），取 hex 画圆点。
 *  认不出来时照原样显示文字、不画圆点，绝不显示成 hex 或英文 id。 */
function resolveColor(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  const byHex = COLOR_SWATCHES.find((c) => c.hex.toLowerCase() === v.toLowerCase());
  if (byHex) return { label: byHex.name, hex: byHex.hex };
  const byName = COLOR_SWATCHES.find((c) => c.name === v);
  if (byName) return { label: byName.name, hex: byName.hex };
  const byId = COLOR_SWATCHES.find((c) => c.id === v);
  if (byId) return { label: byId.name, hex: byId.hex };
  return { label: v, hex: null };
}

/** 颜色小圆点（color 是 #rrggbb 之类才画圆点，否则只显示文字） */
function colorDot(ctx, color) {
  const { el } = ctx.ui;
  const isHex = typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color.trim());
  if (!isHex) return null;
  return el('span', {
    style: `width:14px;height:14px;border-radius:50%;flex:0 0 auto;display:inline-block;` +
      `border:1px solid rgba(44,44,44,.18);background:${color.trim()};`,
  });
}

function tag(ctx, text, color) {
  const { el } = ctx.ui;
  const dot = colorDot(ctx, color);
  return el('span.chip', {
    style: 'font-size:11px;padding:5px 11px;display:inline-flex;align-items:center;gap:6px;' +
      'border-color:rgba(217,212,205,.9);color:var(--c-charcoal);cursor:default;',
  }, dot ? [dot, el('span', { text })] : [text]);
}

export async function mount(root, ctx) {
  const { el, axingSay } = ctx.ui;
  // app.js 注入的 ctx.api 是 api.js 的模块命名空间（{ ApiError, api }），
  // 真正的请求对象在 ctx.api.api 上；这里两种形状都兼容。
  const api = (ctx.api && ctx.api.api) || ctx.api || {};
  const cleanups = [];
  const stack = el('div.stack');
  root.appendChild(stack);

  // 3D view 会广播 scene:style { color, materialId }，保存方案时一起带上
  let style = {};
  const offStyle = ctx.on('scene:style', (payload) => {
    if (payload && typeof payload === 'object') style = { ...style, ...payload };
  });
  cleanups.push(offStyle);

  // ---------- 顶部说明 ----------
  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'MY PLANS' }),
    el('h2.sec-title', { text: '我的方案' }),
    el('p.sec-desc', { text: '把看中的家具收成一个方案，随时接着看，也能直接约到店体验。' }),
  ]));

  // ---------- 保存当前方案 ----------
  const nameInput = el('input', { id: 'ax-pl-name', type: 'text', maxlength: '40', value: `我的家 · ${todayLabel()}` });
  const phoneInput = el('input', { id: 'ax-pl-phone', type: 'tel', placeholder: '11 位手机号（填了才好找回）', maxlength: '11', inputmode: 'numeric', value: ctx.state.phone || '' });
  const saveBtn = el('button.btn.btn--apricot.btn--block.btn--lg', { type: 'button', id: 'ax-pl-save', text: '保存当前方案' });
  const saveLine = el('div.loading-line');

  // 当前选中家具卡：别处（商品页 / 3D / 试摆）选了家具，这里跟着变
  const currentBox = el('div.card');
  function renderCurrent() {
    const p = ctx.state;
    currentBox.textContent = '';
    currentBox.appendChild(el('div.card__body.row', { style: 'align-items:center;gap:12px;' }, [
      el('div', {
        style: 'width:56px;height:56px;border-radius:var(--radius-sm);flex:0 0 auto;overflow:hidden;' +
          'background:var(--c-stone);display:flex;align-items:center;justify-content:center;',
      }, p.productImage ? [el('img', { src: p.productImage, alt: '', style: 'width:100%;height:100%;object-fit:cover;' })] : ['—']),
      el('div.grow', {}, [
        el('div', { text: p.productName || '还没选家具', style: 'font-size:14px;letter-spacing:.06em;' }),
        el('div.tiny.muted', { text: p.productId || '先在家具页或 3D 里挑一件', style: 'margin-top:2px;' }),
      ]),
    ]));
  }
  renderCurrent();
  const offCurrent = ctx.on('product:selected', renderCurrent);
  cleanups.push(offCurrent);

  async function save() {
    const productId = ctx.state.productId;
    if (!productId) {
      ctx.toast('先挑一件家具再保存——去「商品」或「3D」看看');
      return;
    }
    const phone = phoneInput.value.trim();
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      ctx.toast('手机号填 11 位数字，不填也行');
      phoneInput.focus();
      return;
    }
    const item = { productId };
    if (style.color) item.color = String(style.color).slice(0, 20);
    if (style.materialId) item.materialId = String(style.materialId).slice(0, 20);

    saveBtn.disabled = true;
    saveBtn.textContent = '正在保存…';
    saveLine.textContent = '阿杏正在把方案收好';
    try {
      const data = await api.saveScene({
        name: nameInput.value.trim(), phone, items: [item],
      });
      if (phone) ctx.setState({ phone });
      const saved = (data && data.scene) || null;
      ctx.toast(saved ? `已保存：${saved.name}` : '方案已保存');
      loadMine(phone || myPhoneForQuery());
    } catch (err) {
      ctx.toast(ctx.humanError(err));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存当前方案';
      saveLine.textContent = '';
    }
  }
  saveBtn.addEventListener('click', save);

  stack.appendChild(el('div.card', {}, [
    el('div.card__body.stack', {}, [
      el('div.tiny.muted', { text: 'SAVE', style: 'letter-spacing:.24em;' }),
      currentBox,
      el('div.field', { style: 'margin-bottom:12px;' }, [el('span', { text: '方案名字' }), nameInput]),
      el('div.field', { style: 'margin-bottom:12px;' }, [el('span', { text: '手机号' }), phoneInput]),
      saveBtn,
      saveLine,
    ]),
  ]));

  // ---------- 我的方案列表 ----------
  const listSlot = el('div.stack.stack--sm');
  const listLoading = el('div.loading-line');
  let myListPhone = ctx.state.phone || '';

  function myPhoneForQuery() { return myListPhone; }

  async function loadMine(phoneArg) {
    const phone = (phoneArg || myListPhone || phoneInput.value || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      listSlot.textContent = '';
      listSlot.appendChild(el('div.empty', { text: '填一下手机号，阿杏把你保存的方案找出来' }));
      return;
    }
    myListPhone = phone;
    phoneInput.value = phone;
    listLoading.textContent = '正在找你的方案…';
    listSlot.textContent = '';
    try {
      const data = await api.scenesByPhone(phone);
      const scenes = (data && data.scenes) || [];
      if (!scenes.length) {
        listSlot.appendChild(el('div.empty', { text: '还没有方案。上面选一件家具，点「保存当前方案」就有了。' }));
        return;
      }
      scenes.forEach((s) => listSlot.appendChild(sceneCard(s)));
    } catch (err) {
      listSlot.appendChild(el('div.empty', { text: ctx.humanError(err) }));
    } finally {
      listLoading.textContent = '';
    }
  }

  function sceneCard(scene) {
    const items = Array.isArray(scene.items) ? scene.items : [];
    const date = (scene.createdAt || '').slice(0, 10);
    const card = el('div.card');

    const head = el('div.card__body.row.row--between', { style: 'align-items:flex-start;gap:10px;' }, [
      el('div.grow', {}, [
        el('div', { text: scene.name || '我的家', style: 'font-size:15px;letter-spacing:.06em;' }),
        el('div.tiny.muted', { text: date || '', style: 'margin-top:2px;' }),
      ]),
      el('div.tiny.muted', { text: `${items.length} 件`, style: 'flex:0 0 auto;' }),
    ]);
    card.appendChild(head);

    const body = el('div', { style: 'padding:0 16px 16px;display:flex;flex-direction:column;gap:12px;' });
    items.forEach((it) => {
      const tags = [];
      const c = resolveColor(it.color);
      if (c) tags.push(tag(ctx, `颜色 ${c.label}`, c.hex));
      if (it.materialId) tags.push(tag(ctx, MATERIAL_LABELS[it.materialId] || it.materialId));
      body.appendChild(el('div.row', { style: 'align-items:center;gap:10px;' }, [
        el('div', {
          style: 'width:44px;height:44px;border-radius:var(--radius-sm);flex:0 0 auto;overflow:hidden;' +
            'background:var(--c-stone);display:flex;align-items:center;justify-content:center;',
        }, it.productImage ? [el('img', { src: it.productImage, alt: '', style: 'width:100%;height:100%;object-fit:cover;' })] : ['—']),
        el('div.grow', { style: 'min-width:0;' }, [
          el('div', { text: it.productName || it.productId, style: 'font-size:13px;line-height:1.5;' }),
          tags.length ? el('div.row', { style: 'gap:6px;margin-top:4px;flex-wrap:wrap;' }, tags) : null,
        ].filter(Boolean)),
      ]));
    });
    card.appendChild(body);

    const ops = el('div', { style: 'padding:0 16px 16px;display:flex;gap:8px;' }, [
      el('button.btn', {
        type: 'button', text: '接着看', style: 'flex:1;',
        onclick: async () => {
          const first = items[0];
          if (!first) return;
          ctx.setState({
            productId: first.productId,
            productName: first.productName || null,
            productImage: first.productImage || null,
            productPrice: first.productPrice || null,
          });
          try {
            const data = await api.product(first.productId);
            if (data && data.product) ctx.pickProduct(data.product);
          } catch { /* 离线也用已有信息继续 */ }
          ctx.go('view-3d');
        },
      }),
      el('button.btn.btn--ghost', {
        type: 'button', text: '预约到店', style: 'flex:1;',
        onclick: () => {
          const ids = items.map((it) => it.productId).filter(Boolean);
          if (ids.length) ctx.setState({ productIds: ids, productId: ids[0] });
          ctx.go('view-booking');
        },
      }),
    ]);
    card.appendChild(ops);
    return card;
  }

  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'SAVED' }),
    el('div.chip-row', { style: 'margin-bottom:12px;' }, [
      el('button.btn.btn--block', { type: 'button', text: '刷新我的方案', onclick: () => loadMine() }),
    ]),
    listLoading,
    listSlot,
  ]));

  // 初始：有手机号就自动拉一次，否则给空态引导
  if (/^1[3-9]\d{9}$/.test(ctx.state.phone || '')) loadMine(ctx.state.phone);
  else {
    listSlot.appendChild(el('div.empty', {
      text: '还没有方案。上面选一件家具，点「保存当前方案」，这儿就能翻到了。',
    }));
  }

  return () => cleanups.forEach((fn) => { try { fn(); } catch { /* 忽略清理异常 */ } });
}
