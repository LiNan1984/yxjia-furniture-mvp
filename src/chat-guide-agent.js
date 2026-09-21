/**
 * 银杏家具 AI 聊天导购助手
 * 基于 @openai/agents runtime（Agent + tool + Runner.run）
 * 工具直接读 data/products.json 的在售商品与门店信息
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  Agent,
  Runner,
  tool,
  setDefaultOpenAIClient,
  setDefaultOpenAIKey,
  setOpenAIAPI,
} from '@openai/agents';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRODUCTS_FILE = path.join(__dirname, '..', 'data', 'products.json');

const STORE_FALLBACK = {
  name: '银杏家具',
  slogan: '时光不负此行',
  phone: '13359140982',
  address: '陕西省商洛市柞水县乾佑街道 农机路河西',
  hours: '9:00 – 20:00（全年无休）',
  wechat: '同号 13359140982',
};

/** 读完整商品库 JSON（含 store + products） */
export function loadCatalog() {
  const raw = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function toPublicProduct(p) {
  return {
    id: p.id,
    name: p.name,
    subtitle: p.subtitle || '',
    price: p.price,
    size: p.size || '',
    stock: p.stock || '',
    badge: p.badge || '',
    description: p.description || '',
    highlights: Array.isArray(p.highlights) ? p.highlights : [],
    // v2 P1：导购话术可用「适合谁 / 怎么摆」，字段缺失时为空串（旧商品兜底）
    suitableFor: p.suitableFor || '',
    placementTip: p.placementTip || '',
    image: p.image || '',
    status: p.status || '在售',
  };
}

/** 仅返回在售商品（供工具与单测直接调用） */
export function listOnSaleProducts() {
  const data = loadCatalog();
  const list = Array.isArray(data) ? data : data.products || [];
  return list
    .filter((p) => !p.status || p.status === '在售')
    .map(toPublicProduct);
}

/**
 * 按关键词搜索在售商品
 * @param {{ query?: string }} input
 */
export function searchProducts(input = {}) {
  const query = String(input.query || '')
    .trim()
    .toLowerCase();
  const all = listOnSaleProducts();
  if (!query) return all;
  return all.filter((p) => {
    const hay = [
      p.id,
      p.name,
      p.subtitle,
      p.price,
      p.size,
      p.description,
      ...(p.highlights || []),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(query) || query.split(/\s+/).some((token) => token && hay.includes(token));
  });
}

/** 门店电话 / 地址 / 营业时间 */
export function getStoreInfo() {
  const data = loadCatalog();
  const store = data && !Array.isArray(data) ? data.store : null;
  return { ...STORE_FALLBACK, ...(store || {}) };
}

export const listProductsTool = tool({
  name: 'list_on_sale_products',
  description: '列出银杏家具店当前所有在售商品（含 id、名称、价格、尺寸、卖点）。推荐或比较商品前必须先调用。',
  parameters: z.object({}),
  execute: async () => listOnSaleProducts(),
});

export const searchProductsTool = tool({
  name: 'search_products',
  description: '按关键词搜索在售商品。关键词可以是品类（沙发/床/柜）、材质、颜色、价格片段或商品名。',
  parameters: z.object({
    query: z.string().describe('搜索关键词，例如：沙发、科技布、2999、新中式'),
  }),
  execute: async ({ query }) => searchProducts({ query }),
});

export const getStoreInfoTool = tool({
  name: 'get_store_info',
  description: '获取银杏家具实体店联系方式：电话、地址、营业时间、微信。顾客问到店/怎么联系时调用。',
  parameters: z.object({}),
  execute: async () => getStoreInfo(),
});

const GUIDE_INSTRUCTIONS = `你是「银杏家具」实体店的 AI 导购助手，服务柞水县到店顾客（偏老人友好）。

硬性规则：
1. 推荐商品前必须调用 list_on_sale_products 或 search_products，只能依据工具返回的在售真实数据说话，禁止编造价格/库存/型号。
2. 提到价格时原样引用工具里的 price 字段（如 ¥2899起）。
3. 顾客问电话、地址、营业时间时，必须调用 get_store_info。
4. 语气亲切简短，用中文，少用英文术语。
5. 可引导顾客：到店试坐、用网站「AI 试摆」上传客厅照、或拨打门店电话。
6. 若工具返回空列表，如实说暂时没有匹配商品，并建议打电话咨询。

【输出格式 — 必须遵守】
- 全部回复必须是可直接渲染的 Markdown 正文（面向 ynet 流式 Markdown 渲染引擎）。
- 不要包裹 \`\`\`markdown 代码围栏，不要输出 JSON，不要输出与回答无关的前后缀。
- 推荐商品时优先用：二级标题 + 无序列表或 Markdown 表格（表头如：商品 | 价格 | 编号）。
- 门店信息用列表：电话、地址、营业时间。
- 可用 **加粗**、引用块强调关键提示；不要使用自定义 ::: 组件（本页未注册图表组件）。

店铺定位：陕西省商洛市柞水县乾佑街道农机路河西 · 银杏家具。`;

/** 导购所用聊天模型名（阶跃 Step Plan / Ark 豆包 / OpenAI 兼容） */
export function getChatModelName() {
  return (
    process.env.CHAT_GUIDE_MODEL ||
    process.env.STEP_CHAT_MODEL ||
    process.env.OPENAI_CHAT_MODEL ||
    process.env.ARK_CHAT_MODEL ||
    (process.env.STEP_API_KEY ? 'step-3.7-flash' : 'doubao-seed-2-1-pro-260628')
  );
}

/**
 * @param {{ model?: import('@openai/agents').Model | string }} [options]
 */
export function createShoppingGuideAgent(options = {}) {
  const agentOptions = {
    name: '银杏家具导购助手',
    instructions: GUIDE_INSTRUCTIONS,
    tools: [listProductsTool, searchProductsTool, getStoreInfoTool],
    // 未注入 ScriptedModel 时，必须带上兼容网关的真实模型名（默认豆包）
    model: options.model || getChatModelName(),
  };
  return new Agent(agentOptions);
}

let openaiReady = false;
let configuredProvider = null;

export function getChatProviderInfo() {
  return {
    ready: openaiReady,
    provider: configuredProvider,
    model: getChatModelName(),
    fakeAllowed: process.env.CHAT_GUIDE_FAKE_MODEL === '1',
  };
}

/**
 * 配置 OpenAI Agents SDK 所用客户端：
 * 1) OPENAI_API_KEY (+ 可选 OPENAI_BASE_URL)
 * 2) 否则 STEP_API_KEY → 阶跃 Step Plan OpenAI 兼容 Chat Completions
 * 3) 否则回退本项目已有的 ARK_API_KEY → 火山方舟 OpenAI 兼容 Chat Completions
 */
export function configureOpenAIFromEnv() {
  if (openaiReady) return true;

  const openAIKey = process.env.OPENAI_API_KEY;
  const stepKey = process.env.STEP_API_KEY;
  const arkKey = process.env.ARK_API_KEY;

  if (openAIKey) {
    setDefaultOpenAIKey(openAIKey);
    const baseURL = process.env.OPENAI_BASE_URL;
    if (baseURL) {
      setDefaultOpenAIClient(new OpenAI({ apiKey: openAIKey, baseURL }));
      setOpenAIAPI('chat_completions');
      configuredProvider = 'openai_compatible';
    } else {
      configuredProvider = 'openai';
    }
    openaiReady = true;
    return true;
  }

  if (stepKey) {
    const baseURL = process.env.STEP_BASE_URL || 'https://api.stepfun.com/step_plan/v1';
    setDefaultOpenAIKey(stepKey);
    setDefaultOpenAIClient(new OpenAI({ apiKey: stepKey, baseURL }));
    setOpenAIAPI('chat_completions');
    configuredProvider = 'step_plan';
    openaiReady = true;
    return true;
  }

  if (arkKey) {
    const baseURL =
      process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
    setDefaultOpenAIKey(arkKey);
    setDefaultOpenAIClient(new OpenAI({ apiKey: arkKey, baseURL }));
    // 方舟走 Chat Completions；Agents SDK stream.toTextStream 才能出 token 增量
    setOpenAIAPI('chat_completions');
    configuredProvider = 'ark_doubao';
    openaiReady = true;
    return true;
  }

  return false;
}

function buildFakeMarkdownReply(products) {
  if (!products.length) {
    return [
      '## 暂时没有匹配商品',
      '',
      '店里当前没有可展示的在售款。',
      '',
      '> 建议直接拨打 **13359140982**，让店员帮您挑。',
    ].join('\n');
  }
  const rows = products
    .map((p) => `| ${p.name} | ${p.price} | \`${p.id}\` |`)
    .join('\n');
  return [
    '## 在售推荐',
    '',
    '根据店里**真实在售**商品，为您整理如下：',
    '',
    '| 商品 | 价格 | 编号 |',
    '| --- | --- | --- |',
    rows,
    '',
    '- 想看某一款细节或比价，直接告诉我',
    '- 需要门店电话、地址、营业时间也可以问我',
    '',
    '> 满意的话可来店试坐，或用首页 **AI 试摆** 看客厅效果。',
  ].join('\n');
}

async function buildFakeModelForTests() {
  const { ScriptedModel, assistantMessage, functionCall } = await import(
    '@openai/agents/testing'
  );
  const products = listOnSaleProducts();
  return new ScriptedModel([
    [functionCall('list_on_sale_products', {}, { callId: 'call_list_1' })],
    [assistantMessage(buildFakeMarkdownReply(products))],
  ]);
}

/**
 * 跑一轮导购对话（Agents SDK Runner）
 * @param {{ message: string, history?: Array<{role:string,content:string}>, model?: import('@openai/agents').Model }} opts
 */
export const CHAT_MESSAGE_MAX_CHARS = 500;
export const CHAT_HISTORY_MAX_TURNS = 20;
export const CHAT_HISTORY_CONTENT_MAX_CHARS = 2000;
export const CHAT_RUN_TIMEOUT_MS = 60_000;

function assertChatInputLimits(message, history) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    const err = new Error('请输入问题');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (message.trim().length > CHAT_MESSAGE_MAX_CHARS) {
    const err = new Error(`问题太长，请控制在 ${CHAT_MESSAGE_MAX_CHARS} 字以内`);
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (!Array.isArray(history)) return;
  if (history.length > CHAT_HISTORY_MAX_TURNS) {
    const err = new Error(`对话轮次过多，请刷新页面后重试`);
    err.code = 'BAD_REQUEST';
    throw err;
  }
  for (const turn of history) {
    if (!turn || typeof turn.content !== 'string') continue;
    if (turn.content.length > CHAT_HISTORY_CONTENT_MAX_CHARS) {
      const err = new Error('历史消息过长，请刷新页面后重试');
      err.code = 'BAD_REQUEST';
      throw err;
    }
  }
}

async function prepareShoppingGuideRun(opts = {}) {
  const message = opts.message;
  const history = Array.isArray(opts.history)
    ? opts.history.slice(-CHAT_HISTORY_MAX_TURNS)
    : [];
  assertChatInputLimits(message, history);

  let model = opts.model;
  if (!model) {
    const hasKey = configureOpenAIFromEnv();
    if (!hasKey) {
      if (process.env.CHAT_GUIDE_FAKE_MODEL === '1') {
        model = await buildFakeModelForTests();
      } else {
        const err = new Error(
          '导购暂时不可用：请配置 STEP_API_KEY / ARK_API_KEY / OPENAI_API_KEY（可选 OPENAI_BASE_URL / CHAT_GUIDE_MODEL）'
        );
        err.code = 'MISSING_OPENAI_KEY';
        throw err;
      }
    }
  }

  // model 为 ScriptedModel 时注入；否则 createShoppingGuideAgent 使用 getChatModelName()
  const agent = createShoppingGuideAgent(model ? { model } : {});
  const runner = new Runner({ tracingDisabled: true });

  const thread = [];
  for (const turn of history) {
    if (!turn || typeof turn.content !== 'string' || !turn.content.trim()) continue;
    const role = turn.role === 'assistant' ? 'assistant' : 'user';
    thread.push({
      role,
      content: turn.content.slice(0, CHAT_HISTORY_CONTENT_MAX_CHARS),
    });
  }
  thread.push({ role: 'user', content: message.trim() });

  return { agent, runner, thread };
}

function mapRunAbortError(err) {
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'ABORT_ERR')) {
    const timeoutErr = new Error('导购助手响应超时，请稍后再试或拨打门店电话');
    timeoutErr.code = 'TIMEOUT';
    return timeoutErr;
  }
  return err;
}

function normalizeReply(finalOutput) {
  const reply =
    typeof finalOutput === 'string'
      ? finalOutput
      : finalOutput != null
        ? String(finalOutput)
        : '';
  if (!reply.trim()) {
    const err = new Error('导购助手未返回有效回复');
    err.code = 'EMPTY_REPLY';
    throw err;
  }
  return reply.trim();
}

export async function runShoppingGuideChat(opts = {}) {
  const { agent, runner, thread } = await prepareShoppingGuideRun(opts);

  let result;
  try {
    result = await runner.run(agent, thread, {
      maxTurns: 8,
      signal: AbortSignal.timeout(CHAT_RUN_TIMEOUT_MS),
    });
  } catch (err) {
    throw mapRunAbortError(err);
  }

  return {
    reply: normalizeReply(result.finalOutput),
    history: result.history,
  };
}

/** 从 Agents SDK raw_model_stream_event 取出 Chat Completions delta（避免 response_started 与 model 重复） */
function extractChatCompletionDelta(ev) {
  if (!ev || ev.type !== 'raw_model_stream_event' || !ev.data) return null;
  const data = ev.data;
  // response_started 与后续 model 事件会带同一段 delta，只消费 model.event
  if (data.type === 'response_started') return null;
  if (data.event?.choices?.[0]?.delta) return data.event.choices[0].delta;
  return null;
}

function extractToolNameFromRunItem(ev) {
  if (!ev || ev.type !== 'run_item_stream_event') return null;
  const item = ev.item || ev.data?.item || null;
  if (!item) return null;
  return (
    item.name ||
    item.rawItem?.name ||
    item.rawItem?.function?.name ||
    item.toolName ||
    null
  );
}

/**
 * 流式跑导购对话：
 * - thinking: 豆包 reasoning_content（思考过程）
 * - tool: 工具调用提示
 * - delta: 最终回答 Markdown 增量（供 ynet parseStream）
 * - done: 完整回复
 * @param {{ message: string, history?: Array<{role:string,content:string}>, model?: import('@openai/agents').Model }} opts
 */
export async function* streamShoppingGuideChat(opts = {}) {
  const { agent, runner, thread } = await prepareShoppingGuideRun(opts);

  let stream;
  try {
    stream = await runner.run(agent, thread, {
      stream: true,
      maxTurns: 8,
      signal: AbortSignal.timeout(CHAT_RUN_TIMEOUT_MS),
    });
  } catch (err) {
    throw mapRunAbortError(err);
  }

  let assembled = '';
  const seenTools = new Set();

  try {
    // 遍历完整事件流，才能拿到 reasoning_content；toTextStream() 只有正文
    for await (const ev of stream) {
      const toolName = extractToolNameFromRunItem(ev);
      if (toolName && !seenTools.has(toolName)) {
        seenTools.add(toolName);
        yield { type: 'tool', name: String(toolName) };
      }

      const delta = extractChatCompletionDelta(ev);
      if (!delta) continue;

      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        yield { type: 'thinking', text: delta.reasoning_content };
      }

      if (typeof delta.content === 'string' && delta.content) {
        assembled += delta.content;
        yield { type: 'delta', text: delta.content };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const name = tc?.function?.name;
          if (name && !seenTools.has(name)) {
            seenTools.add(name);
            yield { type: 'tool', name: String(name) };
          }
        }
      }
    }
    await stream.completed;
  } catch (err) {
    throw mapRunAbortError(err);
  }

  const reply = normalizeReply(
    stream.finalOutput != null && String(stream.finalOutput).trim()
      ? stream.finalOutput
      : assembled
  );
  yield { type: 'done', reply };
}
