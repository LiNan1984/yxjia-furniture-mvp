// view-material.js — 材质科普：本地策展内容（不调 AI，保证稳定）+ 情况 chips 本地规则推荐。
// 约定：export async function mount(root, ctx)，可 return cleanup 函数。

const MATERIALS = [
  {
    id: 'fabric',
    name: '布艺',
    sum: '最常见的一种，手感软、颜色多，价格也亲民。',
    pros: ['手感柔软，贴着皮肤坐舒服', '颜色花纹选择最多，家好搭', '价格相对友好，冬天不冰凉'],
    cons: ['浅色容易脏，溅到饮料要马上擦', '猫狗容易勾丝起球', '缝隙里容易藏灰'],
    fit: '预算有限、想家里温馨一点的人家。',
    care: '每周用吸尘器走一遍；每季度拆洗一次外套；污渍用中性清洁剂点擦，别整片泡水。',
  },
  {
    id: 'tech',
    name: '科技布',
    sum: '摸起来像皮，价格只有皮的一小部分，还特别好打理。',
    pros: ['防水防污，洒了汤一擦就净', '耐磨抗抓，宠物小孩都不怕', '有皮的质感，价钱却低不少'],
    cons: ['透气性不如真皮和布艺', '太薄的料子用两三年可能掉渣，要选厚实的'],
    fit: '有小孩、有宠物、想省事省心的家庭。',
    care: '湿布一擦就行；别用酒精和强酸强碱的清洁剂；避开阳光长时间直晒。',
  },
  {
    id: 'leather',
    name: '真皮',
    sum: '质感最好也最贵的一套，保养好了能用十几年。',
    pros: ['质感高级，客人一看就晓得', '耐用，保养好十年以上没问题', '透气，冬暖夏凉不粘身'],
    cons: ['价格高，而且要花心思保养', '怕晒怕干，暖气旁容易裂', '有皮革味，敏感的人先到店闻一闻'],
    fit: '预算充足、打算用很多年、看重气派的人家。',
    care: '每半年上一次皮革护理膏；远离暖气片和阳台直晒；用微湿软布擦，别用湿拖把。',
  },
  {
    id: 'wood',
    name: '实木',
    sum: '架子是整块木头做的，结实、环保，能用一辈子。',
    pros: ['结实稳当，承重好，摇不响', '天然木头，味道小，家里有小孩也放心', '越用越耐用，坏了还能修'],
    cons: ['价格比板材高一截', '怕晒怕干，暖气旁可能开裂', '木头有天然色差和纹路，这不是毛病'],
    fit: '家里有老人小孩、看重环保结实的人家。',
    care: '别放暖气片和阳台边；半年打一次木蜡油；灰用干布擦，别用水冲。',
  },
  {
    id: 'mdf',
    name: '密度板',
    sum: '木头碎屑压成的板，便宜、款式多，性价比之王。',
    pros: ['价格便宜，样子选择多', '表面平整，能做好看的造型', '轻便，搬家挪位不费劲'],
    cons: ['怕水怕潮，泡一次水就废', '承重一般，不能当凳子站', '一定要认准环保等级（E0 / E1）'],
    fit: '租房过渡、预算有限、想常换款式的人。',
    care: '保持干燥，卫生间厨房别用；螺丝松了及时拧紧；湿布擦完马上用干布收干。',
  },
];

// 情况 → 本地规则推荐（不调 AI）
const SITUATIONS = [
  { id: 'kid', label: '有小孩', say: '有小孩我建议看科技布：溅上奶和饮料一擦就掉，边角最好选圆角的，磕不着。' },
  { id: 'pet', label: '有宠物', say: '有宠物首选科技布：抗抓耐磨，比布艺好打理，猫爪不容易勾丝。真皮要留神，猫最爱拿它磨爪。' },
  { id: 'elder', label: '家里有老人', say: '家里有老人我推荐实木：结实稳当、味道小。沙发偏硬一点起坐更省力，坐高别太低。' },
  { id: 'budget', label: '预算有限', say: '预算有限就看密度板配布艺：价格友好、款式也多。认准环保等级，避开潮湿的地方放。' },
  { id: 'easy', label: '想要好打理', say: '想好打理就科技布或真皮：脏了一擦就净。真皮更耐用，但要记得半年保养一次。' },
];

const DEFAULT_TIP = '点一下上头的情况（比如「有宠物」），阿杏按你家情况给你说。';

/** 小标题（杏色细体 eyebrow + 说明） */
function blockTitle(ctx, eyebrow, title) {
  const { el } = ctx.ui;
  return el('div', {}, [
    el('p.sec-eyebrow', { text: eyebrow }),
    el('h3.sec-title', { text: title, style: 'font-size:17px;margin:0 0 6px;' }),
  ]);
}

/** 带小圆点前缀的条目（纯文本节点，防 XSS） */
function dotted(ctx, text) {
  const { el } = ctx.ui;
  return el('div.row', { style: 'align-items:flex-start;gap:8px;' }, [
    el('span', { text: '·', style: 'color:var(--c-apricot-deep);font-size:16px;line-height:1.4;flex:0 0 auto;' }),
    el('span', { text, style: 'font-size:13px;line-height:1.7;' }),
  ]);
}

function listGroup(ctx, title, items) {
  const { el } = ctx.ui;
  return el('div.stack.stack--sm', { style: 'gap:6px;' }, [
    el('div.tiny.muted', { text: title, style: 'letter-spacing:.2em;' }),
    ...items.map((t) => dotted(ctx, t)),
  ]);
}

export async function mount(root, ctx) {
  const { el, axingSay } = ctx.ui;

  const stack = el('div.stack');
  root.appendChild(stack);

  // ---------- 顶部说明 ----------
  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'MATERIAL GUIDE' }),
    el('h2.sec-title', { text: '材质科普' }),
    el('p.sec-desc', { text: '阿杏不跟你说「实木一定好」。看你家的情况，给你说谁更合适。' }),
  ]));

  // ---------- 情况 chips + 阿杏推荐 ----------
  let activeSituation = null;
  const sayText = el('div.ax-bubble.grow', { text: DEFAULT_TIP });
  const sayRow = el('div.ax-row', {}, [ctx.ui.avatar('sm'), sayText]);

  const situationChips = SITUATIONS.map((s) => el('button.chip', {
    type: 'button',
    text: s.label,
    onclick: () => {
      activeSituation = activeSituation === s.id ? null : s.id;
      situationChips.forEach((c) => c.classList.remove('active'));
      if (activeSituation) {
        const chip = situationChips[SITUATIONS.indexOf(s)];
        chip.classList.add('active');
        sayText.textContent = s.say;
      } else {
        sayText.textContent = DEFAULT_TIP;
      }
    },
  }));

  stack.appendChild(el('div.card', {}, [
    el('div.card__body.stack', {}, [
      blockTitle(ctx, 'YOUR HOME', '你家是什么情况？点一下'),
      el('div.chip-row', {}, situationChips),
      sayRow,
    ]),
  ]));

  // ---------- 材质列表（横滚 chips） ----------
  const detail = el('div');
  let activeId = null;

  function renderDetail(m) {
    detail.textContent = '';
    const card = el('div.card', {}, [
      el('div.card__body.stack', {}, [
        el('div', {}, [
          el('h3.sec-title', { text: m.name, style: 'font-size:20px;margin:0 0 4px;' }),
          el('p.sec-desc', { text: m.sum, style: 'margin:0;' }),
        ]),
        listGroup(ctx, '好处', m.pros),
        listGroup(ctx, '要注意', m.cons),
        el('div.spec-row', {}, [
          el('span', { text: '适合谁' }),
          el('span', { text: m.fit }),
        ]),
        el('div.spec-row', { style: 'border-bottom:none;' }, [
          el('span', { text: '怎么保养' }),
          el('span', { text: m.care, style: 'flex:1;' }),
        ]),
      ]),
    ]);
    detail.appendChild(card);
  }

  const chips = MATERIALS.map((m) => el('button.chip', {
    type: 'button',
    text: m.name,
    onclick: () => {
      activeId = activeId === m.id ? null : m.id;
      chips.forEach((c) => c.classList.remove('active'));
      if (activeId) {
        chips[MATERIALS.indexOf(m)].classList.add('active');
        renderDetail(m);
      } else {
        detail.textContent = '';
        detail.appendChild(el('div.empty', { text: '点上面的名字，看看这种材质怎么样' }));
      }
    },
  }));

  stack.appendChild(el('div', {}, [
    blockTitle(ctx, 'PICK ONE', '选一种材质看看'),
    el('div.chip-scroll', {}, chips),
  ]));
  stack.appendChild(detail);
  detail.appendChild(el('div.empty', { text: '点上面的名字，看看这种材质怎么样' }));

  // ---------- 结尾阿杏 ----------
  stack.appendChild(el('div.stack.stack--sm', {}, [
    axingSay('纠结的话，拍张照片问我，我按你家情况说。'),
    el('div.chip-row', {}, [
      el('button.btn.btn--apricot', { type: 'button', text: '拍客厅照试摆', onclick: () => ctx.go('view-upload') }),
      el('button.btn.btn--ghost', { type: 'button', text: '语音问阿杏', onclick: () => ctx.go('view-voice') }),
    ]),
  ]));

  return null;
}
