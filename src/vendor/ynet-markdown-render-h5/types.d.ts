export interface MarkdownNode {
    id: string;
    type: string;
    text: string;
    stable: boolean;
    version: number;
    level?: number;
    name?: string;
    language?: string;
    props?: Record<string, string>;
    rows?: string[][];
}
export interface MarkdownNodeBatch {
    nodes: MarkdownNode[];
}
export interface MarkdownCustomNodeContext {
    node: MarkdownNode;
    width?: number | string;
    height?: number | string;
    inlineCustom: boolean;
    props: Record<string, string>;
}
export interface MarkdownNodeViewContext {
    node: MarkdownNode;
    renderInline: (text: string, ownerNode: MarkdownNode) => HTMLElement;
}
export interface MarkdownLinkContext {
    title: string;
    url: string;
    node: MarkdownNode;
    event: MouseEvent;
}
export type MarkdownCustomRenderer = (context: MarkdownCustomNodeContext) => HTMLElement | Promise<HTMLElement>;
export type MarkdownNodeRenderer = (context: MarkdownNodeViewContext) => HTMLElement;
export type MarkdownLinkHandler = (context: MarkdownLinkContext) => boolean;
