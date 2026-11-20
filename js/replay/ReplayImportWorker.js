import { runReplayImport } from './ReplayImportTask.js';

self.onmessage = async event => {
    const request = event.data;
    if (!request || request.type !== 'import' || !request.file) return;
    try {
        const result = await runReplayImport(request.file, {
            onProgress: progress => self.postMessage({ type: 'progress', ...progress })
        });
        self.postMessage({ type: 'complete', result });
    } catch (error) {
        self.postMessage({ type: 'error', error: error?.message || String(error) });
    }
};
self.onerror = event => self.postMessage({
    type: 'error', error: event.message || '回放导入 Worker 发生未知错误'
});
