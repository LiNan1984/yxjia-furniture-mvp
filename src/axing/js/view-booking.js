// view-booking.js — 到店预约：表单提交 /api/appointments + 成功面板（含门店信息与电话）+ 我的预约查询。
// 约定：export async function mount(root, ctx)，可 return cleanup 函数。

const SLOTS = ['上午 9:00-12:00', '下午 12:00-18:00', '晚上 18:00-20:00'];

const STORE = {
  name: '银杏家具体验店',
  address: '陕西省商洛市柞水县乾佑街道农机路河西',
  phone: '13359140982',
  hours: '9:00 – 20:00 全年无休',
};

/** 门店信息卡（可复用小块） */
function storeCard(ctx) {
  const { el } = ctx.ui;
  return el('div.card', {}, [
    el('div.card__body.stack.stack--sm', {}, [
      el('div', { text: STORE.name, style: 'font-size:15px;letter-spacing:.08em;' }),
      el('div.spec-row', { style: 'border-bottom:none;padding:4px 0;' }, [
        el('span', { text: '地址' }), el('span', { text: STORE.address }),
      ]),
      el('div.spec-row', { style: 'border-bottom:none;padding:4px 0;' }, [
        el('span', { text: '营业' }), el('span', { text: STORE.hours }),
      ]),
      el('a.btn.btn--block', { href: `tel:${STORE.phone}`, text: `📞 打给店里 ${STORE.phone}` }),
    ]),
  ]);
}

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function label(ctx, text) {
  return ctx.ui.el('span', { text });
}

export async function mount(root, ctx) {
  const { el, axingSay } = ctx.ui;
  // app.js 注入的 ctx.api 是 api.js 的模块命名空间（{ ApiError, api }），
  // 真正的请求对象在 ctx.api.api 上；这里两种形状都兼容。
  const api = (ctx.api && ctx.api.api) || ctx.api || {};
  const stack = el('div.stack');
  root.appendChild(stack);

  // ---------- 顶部说明 ----------
  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'BOOK A VISIT' }),
    el('h2.sec-title', { text: '预约到店' }),
    el('p.sec-desc', { text: '挑个日子来店里坐一坐、摸一摸实物。阿杏先把你要看的家具准备好，到店报手机号就行。' }),
  ]));

  // ---------- 表单槽（成功后整块换成成功面板） ----------
  const formSlot = el('div.stack');
  stack.appendChild(formSlot);

  let selectedSlot = SLOTS[0];
  let submitting = false;

  function buildForm() {
    formSlot.textContent = '';

    // 想看的家具（来自 state.productIds / state.productId）
    const picked = (Array.isArray(ctx.state.productIds) && ctx.state.productIds.length)
      ? ctx.state.productIds.slice()
      : (ctx.state.productId ? [ctx.state.productId] : []);

    const pickedRow = el('div.chip-row');
    function renderPicked() {
      pickedRow.textContent = '';
      if (!picked.length) {
        pickedRow.appendChild(el('div.tiny.muted', {
          text: '还没选家具——直接来店逛也行，阿杏带你转。',
          style: 'line-height:1.8;',
        }));
        return;
      }
      picked.forEach((pid, i) => {
        const name = (pid === ctx.state.productId && ctx.state.productName) ? ctx.state.productName : pid;
        const chip = el('button.chip', { type: 'button', text: `${name} ✕` });
        chip.style.minHeight = '34px';
        chip.addEventListener('click', () => {
          if (submitting) return;
          picked.splice(i, 1);
          renderPicked();
        });
        pickedRow.appendChild(chip);
      });
    }
    renderPicked();

    const nameInput = el('input', { id: 'ax-bk-name', type: 'text', placeholder: '怎么称呼您', maxlength: '20', autocomplete: 'name' });
    const phoneInput = el('input', { id: 'ax-bk-phone', type: 'tel', placeholder: '11 位手机号', maxlength: '11', inputmode: 'numeric', autocomplete: 'tel', value: ctx.state.phone || '' });
    const dateInput = el('input', { id: 'ax-bk-date', type: 'date', min: todayLocal(), value: todayLocal() });
    const noteInput = el('textarea', { id: 'ax-bk-note', rows: '3', maxlength: '200', placeholder: '比如：想看转角沙发，客厅三米五（选填）' });

    const submitBtn = el('button.btn.btn--apricot.btn--block.btn--lg', { type: 'submit', id: 'ax-bk-submit', text: '提交预约' });
    const loadingLine = el('div.loading-line');

    const form = el('form', {
      id: 'ax-bk-form',
      style: 'display:block;',
      onsubmit: async (e) => {
        e.preventDefault();
        if (submitting) return;
        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();
        const date = dateInput.value;
        const note = noteInput.value.trim();

        if (!name) { ctx.toast('先填一下怎么称呼您'); nameInput.focus(); return; }
        if (!/^1\d{10}$/.test(phone)) { ctx.toast('手机号好像是 11 位数字，再看一眼'); phoneInput.focus(); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { ctx.toast('选一个到店日期'); dateInput.focus(); return; }
        if (!SLOTS.includes(selectedSlot)) { ctx.toast('选一个到店时段'); return; }

        submitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = '正在提交…';
        loadingLine.textContent = '阿杏正在登记，稍等一下';
        try {
          const productIds = picked.filter(Boolean);
          const data = await api.createAppointment({
            name, phone, date, slot: selectedSlot,
            productIds, note: note.slice(0, 500),
          });
          ctx.setState({ phone });
          renderSuccess(data && data.appointment, { name, phone, date, productIds, note });
        } catch (err) {
          ctx.toast(ctx.humanError(err));
        } finally {
          submitting = false;
          submitBtn.disabled = false;
          submitBtn.textContent = '提交预约';
          loadingLine.textContent = '';
        }
      },
    }, [
      el('div.field', {}, [label(ctx, '称呼'), nameInput]),
      el('div.field', {}, [label(ctx, '手机号'), phoneInput]),
      el('div.field', {}, [label(ctx, '到店日期'), dateInput]),
      el('div.field', {}, [
        label(ctx, '到店时段'),
        el('div.chip-row', {}, SLOTS.map((s) => {
          const chip = el('button.chip', { type: 'button', text: s });
          if (s === selectedSlot) chip.classList.add('active');
          chip.style.minHeight = '38px';
          chip.addEventListener('click', () => {
            if (submitting) return;
            selectedSlot = s;
            Array.from(chip.parentElement.children).forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
          });
          return chip;
        })),
      ]),
      el('div.field', {}, [
        label(ctx, '想到店看什么'),
        pickedRow,
        el('div.tiny.muted', { text: '点名字后面的 ✕ 可以去掉的', style: 'margin-top:6px;' }),
      ]),
      el('div.field', {}, [label(ctx, '想多说两句（选填）'), noteInput]),
      submitBtn,
      loadingLine,
    ]);

    formSlot.appendChild(el('div.card', {}, [el('div.card__body', { style: 'padding-top:6px;' }, [form])]));
    formSlot.appendChild(axingSay('约好之后，到店报手机号就行。销售会把你要看的家具先摆出来。'));
    formSlot.appendChild(storeCard(ctx));
  }

  function renderSuccess(appt, echo) {
    formSlot.textContent = '';
    const id = (appt && appt.id) || '—';
    formSlot.appendChild(el('div.card', { style: 'border-color:var(--c-apricot);' }, [
      el('div.card__body.stack', {}, [
        el('p.sec-eyebrow', { text: 'BOOKED', style: 'color:var(--c-apricot-deep);' }),
        el('h3.sec-title', { text: '预约已收到', style: 'font-size:20px;margin:0 0 4px;' }),
        el('div', { text: `预约号 ${id}`, style: 'font-size:15px;letter-spacing:.1em;margin-bottom:6px;' }),
        axingSay('阿杏已经帮你把方案准备好了，到店报手机号就行。'),
        el('div', { style: 'display:flex;flex-direction:column;gap:4px;' }, [
          el('div.spec-row', {}, [el('span', { text: '称呼' }), el('span', { text: echo.name })]),
          el('div.spec-row', {}, [el('span', { text: '手机号' }), el('span', { text: echo.phone })]),
          el('div.spec-row', {}, [el('span', { text: '到店日期' }), el('span', { text: echo.date })]),
          el('div.spec-row', {}, [el('span', { text: '时段' }), el('span', { text: selectedSlot })]),
          el('div.spec-row', {}, [
            el('span', { text: '想看的家具' }),
            el('span', { text: echo.productIds.length ? `${echo.productIds.length} 件` : '到店再挑' }),
          ]),
          echo.note ? el('div.spec-row', {}, [el('span', { text: '备注' }), el('span', { text: echo.note })]) : null,
        ].filter(Boolean)),
        el('div.chip-row', {}, [
          el('button.btn.btn--apricot', { type: 'button', text: '再约一个', onclick: buildForm }),
          el('button.btn.btn--ghost', { type: 'button', text: '回首页', onclick: () => ctx.go('view-home') }),
        ]),
      ]),
    ]));
    formSlot.appendChild(storeCard(ctx));
  }

  buildForm();

  // ---------- 我的预约 ----------
  const mySlot = el('div.stack');
  stack.appendChild(mySlot);

  const myPhone = el('input', { id: 'ax-bk-my-phone', type: 'tel', placeholder: '11 位手机号', maxlength: '11', inputmode: 'numeric', value: ctx.state.phone || '' });
  const myBtn = el('button.btn.btn--block', { type: 'button', id: 'ax-bk-my-btn', text: '查我的预约' });
  const myList = el('div.stack.stack--sm');
  const myLoading = el('div.loading-line');

  async function loadMine() {
    const phone = myPhone.value.trim();
    if (!/^1\d{10}$/.test(phone)) { ctx.toast('先填 11 位手机号，阿杏才好帮你查'); myPhone.focus(); return; }
    myBtn.disabled = true;
    myBtn.textContent = '正在查…';
    myLoading.textContent = '正在翻预约本子…';
    myList.textContent = '';
    try {
      const data = await api.appointmentsByPhone(phone);
      const list = (data && data.appointments) || [];
      if (!list.length) {
        myList.appendChild(el('div.empty', { text: '还没有预约记录，填上面的表就能约' }));
        return;
      }
      list.forEach((a) => {
        const products = (a.productNames && a.productNames.length) ? a.productNames.join('、') : '到店再挑';
        myList.appendChild(el('div.card', {}, [
          el('div.card__body.stack.stack--sm', { style: 'gap:6px;' }, [
            el('div.row.row--between', {}, [
              el('div', { text: `${a.date} ${a.slot}`, style: 'font-size:14px;letter-spacing:.06em;' }),
              el('div.tiny.muted', { text: a.status || '待到店' }),
            ]),
            el('div.tiny.muted', { text: `预约号 ${a.id}`, style: 'letter-spacing:.12em;' }),
            el('div.spec-row', { style: 'border-bottom:none;padding:4px 0;' }, [
              el('span', { text: '想看的' }), el('span', { text: products }),
            ]),
          ]),
        ]));
      });
    } catch (err) {
      myList.appendChild(el('div.empty', { text: ctx.humanError(err) }));
    } finally {
      myBtn.disabled = false;
      myBtn.textContent = '查我的预约';
      myLoading.textContent = '';
    }
  }

  myBtn.addEventListener('click', loadMine);

  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'MY VISITS' }),
    el('div.card', {}, [
      el('div.card__body', {}, [
        el('div.field', { style: 'margin-bottom:12px;' }, [label(ctx, '手机号'), myPhone]),
        myBtn,
        myLoading,
      ]),
    ]),
    el('div', { style: 'height:14px;' }),
    myList,
  ]));

  // 手机号有变（比如登录后）就同步到表单
  const off = ctx.on('state:changed', (s) => {
    if (s.phone && !myPhone.value) myPhone.value = s.phone;
  });

  return () => off();
}
