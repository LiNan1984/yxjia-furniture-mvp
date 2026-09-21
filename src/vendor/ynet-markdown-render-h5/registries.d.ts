import type { MarkdownCustomRenderer, MarkdownLinkHandler, MarkdownNodeRenderer } from './types.js';
export declare class MarkdownCustomNodeRegistry {
    private static renderers;
    private static listeners;
    static register(name: string, renderer: MarkdownCustomRenderer): void;
    static get(name: string): MarkdownCustomRenderer | undefined;
    static onChange(listener: () => void): () => void;
    private static notify;
}
export declare class MarkdownNodeViewRegistry {
    private static renderers;
    static register(type: string, renderer: MarkdownNodeRenderer): void;
    static get(type: string): MarkdownNodeRenderer | undefined;
}
export declare class MarkdownLinkRegistry {
    private static handler?;
    static setHandler(handler: MarkdownLinkHandler): void;
    static handle(context: Parameters<MarkdownLinkHandler>[0]): boolean;
}
