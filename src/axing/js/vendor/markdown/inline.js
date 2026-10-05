import { MarkdownLinkRegistry } from './registries.js';
import { colorValue, pillBackground } from './style.js';
function appendText(parent, text) {
    if (text.length > 0) {
        parent.appendChild(document.createTextNode(text));
    }
}
function appendParsed(parent, text, ownerNode) {
    parseInlineTo(parent, text, ownerNode);
}
function parseInlineStyle(styleText) {
    const props = {};
    for (const part of styleText.split(';')) {
        const split = part.indexOf('=');
        if (split > 0) {
            props[part.slice(0, split).trim()] = part.slice(split + 1).trim();
        }
    }
    return props;
}
function applyInlineStyle(element, props) {
    if (props.color) {
        element.style.color = colorValue(props.color, props.color);
    }
    if (props.background) {
        element.style.background = colorValue(props.background, props.background);
        element.style.padding = '1px 6px';
    }
    const radius = props.radius;
    if (radius) {
        element.style.borderRadius = `${Number.parseFloat(radius) || 0}px`;
    }
    const fontSize = props.fontSize ?? props['font-size'];
    if (fontSize) {
        element.style.fontSize = `${Number.parseFloat(fontSize) || 16}px`;
    }
    if (props.bold === 'true') {
        element.style.fontWeight = '700';
    }
}
export function parseInlineTo(parent, text, ownerNode) {
    let index = 0;
    while (index < text.length) {
        if (text.startsWith('[[color:', index)) {
            const end = text.indexOf(']]', index);
            const body = end > index ? text.slice(index + 8, end) : '';
            const split = body.indexOf('|');
            if (end > index && split > 0) {
                const span = document.createElement('span');
                span.style.color = colorValue(body.slice(0, split));
                appendParsed(span, body.slice(split + 1), ownerNode);
                parent.appendChild(span);
                index = end + 2;
                continue;
            }
        }
        if (text.startsWith('[[pill:', index)) {
            const end = text.indexOf(']]', index);
            const body = end > index ? text.slice(index + 7, end) : '';
            const split = body.indexOf('|');
            if (end > index && split > 0) {
                const span = document.createElement('span');
                span.className = 'ynet-md-pill';
                span.style.color = colorValue(body.slice(0, split));
                span.style.background = pillBackground(body.slice(0, split));
                span.textContent = body.slice(split + 1);
                parent.appendChild(span);
                index = end + 2;
                continue;
            }
        }
        if (text.startsWith('[[style:', index)) {
            const end = text.indexOf(']]', index);
            const body = end > index ? text.slice(index + 8, end) : '';
            const split = body.indexOf('|');
            if (end > index && split > 0) {
                const span = document.createElement('span');
                applyInlineStyle(span, parseInlineStyle(body.slice(0, split)));
                appendParsed(span, body.slice(split + 1), ownerNode);
                parent.appendChild(span);
                index = end + 2;
                continue;
            }
        }
        if (text.startsWith('**', index)) {
            const end = text.indexOf('**', index + 2);
            if (end > index) {
                const strong = document.createElement('strong');
                appendParsed(strong, text.slice(index + 2, end), ownerNode);
                parent.appendChild(strong);
                index = end + 2;
                continue;
            }
        }
        if (text[index] === '`') {
            const end = text.indexOf('`', index + 1);
            if (end > index) {
                const code = document.createElement('code');
                code.className = 'ynet-md-inline-code';
                code.textContent = text.slice(index + 1, end);
                parent.appendChild(code);
                index = end + 1;
                continue;
            }
        }
        if (text[index] === '[') {
            const titleEnd = text.indexOf('](', index);
            const urlEnd = titleEnd > index ? text.indexOf(')', titleEnd + 2) : -1;
            if (titleEnd > index && urlEnd > titleEnd) {
                const title = text.slice(index + 1, titleEnd);
                const url = text.slice(titleEnd + 2, urlEnd);
                const link = document.createElement('a');
                link.className = 'ynet-md-link';
                link.href = url;
                link.textContent = title;
                link.addEventListener('click', (event) => {
                    if (MarkdownLinkRegistry.handle({ title, url, node: ownerNode, event })) {
                        event.preventDefault();
                    }
                });
                parent.appendChild(link);
                index = urlEnd + 1;
                continue;
            }
        }
        if (text[index] === '*' && text[index + 1] !== '*') {
            const end = text.indexOf('*', index + 1);
            if (end > index) {
                const em = document.createElement('em');
                appendParsed(em, text.slice(index + 1, end), ownerNode);
                parent.appendChild(em);
                index = end + 1;
                continue;
            }
        }
        const nextSpecial = [
            text.indexOf('[[', index + 1),
            text.indexOf('**', index + 1),
            text.indexOf('`', index + 1),
            text.indexOf('[', index + 1),
            text.indexOf('*', index + 1)
        ].filter((item) => item >= 0).sort((a, b) => a - b)[0] ?? text.length;
        appendText(parent, text.slice(index, nextSpecial));
        index = nextSpecial;
    }
}
export function createInlineElement(text, ownerNode, tagName = 'span') {
    const element = document.createElement(tagName);
    parseInlineTo(element, text, ownerNode);
    return element;
}
//# sourceMappingURL=inline.js.map