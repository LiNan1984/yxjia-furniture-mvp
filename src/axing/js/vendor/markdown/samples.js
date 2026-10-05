/* samples.js —— vendor 裁剪桩
 *
 * 上游 ynet-render-markdown/H5/markdown-render/dist/samples.js 是 161 行的三端共享
 * 测试样例（COMPLEX_MARKDOWN / createLongMarkdown），只被 MarkdownNative 的
 * complexMarkdown() / longMarkdown() 两个 demo 入口用到；阿杏的解析与流式路径
 * （parseMarkdown / MarkdownStreamEngine）完全不碰它。
 *
 * 但 parser.js 顶部是静态 import，不提供这个模块浏览器会 404，所以用空桩替代，
 * 省掉 6KB+ 与一份和本项目无关的大字符串。
 *
 * vendor 文件除本桩外与上游逐字节一致，详见 VENDOR.md。 */
export const COMPLEX_MARKDOWN = '';
export function createLongMarkdown() {
  return '';
}
