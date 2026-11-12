// js/ai/AIWorker.js
import { AIController } from './AIController.js';

console.log('【AI 追踪 0】AIWorker 脚本已被浏览器成功加载！');

let activeRequestId = null;

function postWorkerMessage(payload) {
    try {
        self.postMessage(payload);
    } catch (error) {
        console.error('AI Worker 无法发送响应:', error);
    }
}

self.onerror = function(message, source, lineno) {
    console.error('❌【AI Worker 致命报错】:', message, '行号:', lineno);
    postWorkerMessage({
        requestId: activeRequestId,
        error: String(message || 'AI Worker 发生未捕获错误')
    });
};

self.onmessage = function(event) {
    const request = event.data;
    const requestId = request?.requestId ?? null;
    activeRequestId = requestId;

    try {
        if (!request || !Number.isSafeInteger(requestId) || requestId < 1) {
            throw new TypeError('AI 请求编号无效');
        }
        const {
            gameStateData, adjacency, areaCenters, difficulty,
            playerSide, redBaseId, blueBaseId
        } = request;

        if (!gameStateData || typeof gameStateData !== 'object' ||
            !adjacency || typeof adjacency !== 'object' || Array.isArray(adjacency) ||
            !Array.isArray(areaCenters) ||
            !areaCenters.every(center => Array.isArray(center) && center.length >= 2 &&
                Number.isFinite(center[0]) && Number.isFinite(center[1])) ||
            !['red', 'blue'].includes(playerSide) ||
            !['easy', 'medium', 'hard'].includes(difficulty) ||
            !Number.isInteger(redBaseId) || !Number.isInteger(blueBaseId)) {
            throw new TypeError('AI 请求数据字段无效');
        }

        const snapshot = { ...gameStateData, redBaseId, blueBaseId };
        const ai = new AIController(difficulty, adjacency, areaCenters);
        const decision = ai.getBestMove(snapshot, playerSide);

        setTimeout(() => {
            if (decision) {
                postWorkerMessage({
                    requestId,
                    parentNodeId: decision.parentNodeId,
                    targetAreaId: decision.targetAreaId
                });
            } else {
                postWorkerMessage({ requestId, parentNodeId: null, targetAreaId: null });
            }
        }, 300);
    } catch (error) {
        console.error('❌【AI 计算过程报错】:', error);
        postWorkerMessage({
            requestId,
            error: error?.message || String(error)
        });
    }
};
