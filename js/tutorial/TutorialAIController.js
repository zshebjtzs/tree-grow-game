/**
 * Runs the production AI worker in an isolated tutorial lifecycle.
 * Request IDs invalidate stale responses after resets and lesson changes.
 */
export class TutorialAIController {
    constructor({ onDecision, onError, WorkerClass = globalThis.Worker } = {}) {
        if (typeof WorkerClass !== 'function') throw new Error('浏览器不支持 Web Worker');
        this.onDecision = onDecision;
        this.onError = onError;
        this.requestId = 0;
        this.pending = false;
        this.disposed = false;
        this.worker = new WorkerClass(new URL('../ai/AIWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => this.handleMessage(event.data);
        this.worker.onerror = event => {
            if (!this.pending || this.disposed) return;
            this.pending = false;
            this.onError?.(event.message || '教程 AI Worker 运行失败');
        };
    }

    request(runtime, difficulty = 'easy') {
        if (this.disposed) throw new Error('教程 AI 控制器已经释放');
        if (this.pending) throw new Error('教程 AI 正在处理上一条请求');
        if (!runtime?.game || !runtime?.ruleEngine || !Array.isArray(runtime.mapAreas)) {
            throw new TypeError('教程 AI 请求缺少有效的对局运行时');
        }
        const requestId = ++this.requestId;
        this.pending = true;
        try {
            this.worker.postMessage({
                requestId,
                gameStateData: runtime.game.toJSON(),
                adjacency: runtime.ruleEngine.adjacency,
                areaCenters: runtime.mapAreas.map(area => area.center),
                difficulty,
                playerSide: 'blue',
                redBaseId: runtime.redBaseId,
                blueBaseId: runtime.blueBaseId
            });
        } catch (error) {
            this.pending = false;
            throw error;
        }
        return requestId;
    }

    handleMessage(message) {
        if (this.disposed || !message || message.requestId !== this.requestId || !this.pending) return;
        if (message.type === 'progress') return;
        this.pending = false;
        if (message.error) { this.onError?.(message.error); return; }
        if (message.type !== 'decision') { this.onError?.('教程 AI 返回了未知响应'); return; }
        this.onDecision?.({
            parentNodeId: message.parentNodeId ?? null,
            targetAreaId: message.targetAreaId ?? null,
            explanation: message.explanation || null
        });
    }

    cancel() { this.requestId++; this.pending = false; }

    dispose() {
        if (this.disposed) return;
        this.cancel();
        this.disposed = true;
        this.worker.terminate();
    }
}