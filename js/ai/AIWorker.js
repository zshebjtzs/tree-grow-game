// js/ai/AIWorker.js
import { AIController } from './AIController.js';

console.log('【AI 追踪 0】AIWorker 脚本已被浏览器成功加载！');

let activeRequestId = null;

self.onerror = function(msg, source, lineno, colno, error) {
    console.error('❌【AI Worker 致命报错】:', msg, '行号:', lineno);
    self.postMessage({ requestId: activeRequestId, error: msg });
};

self.onmessage = function(e) {
    console.log('【AI 追踪 2】Worker 成功接收到了主线程的消息！');
    const { requestId, gameStateData, adjacency, areaCenters, difficulty, playerSide, redBaseId, blueBaseId } = e.data;
    activeRequestId = requestId;

    gameStateData.redBaseId = redBaseId;
    gameStateData.blueBaseId = blueBaseId;

    // 将图和坐标数据注入 AI 引擎
    const ai = new AIController(difficulty, adjacency, areaCenters);

    try {
        const decision = ai.getBestMove(gameStateData, playerSide);
        setTimeout(() => {
            if (decision) {
                self.postMessage({ requestId, 
                    parentNodeId: decision.parentNodeId, 
                    targetAreaId: decision.targetAreaId 
                });
            } else {
                self.postMessage({ requestId, parentNodeId: null, targetAreaId: null });
            }
        }, 300);
    } catch (err) {
        console.error('❌【AI 计算过程报错】:', err);
        self.postMessage({ requestId, error: err.message });
    }
};