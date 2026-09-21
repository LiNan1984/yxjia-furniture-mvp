import type { MarkdownNode, MarkdownNodeBatch } from './types.js';
export declare function splitTableRow(line: string): string[];
export declare function parseMarkdown(markdown: string, streaming?: boolean): MarkdownNodeBatch;
export declare class MarkdownStreamEngine {
    private buffer;
    private snapshotInputHash;
    private snapshotInputSize;
    private snapshotJson;
    private snapshotDirty;
    append(token: string): string;
    snapshot(): string;
    reset(): void;
}
export declare class MarkdownNative {
    static parseMarkdown(markdown: string): string;
    static parseStream(markdown: string): string;
    static complexMarkdown(): string;
    static longMarkdown(): string;
}
export declare function parseNodeBatch(json: string): MarkdownNode[];
