import type { MarkdownNode } from './types.js';
export declare function parseInlineTo(parent: HTMLElement, text: string, ownerNode: MarkdownNode): void;
export declare function createInlineElement(text: string, ownerNode: MarkdownNode, tagName?: string): HTMLElement;
