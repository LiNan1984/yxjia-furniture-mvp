// view-me.js — 我的：登录（验证码固定 123456）+ 站点入口链接 + 门店信息卡。保持简单。
// 约定：export async function mount(root, ctx)，可 return cleanup 函数。

const STORE = {
  name: '银杏家具体验店',
  address: '陕西省商洛市柞水县乾佑街道农机路河西',
  phone: '13359140982',
  hours: '9:00 – 20:00 全年无休',
};

/** 列表行：图标 + 标题 + 说明 + 右箭头；href 存在时是 <a>，否则是 <button> */
function entryRow(ctx, { icon, title, desc, href, onclick }) {
  const { el } = ctx.ui;
  const inner = [
    el('div', {
      style: 'width:38px;height:38px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;' +
        'justify-content:center;font-size:17px;background:rgba(232,178,125,.18);',
      text: icon,
    }),
    el('div.grow', {}, [
      el('div', { text: title, style: 'font-size:14px;letter-spacing:.06em;' }),
      desc ? el('div.tiny.muted', { text: desc, style: 'margin-top:1px;line-height:1.6;' }) : null,
    ].filter(Boolean)),
    el('div.muted', { text: '›', style: 'font-size:20px;font-weight:200;line-height:1;' }),
  ];
  const attrs = {
    style: 'display:flex;align-items:center;gap:12px;width:100%;min-height:60px;padding:14px 16px;text-align:left;' +
      'text-decoration:none;color:var(--c-charcoal);',
  };
  const node = href ? el('a.card', { ...attrs, href }) : el('button.card', { ...attrs, type: 'button', onclick });
  inner.forEach((c) => node.appendChild(c));
  return node;
}

function storeCard(ctx) {
  const { el } = ctx.ui;
  return el('div.card', {}, [
    el('div.card__body.stack.stack--sm', {}, [
      el('div', { text: STORE.name, style: 'font-size:15px;letter-spacing:.08em;' }),
      el('div.tiny.muted', { text: STORE.address, style: 'line-height:1.8;' }),
      el('div.tiny.muted', { text: `营业 ${STORE.hours}` }),
      el('a.btn.btn--block', { href: `tel:${STORE.phone}`, text: `📞 打给店里 ${STORE.phone}` }),
    ]),
  ]);
}

export async function mount(root, ctx) {
  const { el, axingSay, avatar } = ctx.ui;
  // app.js 注入的 ctx.api 是 api.js 的模块命名空间（{ ApiError, api }），
  // 真正的请求对象在 ctx.api.api 上；这里两种形状都兼容。
  const api = (ctx.api && ctx.api.api) || ctx.api || {};
  const stack = el('div.stack');
  root.appendChild(stack);

  // ---------- 顶部说明 ----------
  stack.appendChild(el('div.row', {}, [
    avatar('lg'),
    el('div.grow', {}, [
      el('h2.sec-title', { text: '我的', style: 'font-size:21px;margin:2px 0 4px;' }),
      el('p.tiny.muted', { text: '登录后，方案和试摆记录都记在你手机号下' }),
    ]),
  ]));

  // ---------- 登录 / 已登录 ----------
  const authSlot = el('div');
  stack.appendChild(authSlot);

  function renderLoggedIn(phone) {
    authSlot.textContent = '';
    authSlot.appendChild(el('div.card', {}, [
      el('div.card__body.stack.stack--sm', {}, [
        el('div.row.row--between', {}, [
          el('div', {}, [
            el('div.tiny.muted', { text: '已登录', style: 'letter-spacing:.24em;' }),
            el('div', { text: phone, style: 'font-size:17px;letter-spacing:.08em;margin-top:2px;' }),
          ]),
          el('div.ax-avatar', { text: '杏' }),
        ]),
        axingSay('登录好啦。你保存的方案和预约，阿杏都记在这个手机号下。', { small: true }),
        el('button.btn.btn--ghost.btn--block', {
          type: 'button', text: '退出登录',
          onclick: () => {
            ctx.setState({ phone: '' });
            ctx.toast('已退出，本机不保留手机号了');
            renderLoggedOut();
          },
        }),
      ]),
    ]));
  }

  function renderLoggedOut() {
    authSlot.textContent = '';
    const phoneInput = el('input', { id: 'ax-me-phone', type: 'tel', placeholder: '11 位手机号', maxlength: '11', inputmode: 'numeric', autocomplete: 'tel' });
    const codeInput = el('input', { id: 'ax-me-code', type: 'text', placeholder: '验证码', maxlength: '6', inputmode: 'numeric' });
    const btn = el('button.btn.btn--apricot.btn--block.btn--lg', { type: 'button', id: 'ax-me-login', text: '登录' });
    const line = el('div.loading-line');
    let busy = false;

    async function submit() {
      if (busy) return;
      const phone = phoneInput.value.trim();
      const code = codeInput.value.trim();
      if (!/^1\d{10}$/.test(phone)) { ctx.toast('手机号填 11 位数字'); phoneInput.focus(); return; }
      if (!code) { ctx.toast('验证码填 123456（体验版）'); codeInput.focus(); return; }
      busy = true;
      btn.disabled = true;
      btn.textContent = '正在登录…';
      line.textContent = '阿杏正在核对…';
      try {
        const data = await api.login(phone, code);
        const realPhone = (data && data.user && data.user.phone) || phone;
        ctx.setState({ phone: realPhone });
        ctx.toast(`登录成功，${realPhone}`);
        renderLoggedIn(realPhone);
      } catch (err) {
        ctx.toast(ctx.humanError(err));
        codeInput.focus();
      } finally {
        busy = false;
        btn.disabled = false;
        btn.textContent = '登录';
        line.textContent = '';
      }
    }

    btn.addEventListener('click', submit);
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    authSlot.appendChild(el('div.card', {}, [
      el('div.card__body', {}, [
        el('div.field', {}, [el('span', { text: '手机号' }), phoneInput]),
        el('div.field', {}, [
          el('span', { text: '验证码' }),
          codeInput,
          el('div.tiny.muted', { text: '验证码固定 123456（体验版）', style: 'margin-top:4px;' }),
        ]),
        btn,
        line,
        el('p.tiny.muted.center', {
          text: '不登录也能看家具、试摆、预约；登录只是方便找回你的方案。',
          style: 'margin-top:12px;line-height:1.8;',
        }),
      ]),
    ]));
  }

  if (ctx.state.phone) renderLoggedIn(ctx.state.phone);
  else renderLoggedOut();

  // 有历史会话（cookie）就自动认出来
  api.me().then((data) => {
    const p = data && data.user && data.user.phone;
    if (p && !ctx.state.phone) {
      ctx.setState({ phone: p });
      renderLoggedIn(p);
    }
  }).catch(() => { /* 未登录，静默 */ });

  // 别处登录了（比如语音页引导登录），这里跟着变
  const off = ctx.on('state:changed', (s) => {
    const shown = authSlot.querySelector('#ax-me-phone');
    if (s.phone && !shown) renderLoggedIn(s.phone);
    if (!s.phone && shown) renderLoggedOut();
  });

  // ---------- 入口列表 ----------
  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'MY STUFF' }),
    el('div.stack.stack--sm', {}, [
      entryRow(ctx, { icon: '🧾', title: '我的订单', desc: '下单的家具在这儿查', href: '/my-orders' }),
      entryRow(ctx, { icon: '🏠', title: '我的家', desc: '全屋分析、家里摆过的样子', href: '/my-home' }),
      entryRow(ctx, { icon: '🖼', title: '我的生成记录', desc: 'AI 合成过的图和方案', href: '/my-generations' }),
      entryRow(ctx, { icon: '📅', title: '我的预约', desc: '约了哪天到店，一看就知道', onclick: () => ctx.go('view-booking') }),
      entryRow(ctx, { icon: '📍', title: '到店预约', desc: '挑个日子来店里坐坐', onclick: () => ctx.go('view-booking') }),
    ]),
  ]));

  // ---------- 门店信息 ----------
  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'STORE' }),
    storeCard(ctx),
  ]));

  return () => off();
}
