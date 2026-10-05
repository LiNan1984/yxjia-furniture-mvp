# vendor/markdown ——  provenance

## 来源

| 文件 | 上游 | 行数 |
|---|---|---|
| `parser.js` | `ynet-render-markdown/H5/markdown-render/dist/parser.js` | 344 |
| `inline.js` | `ynet-render-markdown/H5/markdown-render/dist/inline.js` | 151 |
| `registries.js` | `ynet-render-markdown/H5/markdown-render/dist/registries.js` | 37 |
| `style.js` | `ynet-render-markdown/H5/markdown-render/dist/style.js` | 75 |
| `samples.js` | **裁剪桩**（上游是 161 行测试样例，见文件头注释） | 10 |

上游快照日期：2026-06-25（`dist` 与 `src` 同日构建）。
前四个文件与上游**逐字节一致**，不要手改；要改就在阿杏适配层 `src/axing/js/markdown.js` 改。

## 没有 vendor 的文件

| 文件 | 为什么不要 |
|---|---|
| `render.js` | 自带 ynet 渲染器，会调 `injectMarkdownStyle()` 注入 `#2F7CF6` 蓝 / `#B42318` 红 / `#F4F8FF` 浅蓝底，违反阿杏两色调铁律。阿杏自己写渲染层（`../markdown.js`）+ 自己的 `css/markdown.css`。 |
| `samples.js` | 换成空桩，见上。 |
| `index.js` | 桶文件，会连带拉进 `render.js`。 |
| `types.js` | 编译后只剩 `export {}`，运行时无价值。 |

## 用到的导出

```js
import { parseMarkdown, MarkdownStreamEngine, parseNodeBatch, splitTableRow } from './parser.js';
import { parseInlineTo } from './inline.js';
```

`style.js` 只为满足 `inline.js` 的静态 import 而存在；**`injectMarkdownStyle()` 全程不被调用**，
它内部的 `colorValue()` / `pillBackground()` 也只被上游的 `[[color:]]` / `[[pill:]]` 内联指令触达，
而阿杏适配层在喂给 `parseInlineTo` 之前就把这些指令剥掉了（两色调铁律），所以它们也不会真起作用。

## 安全提示（上游行为，阿杏适配层负责兜）

1. `inline.js` 的 `parseInlineTo` 直接 `link.href = url`，**不校验协议**。阿杏适配层的
   `sanitizeLinks()` 会把非 `http:` / `https:` / `tel:` 的 `href` 降级成纯文本。
2. `inline.js` 不解析 `__粗体__` 与 `~~删除线~~`，阿杏适配层分别用归一化与后处理补上。
3. 上游行内指令 `[[color:…]]` / `[[pill:…]]` / `[[style:…]]` 会写死原色（含纯蓝纯红），
   阿杏适配层预剥掉，只保留 `|` 后的可见文字。
