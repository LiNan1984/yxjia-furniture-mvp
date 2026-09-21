import { COMPLEX_MARKDOWN, createLongMarkdown } from './samples.js';
function trim(value) {
    return value.trim();
}
function startsWith(value, prefix) {
    return value.startsWith(prefix);
}
function endsWithBlankLine(value) {
    return value.endsWith('\n\n') || value.endsWith('\r\n\r\n');
}
function fnv1a64(value) {
    let hash = 1469598103934665603n;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index) & 0xff);
        hash *= 1099511628211n;
        hash &= 0xffffffffffffffffn;
    }
    return hash;
}
function hashAppend(seed, value) {
    const mixed = fnv1a64(value) + 0x9e3779b97f4a7c15n + ((seed << 6n) & 0xffffffffffffffffn) + (seed >> 2n);
    return (seed ^ mixed) & 0xffffffffffffffffn;
}
function versionFromHash(hash) {
    return 1 + Number(hash % 2147483000n);
}
function computeNodeVersion(node) {
    let hash = fnv1a64(node.type);
    hash = hashAppend(hash, node.text);
    hash = hashAppend(hash, node.name ?? '');
    hash = hashAppend(hash, node.language ?? '');
    hash = hashAppend(hash, String(node.level ?? 0));
    for (const [key, value] of Object.entries(node.props ?? {})) {
        hash = hashAppend(hash, key);
        hash = hashAppend(hash, value);
    }
    for (const row of node.rows ?? []) {
        for (const cell of row) {
            hash = hashAppend(hash, cell);
        }
    }
    return versionFromHash(hash);
}
function refreshNodeVersion(node) {
    node.version = computeNodeVersion(node);
}
function addNode(nodes, node) {
    const normalized = {
        id: `n${nodes.length + 1}`,
        type: node.type,
        text: node.text ?? '',
        stable: node.stable ?? true,
        version: 1,
        level: node.level,
        name: node.name,
        language: node.language,
        props: node.props,
        rows: node.rows
    };
    refreshNodeVersion(normalized);
    nodes.push(normalized);
}
function isBlank(line) {
    return trim(line).length === 0;
}
function isHeading(line) {
    const match = /^(#{1,6})\s+/.exec(line);
    return Boolean(match);
}
function isListItem(line) {
    const text = trim(line);
    return text.startsWith('- ') || text.startsWith('* ') || /^\d+\.\s+/.test(text);
}
function isHorizontalRule(line) {
    const text = trim(line);
    return text.length >= 3 && /^-+$/.test(text);
}
function isTableSeparator(line) {
    const text = trim(line);
    return text.includes('|') && /^[|\-:\s]+$/.test(text);
}
function looksLikeTable(lines, index) {
    return index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1]);
}
function splitLines(markdown) {
    if (markdown.length === 0) {
        return [];
    }
    return markdown.split('\n').map((line) => line.endsWith('\r') ? line.slice(0, -1) : line);
}
export function splitTableRow(line) {
    const cells = [];
    let current = '';
    let inInlineDirective = false;
    for (let index = 0; index < line.length; index += 1) {
        if (!inInlineDirective && line[index] === '[' && line[index + 1] === '[') {
            inInlineDirective = true;
            current += line[index];
            continue;
        }
        if (inInlineDirective && index > 0 && line[index - 1] === ']' && line[index] === ']') {
            inInlineDirective = false;
            current += line[index];
            continue;
        }
        if (!inInlineDirective && line[index] === '|') {
            const cell = trim(current);
            if (cell.length > 0) {
                cells.push(cell);
            }
            current = '';
            continue;
        }
        current += line[index];
    }
    const tail = trim(current);
    if (tail.length > 0) {
        cells.push(tail);
    }
    return cells;
}
function stripListPrefix(line) {
    return trim(line).replace(/^([-*]\s+|\d+\.\s+)/, '');
}
function stripBlockQuotePrefix(line) {
    const text = trim(line);
    return text.startsWith('>') ? trim(text.slice(1)) : text;
}
function isPropLine(line) {
    const text = trim(line);
    const split = text.indexOf(':');
    if (split <= 0) {
        return false;
    }
    return /^[A-Za-z0-9$_-]+$/.test(text.slice(0, split));
}
function parsePropLine(line) {
    const text = trim(line);
    const split = text.indexOf(':');
    return [trim(text.slice(0, split)), trim(text.slice(split + 1))];
}
function appendText(target, value) {
    target.text = target.text.length > 0 ? `${target.text}\n${value}` : value;
}
function isBlockStart(lines, index) {
    const line = lines[index];
    const text = trim(line);
    return isBlank(line)
        || isHeading(line)
        || isHorizontalRule(line)
        || startsWith(text, '```')
        || startsWith(text, ':::')
        || startsWith(text, '>')
        || isListItem(line)
        || looksLikeTable(lines, index);
}
export function parseMarkdown(markdown, streaming = false) {
    const lines = splitLines(markdown);
    const nodes = [];
    let index = 0;
    while (index < lines.length) {
        if (isBlank(lines[index])) {
            index += 1;
            continue;
        }
        const trimmed = trim(lines[index]);
        if (isHeading(trimmed)) {
            const level = /^#+/.exec(trimmed)?.[0].length ?? 1;
            addNode(nodes, { type: 'heading', text: trim(trimmed.slice(level)), stable: true, level });
            index += 1;
            continue;
        }
        if (startsWith(trimmed, '```')) {
            const node = { id: '', type: 'code_block', text: '', stable: true, version: 1, language: trim(trimmed.slice(3)) };
            index += 1;
            let closed = false;
            while (index < lines.length) {
                if (startsWith(trim(lines[index]), '```')) {
                    closed = true;
                    index += 1;
                    break;
                }
                appendText(node, lines[index]);
                index += 1;
            }
            node.stable = closed || !streaming;
            addNode(nodes, node);
            continue;
        }
        if (startsWith(trimmed, ':::')) {
            const node = { id: '', type: 'custom', text: '', stable: true, version: 1, name: trim(trimmed.slice(3)), props: {} };
            index += 1;
            let closed = false;
            let readingProps = true;
            while (index < lines.length) {
                if (trim(lines[index]) === ':::') {
                    closed = true;
                    break;
                }
                if (readingProps) {
                    if (isBlank(lines[index])) {
                        readingProps = false;
                        index += 1;
                        continue;
                    }
                    if (isPropLine(lines[index])) {
                        const [key, value] = parsePropLine(lines[index]);
                        node.props[key] = value;
                        index += 1;
                        continue;
                    }
                    readingProps = false;
                }
                appendText(node, lines[index]);
                index += 1;
            }
            if (node.name === 'style') {
                node.type = 'styled_block';
            }
            if (Object.keys(node.props ?? {}).length === 0) {
                delete node.props;
            }
            node.stable = closed || !streaming;
            if (closed) {
                index += 1;
            }
            addNode(nodes, node);
            continue;
        }
        if (isHorizontalRule(trimmed)) {
            addNode(nodes, { type: 'divider', text: '', stable: true });
            index += 1;
            continue;
        }
        if (startsWith(trimmed, '>')) {
            const node = { id: '', type: 'blockquote', text: '', stable: true, version: 1 };
            while (index < lines.length && startsWith(trim(lines[index]), '>')) {
                appendText(node, stripBlockQuotePrefix(lines[index]));
                index += 1;
            }
            addNode(nodes, node);
            continue;
        }
        if (isListItem(trimmed)) {
            while (index < lines.length && isListItem(lines[index])) {
                addNode(nodes, { type: 'list_item', text: stripListPrefix(lines[index]), stable: true });
                index += 1;
            }
            continue;
        }
        if (looksLikeTable(lines, index)) {
            const node = { id: '', type: 'table', text: '', stable: true, version: 1, rows: [] };
            node.rows.push(splitTableRow(lines[index]));
            index += 2;
            while (index < lines.length && lines[index].includes('|') && !isBlank(lines[index])) {
                node.rows.push(splitTableRow(lines[index]));
                index += 1;
            }
            addNode(nodes, node);
            continue;
        }
        if (startsWith(trimmed, '![') && trimmed.includes('](')) {
            addNode(nodes, { type: 'image', text: trimmed, stable: true });
            index += 1;
            continue;
        }
        const node = { id: '', type: 'paragraph', text: '', stable: true, version: 1 };
        while (index < lines.length && !isBlockStart(lines, index)) {
            const line = trim(lines[index]);
            if (line.length > 0) {
                node.text = node.text.length > 0 ? `${node.text} ${line}` : line;
            }
            index += 1;
        }
        if (node.text.length > 0) {
            addNode(nodes, node);
        }
        else {
            index += 1;
        }
    }
    if (streaming && nodes.length > 0 && !endsWithBlankLine(markdown)) {
        nodes[nodes.length - 1].stable = false;
        refreshNodeVersion(nodes[nodes.length - 1]);
    }
    return { nodes };
}
export class MarkdownStreamEngine {
    constructor() {
        this.buffer = '';
        this.snapshotInputHash = 0n;
        this.snapshotInputSize = 0;
        this.snapshotJson = '';
        this.snapshotDirty = true;
    }
    append(token) {
        if (token.length > 0) {
            this.buffer += token;
            this.snapshotDirty = true;
        }
        return this.snapshot();
    }
    snapshot() {
        if (!this.snapshotDirty) {
            return this.snapshotJson;
        }
        const inputHash = fnv1a64(this.buffer);
        if (this.snapshotInputSize === this.buffer.length && this.snapshotInputHash === inputHash && this.snapshotJson.length > 0) {
            this.snapshotDirty = false;
            return this.snapshotJson;
        }
        this.snapshotJson = JSON.stringify(parseMarkdown(this.buffer, true));
        this.snapshotInputHash = inputHash;
        this.snapshotInputSize = this.buffer.length;
        this.snapshotDirty = false;
        return this.snapshotJson;
    }
    reset() {
        this.buffer = '';
        this.snapshotInputHash = 0n;
        this.snapshotInputSize = 0;
        this.snapshotJson = '';
        this.snapshotDirty = true;
    }
}
export class MarkdownNative {
    // H5 当前使用 TypeScript 移植实现；该入口预留给后续 C++ WASM 实现替换。
    static parseMarkdown(markdown) {
        return JSON.stringify(parseMarkdown(markdown, false));
    }
    static parseStream(markdown) {
        return JSON.stringify(parseMarkdown(markdown, true));
    }
    static complexMarkdown() {
        return COMPLEX_MARKDOWN;
    }
    static longMarkdown() {
        return createLongMarkdown();
    }
}
export function parseNodeBatch(json) {
    const batch = JSON.parse(json);
    return Array.isArray(batch.nodes) ? batch.nodes : [];
}
//# sourceMappingURL=parser.js.map