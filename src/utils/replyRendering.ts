interface RenderClock {
    now(): number;
    schedule(callback: () => void, delay: number): number;
    cancel(id: number): void;
}

const renderClock: RenderClock = {
    now: () => performance.now(),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: id => window.clearTimeout(id),
};

/** Coalesce token updates without accumulating overlapping DOM processing jobs. */
export class ReplyRenderScheduler {
    private timer: number | undefined;
    private running = false;
    private dirty = false;
    private urgent = false;
    private disposed = false;
    private lastRun = -Infinity;

    constructor(
        private readonly render: () => void | Promise<void>,
        private readonly interval = 100,
        private readonly clock = renderClock,
        private readonly onError: (error: unknown) => void = console.error,
    ) {}

    request(immediate = false): void {
        if (this.disposed) return;
        this.dirty = true;
        this.urgent ||= immediate;
        if (this.running) return;
        if (this.timer !== undefined) {
            if (!this.urgent) return;
            this.clock.cancel(this.timer);
        }
        const delay = this.urgent ? 0
            : Math.max(0, this.lastRun + this.interval - this.clock.now());
        this.timer = this.clock.schedule(() => {
            this.timer = undefined;
            void this.run();
        }, delay);
    }

    dispose(): void {
        this.disposed = true;
        this.dirty = false;
        if (this.timer !== undefined) this.clock.cancel(this.timer);
        this.timer = undefined;
    }

    private async run(): Promise<void> {
        if (this.disposed) return;
        this.running = true;
        this.dirty = this.urgent = false;
        this.lastRun = this.clock.now();
        try {
            await this.render();
        } catch (error) {
            this.onError(error);
        } finally {
            this.running = false;
            if (this.dirty) this.request(this.urgent);
        }
    }
}

interface MarkdownEngine {
    Md2HTML(markdown: string): string;
}

/** Reuse Lute and unchanged message HTML, with a bounded per-view cache. */
export class ReplyMarkdownRenderer {
    private engine: MarkdownEngine | undefined;
    private readonly cache = new Map<string, string>();
    private cachedChars = 0;

    constructor(
        private readonly createEngine: () => MarkdownEngine | undefined,
        private readonly maxEntries = 64,
        private readonly maxChars = 2_000_000,
    ) {}

    render(markdown: string): string | undefined {
        this.engine ||= this.createEngine();
        if (!this.engine) return;
        const cached = this.cache.get(markdown);
        if (cached !== undefined) {
            this.cache.delete(markdown);
            this.cache.set(markdown, cached);
            return cached;
        }
        const html = this.engine.Md2HTML(markdown);
        const chars = markdown.length + html.length;
        if (chars <= this.maxChars && this.maxEntries > 0) {
            this.cache.set(markdown, html);
            this.cachedChars += chars;
            while (this.cache.size > this.maxEntries || this.cachedChars > this.maxChars) {
                const oldest = this.cache.keys().next().value;
                if (oldest === undefined) break;
                this.cachedChars -= oldest.length + this.cache.get(oldest)!.length;
                this.cache.delete(oldest);
            }
        }
        return html;
    }
}
