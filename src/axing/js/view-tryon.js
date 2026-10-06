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

/** tryonEnabled 关时的「到店引导」：不逐个试摆报错，直接给打电话 + 预约到店两条出路。
 *  用于 AI 整体不可用（如 twofish key 失效）时，店主在后台把总闸关掉的情形。 */
function renderTryonPaused(root, ctx) {
  const { icon, axingSay } = ctx.ui;
  root.appendChild(el('p.sec-eyebrow', { text: 'AI 试摆 · 今天休息' }));
  root.appendChild(el('h2.sec-title', { text: '阿杏陪你到店看' }));
  root.appendChild(el('p.sec-desc', { text: '线上试摆临时休息。阿杏先帮你把想看的家具备好，到店坐一坐、摸一摸实物，最稳。' }));
  root.appendChild(axingSay('线上试摆今天暂时不可用。先打个电话，或者约个到店，阿杏把你要看的家具先摆出来。'));
  root.appendChild(el('a.btn.btn--block', { href: 'tel:13359140982' }, [icon('phone'), '打给店里 13359140982']));
  root.appendChild(el('button.btn.btn--block', { type: 'button', onclick: () => ctx.go('view-booking') }, [icon('calendar'), '预约到店']));
  root.appendChild(el('p.sec-desc.tiny.muted', { text: '陕西省商洛市柞水县乾佑街道农机路河西 · 9:00–20:00 全年无休' }));
}

export async function mount(root, ctx) {
  const { icon,  axingSay, priceText } = ctx.ui;
  const api = resolveApi(ctx);

  // —— tryonEnabled 总闸：AI 整体不可用时，不逐个试摆报错，直接切「到店引导」。——
  //    接口拉不到就默认开着，绝不因为一次网络抖动误伤正常试摆。
  let tryonEnabled = true;
  try {
    const res = await fetch('/api/feature-flags');
    if (res.ok) {
      const body = await res.json();
      const d = body && (body.data || body);
      if (d && typeof d.tryonEnabled === 'boolean') tryonEnabled = d.tryonEnabled;
    }
  } catch { /* 忽略，默认开着 */ }
  if (!tryonEnabled) { renderTryonPaused(root, ctx); return; }

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
  // 只留一句：按钮已经紧跟在下面，再把「选好家具和氛围/不满意再试」复述一遍是浪费
  // 首屏。实测这段 3 行吃掉 320px 宽屏 42px，正是主按钮掉出折叠线的原因之一。
  root.appendChild(el('p.sec-desc', {
    text: '点「立即生成」，约 20-40 秒出图。',
    style: 'margin-bottom:12px;',
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

  // 输入双图：顾客必须看得见「到底拿哪两张图去合成」（房间照 + 选中的家具）。
  // 家具图在这一页原来从头到尾没露面，只有一行文字「家具：聚木财MT50真皮软包床」——
  // 顾客无从判断 AI 收到的第二张图是不是自己以为的那一款，出了问题也无法核对。
  const roomThumb = el('img', { alt: '你的客厅', loading: 'lazy' });
  const sofaThumb = el('img', { alt: '选的家具', loading: 'lazy' });
  const roomThumbBox = el('div.ax-ty-input', {}, [
    roomThumb,
    el('figcaption', { text: '你的客厅', 'data-label': '你的客厅' }),
  ]);
  const sofaThumbBox = el('div.ax-ty-input', {}, [
    sofaThumb,
    el('figcaption', { text: '选的家具', 'data-label': '选的家具' }),
  ]);
  const inputsRow = el('div.ax-ty-inputs', {}, [roomThumbBox, sofaThumbBox]);
  root.appendChild(inputsRow);

  const upRow = el('div.row', { style: 'margin-top:10px;flex-wrap:wrap;' });
  root.appendChild(upRow);

  // 生成按钮 + 秒表：紧跟状态行，放在家具/氛围 chips 之前。
  // 原来它排在所有 chips 和自定义输入之后，实测 390×844 上 top=905（视口只有 844、
  // tabbar 占 780–844），黄金路径「房间→直接去试摆→立即生成」落地后还得再滑一下
  // 才看见主按钮。顾客来这一页的目的是「看效果」，精修项是生成之后的事。
  const genBtn = el('button.btn.btn--apricot.btn--lg.btn--block', {
    style: 'margin-top:14px;',
  }, [icon('spark'), '立即生成']);
  genBtn.addEventListener('click', generate);
  root.appendChild(genBtn);
  const timerLine = el('div.loading-line', { text: '', style: 'margin-top:10px;' });
  root.appendChild(timerLine);

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

  // 阿杏提示区（loading / 成功 / 失败 / 限额都在这说话）
  const sayBox = el('div', { style: 'margin-top:16px;' });
  root.appendChild(sayBox);
  const metaLine = el('p.tiny.muted', { text: '' });
  root.appendChild(metaLine);

  // 结果下方操作
  const actionRow = el('div.stack--sm', { style: 'margin-top:16px;', hidden: true }, [
    el('button.btn.btn--lg.btn--block', {
      onclick: () => {
        presetRow.querySelectorAll('button').forEach((b) => { b.className = 'chip'; });
        presetId = '';
        promptInput.value = '';
        clearResult();
        presetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    }, [icon('refresh'), '换个氛围再试']),
    el('div.row', {}, [
      el('button.btn.btn--ghost.grow', { onclick: () => ctx.go('view-3d') }, [icon('cube'), '3D 看看']),
      el('button.btn.btn--ghost.grow', { onclick: () => ctx.go('view-plans') }, [icon('spark'), '存进方案']),
      el('button.btn.btn--ghost.grow', { onclick: () => ctx.go('view-booking') }, [icon('calendar'), '预约到店']),
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
        text: '换一张', style: 'min-height:40px;padding:8px 14px;', onclick: () => (ctx.openUpload ? ctx.openUpload() : ctx.go('view-upload')),
      }));
    } else {
      upRow.appendChild(el('span', { text: '还没有客厅照' }));
      upRow.appendChild(el('button.btn.btn--ghost', {
        text: '去拍照', style: 'min-height:40px;padding:8px 14px;', onclick: () => (ctx.openUpload ? ctx.openUpload() : ctx.go('view-upload')),
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
    syncInputs();
  }

  // 两张输入缩略图跟着 state 走。缺哪张就摆占位（不是留个破图框）：
  // 顾客得知道「AI 手上只有一张图」，否则生成出来不像会莫名其妙。
  function syncInputs() {
    const s = ctx.state;
    const prod = products.find((p) => p.id === s.productId) || null;
    paintInput(roomThumbBox, roomThumb, s.roomUrl || '', '还没有客厅照');
    paintInput(sofaThumbBox, sofaThumb, (prod && prod.image) || s.productImage || '', '还没选家具');
  }

  function paintInput(box, img, src, emptyText) {
    const cap = box.querySelector('figcaption');
    if (!src) {
      box.classList.add('ax-ty-input--empty');
      img.removeAttribute('src');
      if (cap) cap.textContent = emptyText;
      return;
    }
    box.classList.remove('ax-ty-input--empty');
    if (img.getAttribute('src') !== src) img.src = src;
    if (cap) cap.textContent = cap.dataset.label;
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
    // 只换文字：图标是 el() 建按钮时放进来的子节点，不能整体覆盖 textContent
    genBtn.textContent = '';
    genBtn.append(icon('spark'), document.createTextNode(on ? '正在生成…' : '立即生成'));
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
      (ctx.openUpload ? ctx.openUpload() : ctx.go('view-upload'));
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

      // 结果怎么说，一律用后端给的 resultInfo（describeGenResult 的产物）。
      // 原先是 `if (data.aiError) 诚实提示 else 说「摆好了」`——而兜底出了图时 aiError 是
      // null，于是 Pollinations 那张重画的示意图也被说成「摆好了！这是 X 在你家的样子」。
      // 实测那张图和顾客的房间对不上（像素差 ~88、比例都没保住），等于拿假效果推 ¥3000 的单。
      const info = data.resultInfo || {
        tone: data.aiError ? 'warn' : 'good',
        label: data.aiError ? 'AI 没接通' : '真合成',
        note: data.aiError || '',
      };
      const name = (data.product && data.product.name) || ctx.state.productName || '家具';
      const headline = {
        good: `摆好了！这是「${name}」在你家的样子。按住右上角「对比」可以看原来的房间。`,
        info: `这是「${name}」的示意效果。旁边就是你家的客厅照，可以对着看。`,
        warn: `AI 这次没接通，先给你看预览。想要真实摆放效果，建议到店看实物。`,
        bad: `这次没出图。`,
      }[info.tone] || `这是「${name}」的预览。`;

      const actions = [];
      if (info.tone === 'good') {
        actions.push(el('button.btn.btn--lg.btn--block', { onclick: generate }, [icon('refresh'), '换个氛围再试']));
      } else {
        actions.push(el('button.btn.btn--lg.btn--block', { onclick: generate }, [icon('refresh'), '再试一次']));
        actions.push(el('button.btn.btn--ghost.btn--block', {
          onclick: () => { window.location.href = 'tel:13359140982'; },
        }, [icon('phone'), '打店里电话 13359140982']));
        actions.push(el('button.btn.btn--ghost.btn--block', {
          onclick: () => ctx.go('view-booking'),
        }, [icon('calendar'), '预约到店看实物']));
      }

      say(el('div.ax-ty-result', { 'data-tone': info.tone }, [
        el('div.ax-ty-result__label', { text: info.label }),
        el('div.ax-ty-result__note', { text: info.note || '' }),
        el('div', { style: 'margin-top:12px;' }, [axingSay(headline)]),
        el('div.stack--sm', { style: 'margin-top:12px;' }, actions),
      ]));

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
              onclick: () => ctx.go('view-booking'),
            }, [icon('calendar'), '预约到店体验']),
            el('button.btn.btn--ghost.btn--block', {
              onclick: () => { window.location.href = 'tel:13359140982'; },
            }, [icon('phone'), '打店里电话 13359140982']),
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
        el('button.btn.btn--ghost.btn--block', { text: '去拍客厅照', onclick: () => (ctx.openUpload ? ctx.openUpload() : ctx.go('view-upload')) }),
      ]),
    ]));
  }

  return () => {
    if (timer) clearInterval(timer);
    offPick();
    offState();
  };
}
