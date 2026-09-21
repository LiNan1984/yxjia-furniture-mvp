import type { MarkdownNode } from './types.js';
interface RenderGroup {
    key: string;
    nodes: MarkdownNode[];
    type: 'node' | 'custom_row';
}
export declare function groupNodes(nodes: MarkdownNode[]): RenderGroup[];
export declare function renderGroup(group: RenderGroup): HTMLElement;
export declare class MarkdownRenderView {
    protected readonly root: HTMLElement;
    private rendered;
    private unsubscribe?;
    private lastNodes;
    constructor(container: HTMLElement);
    destroy(): void;
    renderJson(json: string): void;
    renderNodes(nodes: MarkdownNode[]): void;
}
export declare class MarkdownVirtualRenderView {
    private readonly scroll;
    private readonly topSpacer;
    private readonly windowRoot;
    private readonly bottomSpacer;
    private groups;
    private heights;
    private prefix;
    private renderedStart;
    private renderedEnd;
    constructor(container: HTMLElement);
    renderJson(json: string): void;
    renderNodes(nodes: MarkdownNode[]): void;
    private updateWindow;
}
export {};
