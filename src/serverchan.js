// Server酱订单推送：新订单 → 老板微信。
// 单独成模块（同 chat-guide-agent.js 思路）：纯逻辑 + 可注入端点，便于单测，不启动 server 也能验。

const DEFAULT_API_BASE = 'https://sctapi.ftqq.com';

// 组装推送正文。title 简短（Server酱 建议 ≤32 字），desp 支持 markdown。
export function buildOrderPushBody(order) {
  const title = `新订单 ${order.id}`;
  const lines = [
    `**客户**：${order.name}　**电话**：${order.phone}`,
    `**商品**：${order.productName}（${order.productPrice || '到店询价'}）${order.quantity > 1 ? ` ×${order.quantity}` : ''}`,
    `**地址**：${order.address || '来店自提'}`,
    order.spec ? `**要求**：${order.spec}` : null,
    order.note ? `**备注**：${order.note}` : null,
    `**时间**：${order.createdAt}`,
  ].filter(Boolean);
  return { title, desp: lines.join('\n\n') };
}

// 推送单条订单。opts: { sendKey, apiBase, enabled }。
// 无 sendKey 或 enabled===false 时跳过；网络/上游异常一律吞掉并返回 {ok:false}，绝不 throw（调用方 fire-and-forget）。
export function pushOrderToWechat(order, opts = {}) {
  const { sendKey, apiBase = DEFAULT_API_BASE, enabled = true } = opts;
  if (!sendKey || enabled === false) return Promise.resolve({ ok: false, skipped: true });
  return (async () => {
    try {
      const { title, desp } = buildOrderPushBody(order);
      const resp = await fetch(`${apiBase}/${encodeURIComponent(sendKey)}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title, desp }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      const j = await resp.json().catch(() => null);
      if (!resp.ok || !j || j.code !== 0) {
        return { ok: false, status: resp.status, message: j && j.message };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  })();
}
