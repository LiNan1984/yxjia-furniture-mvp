// view-upload.js — 上传客厅照的兼容适配器（交互规范 §1-2 / §5-2）
//
// 上传客厅照**不再是独立全屏页**：主入口是底部浮窗（sheet-upload.js）。实测问题——
// 做成全屏 view 时，顾客在 #view-upload 里用 Composer 发消息看不到自己那条（P2），
// 而且和首页上传卡是同一件事的两个全屏（P1）。
//
// 这里保留路由只为兼容三件事：地址栏 #view-upload 直入、其它 view 的 ctx.go('view-upload')
// 兜底、既有测试的挂载冒烟。内容直接复用 sheet-upload 的 mountUploadSheetBody，
// 不复制第二份实现（复制两份必然漂移）。

import { mountUploadSheetBody } from './sheet-upload.js';

export async function mount(root, ctx) {
  ctx._uploadViewCleanup = mountUploadSheetBody(root, ctx, { chrome: false });
  return () => {
    if (typeof ctx._uploadViewCleanup === 'function') ctx._uploadViewCleanup();
    ctx._uploadViewCleanup = null;
  };
}
