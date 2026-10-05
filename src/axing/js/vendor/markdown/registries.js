export class MarkdownCustomNodeRegistry {
    static register(name, renderer) {
        this.renderers.set(name, renderer);
        this.notify();
    }
    static get(name) {
        return this.renderers.get(name);
    }
    static onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    static notify() {
        for (const listener of this.listeners) {
            listener();
        }
    }
}
MarkdownCustomNodeRegistry.renderers = new Map();
MarkdownCustomNodeRegistry.listeners = new Set();
export class MarkdownNodeViewRegistry {
    static register(type, renderer) {
        this.renderers.set(type, renderer);
    }
    static get(type) {
        return this.renderers.get(type);
    }
}
MarkdownNodeViewRegistry.renderers = new Map();
export class MarkdownLinkRegistry {
    static setHandler(handler) {
        this.handler = handler;
    }
    static handle(context) {
        return this.handler?.(context) ?? false;
    }
}
//# sourceMappingURL=registries.js.map