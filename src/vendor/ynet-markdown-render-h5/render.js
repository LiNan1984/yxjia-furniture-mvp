import { createInlineElement } from './inline.js';
import { MarkdownCustomNodeRegistry, MarkdownNodeViewRegistry } from './registries.js';
import { colorValue, injectMarkdownStyle } from './style.js';
import { parseNodeBatch } from './parser.js';
function isInlineCustom(node) {
    const display = node.props?.$display;
    return node.type === 'custom' && (display === 'inline' || display === 'inline-block');
}
function nodeKey(node) {
    return `${node.id}-${node.type}-${node.version}-${node.stable ? 'stable' : 'stream'}`;
}
export function groupNodes(nodes) {
    const groups = [];
    let index = 0;
    while (index < nodes.length) {
        if (isInlineCustom(nodes[index])) {
            const row = [];
            while (index < nodes.length && isInlineCustom(nodes[index])) {
                row.push(nodes[index]);
                index += 1;
            }
            groups.push({ type: 'custom_row', nodes: row, key: row.map(nodeKey).join('|') });
            continue;
        }
        groups.push({ type: 'node', nodes: [nodes[index]], key: nodeKey(nodes[index]) });
        index += 1;
    }
    return groups;
}
function parseSize(value) {
    if (!value) {
        return undefined;
    }
    if (value.endsWith('%')) {
        return value;
    }
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : undefined;
}
function applyCustomSize(element, node) {
    const width = parseSize(node.props?.$width);
    const height = parseSize(node.props?.$height);
    if (typeof width === 'number') {
        element.style.width = `${width}px`;
    }
    else if (typeof width === 'string') {
        element.style.width = width;
    }
    if (typeof height === 'number') {
        element.style.minHeight = `${height}px`;
    }
}
function createPlaceholder(node) {
    const placeholder = document.createElement('div');
    placeholder.className = 'ynet-md-placeholder';
    applyCustomSize(placeholder, node);
    return placeholder;
}
function createError(node, message) {
    const error = document.createElement('div');
    error.className = 'ynet-md-error';
    applyCustomSize(error, node);
    error.textContent = `自定义组件 ${node.name ?? ''} 渲染失败：${message}`;
    return error;
}
function renderCustom(node, inlineCustom) {
    const wrapper = document.createElement('div');
    wrapper.className = inlineCustom ? 'ynet-md-custom ynet-md-custom-inline' : 'ynet-md-custom';
    applyCustomSize(wrapper, node);
    const renderer = MarkdownCustomNodeRegistry.get(node.name ?? '');
    if (!renderer) {
        wrapper.appendChild(createError(node, `未注册 ${node.name ?? ''}`));
        return wrapper;
    }
    const context = {
        node,
        width: parseSize(node.props?.$width),
        height: parseSize(node.props?.$height),
        inlineCustom,
        props: node.props ?? {}
    };
    const placeholder = createPlaceholder(node);
    wrapper.appendChild(placeholder);
    Promise.resolve(renderer(context)).then((element) => {
        if (!wrapper.isConnected && wrapper.parentElement === null) {
            return;
        }
        wrapper.replaceChildren(element);
    }).catch((error) => {
        wrapper.replaceChildren(createError(node, error instanceof Error ? error.message : String(error)));
    });
    return wrapper;
}
function renderImage(node) {
    const match = /^!\[(.*?)]\((.*?)\)$/.exec(node.text.trim());
    const image = document.createElement('img');
    image.className = 'ynet-md-image';
    image.loading = 'lazy';
    image.alt = match?.[1] ?? '';
    image.src = match?.[2] ?? node.text;
    return image;
}
function renderTable(node) {
    const wrap = document.createElement('div');
    wrap.className = 'ynet-md-table-wrap ynet-md-block';
    const table = document.createElement('table');
    table.className = 'ynet-md-table';
    for (const [rowIndex, row] of (node.rows ?? []).entries()) {
        const tr = document.createElement('tr');
        for (const cell of row) {
            const cellElement = document.createElement(rowIndex === 0 ? 'th' : 'td');
            cellElement.appendChild(createInlineElement(cell, node));
            tr.appendChild(cellElement);
        }
        table.appendChild(tr);
    }
    wrap.appendChild(table);
    return wrap;
}
function renderStyledBlock(node) {
    const block = document.createElement('div');
    block.className = 'ynet-md-styled-block ynet-md-block';
    const props = node.props ?? {};
    block.style.color = colorValue(props.color, '#000000');
    if (props.background) {
        block.style.background = colorValue(props.background, props.background);
    }
    if (props.radius) {
        block.style.borderRadius = `${Number.parseFloat(props.radius) || 0}px`;
    }
    if (props.fontSize) {
        block.style.fontSize = `${Number.parseFloat(props.fontSize) || 16}px`;
    }
    block.appendChild(createInlineElement(node.text, node));
    return block;
}
function renderSingleNode(node) {
    const replacement = MarkdownNodeViewRegistry.get(node.type);
    if (replacement) {
        return replacement({ node, renderInline: createInlineElement });
    }
    if (node.type === 'heading') {
        const level = Math.min(Math.max(node.level ?? 1, 1), 6);
        const heading = document.createElement(`h${level}`);
        heading.className = `ynet-md-heading ynet-md-heading-${level} ynet-md-block`;
        heading.appendChild(createInlineElement(node.text, node));
        return heading;
    }
    if (node.type === 'paragraph') {
        const paragraph = document.createElement('p');
        paragraph.className = 'ynet-md-paragraph ynet-md-block';
        paragraph.appendChild(createInlineElement(node.text, node));
        return paragraph;
    }
    if (node.type === 'blockquote') {
        const quote = document.createElement('blockquote');
        quote.className = 'ynet-md-blockquote';
        quote.appendChild(createInlineElement(node.text, node));
        return quote;
    }
    if (node.type === 'list_item') {
        const item = document.createElement('div');
        item.className = 'ynet-md-list-item ynet-md-block';
        const bullet = document.createElement('span');
        bullet.className = 'ynet-md-list-bullet';
        bullet.textContent = '•';
        item.appendChild(bullet);
        item.appendChild(createInlineElement(node.text, node));
        return item;
    }
    if (node.type === 'code_block') {
        const pre = document.createElement('pre');
        pre.className = 'ynet-md-code-block ynet-md-block';
        const code = document.createElement('code');
        code.textContent = node.text;
        pre.appendChild(code);
        return pre;
    }
    if (node.type === 'table') {
        return renderTable(node);
    }
    if (node.type === 'styled_block') {
        return renderStyledBlock(node);
    }
    if (node.type === 'divider') {
        const divider = document.createElement('div');
        divider.className = 'ynet-md-divider';
        return divider;
    }
    if (node.type === 'image') {
        return renderImage(node);
    }
    if (node.type === 'custom') {
        return renderCustom(node, false);
    }
    const fallback = document.createElement('p');
    fallback.className = 'ynet-md-paragraph ynet-md-block';
    fallback.textContent = node.text;
    return fallback;
}
export function renderGroup(group) {
    if (group.type === 'custom_row') {
        const row = document.createElement('div');
        row.className = 'ynet-md-custom-row';
        for (const node of group.nodes) {
            row.appendChild(renderCustom(node, true));
        }
        return row;
    }
    return renderSingleNode(group.nodes[0]);
}
export class MarkdownRenderView {
    constructor(container) {
        this.rendered = new Map();
        this.lastNodes = [];
        injectMarkdownStyle();
        this.root = document.createElement('div');
        this.root.className = 'ynet-md-root';
        container.replaceChildren(this.root);
        this.unsubscribe = MarkdownCustomNodeRegistry.onChange(() => this.renderNodes(this.lastNodes));
    }
    destroy() {
        this.unsubscribe?.();
    }
    renderJson(json) {
        this.renderNodes(parseNodeBatch(json));
    }
    renderNodes(nodes) {
        this.lastNodes = nodes;
        const groups = groupNodes(nodes);
        const nextRendered = new Map();
        const fragment = document.createDocumentFragment();
        for (const group of groups) {
            const old = this.rendered.get(group.key);
            const element = old ?? renderGroup(group);
            nextRendered.set(group.key, element);
            fragment.appendChild(element);
        }
        this.rendered = nextRendered;
        this.root.replaceChildren(fragment);
    }
}
function estimateGroupHeight(group) {
    const node = group.nodes[0];
    if (group.type === 'custom_row') {
        return Math.max(...group.nodes.map((item) => Number.parseFloat(item.props?.$height ?? '210') + 16));
    }
    if (node.type === 'heading')
        return 58;
    if (node.type === 'paragraph')
        return Math.max(54, Math.ceil(node.text.length / 28) * 28);
    if (node.type === 'blockquote')
        return 74;
    if (node.type === 'list_item')
        return 42;
    if (node.type === 'code_block')
        return 150;
    if (node.type === 'table')
        return 190;
    if (node.type === 'image')
        return 280;
    if (node.type === 'custom')
        return Number.parseFloat(node.props?.$height ?? '180') + 16;
    return 48;
}
export class MarkdownVirtualRenderView {
    constructor(container) {
        this.groups = [];
        this.heights = [];
        this.prefix = [0];
        this.renderedStart = -1;
        this.renderedEnd = -1;
        injectMarkdownStyle();
        this.scroll = document.createElement('div');
        this.scroll.className = 'ynet-md-root ynet-md-virtual-scroll';
        this.topSpacer = document.createElement('div');
        this.windowRoot = document.createElement('div');
        this.windowRoot.className = 'ynet-md-virtual-window';
        this.bottomSpacer = document.createElement('div');
        this.scroll.append(this.topSpacer, this.windowRoot, this.bottomSpacer);
        container.replaceChildren(this.scroll);
        this.scroll.addEventListener('scroll', () => this.updateWindow());
    }
    renderJson(json) {
        this.renderNodes(parseNodeBatch(json));
    }
    renderNodes(nodes) {
        this.groups = groupNodes(nodes);
        this.heights = this.groups.map(estimateGroupHeight);
        this.prefix = [0];
        for (const height of this.heights) {
            this.prefix.push(this.prefix[this.prefix.length - 1] + height);
        }
        this.renderedStart = -1;
        this.renderedEnd = -1;
        this.updateWindow();
    }
    updateWindow() {
        const viewport = this.scroll.clientHeight || 640;
        const scrollTop = this.scroll.scrollTop;
        const overscan = viewport * 1.5;
        const startY = Math.max(0, scrollTop - overscan);
        const endY = Math.min(this.prefix[this.prefix.length - 1], scrollTop + viewport + overscan);
        let start = 0;
        while (start < this.groups.length && this.prefix[start + 1] < startY) {
            start += 1;
        }
        let end = start;
        while (end < this.groups.length && this.prefix[end] < endY) {
            end += 1;
        }
        if (start === this.renderedStart && end === this.renderedEnd) {
            return;
        }
        this.renderedStart = start;
        this.renderedEnd = end;
        this.topSpacer.style.height = `${this.prefix[start]}px`;
        this.bottomSpacer.style.height = `${this.prefix[this.prefix.length - 1] - this.prefix[end]}px`;
        const fragment = document.createDocumentFragment();
        for (let index = start; index < end; index += 1) {
            fragment.appendChild(renderGroup(this.groups[index]));
        }
        this.windowRoot.replaceChildren(fragment);
    }
}
//# sourceMappingURL=render.js.map