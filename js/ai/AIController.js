// js/ai/AIController.js
import { GameState } from '../game/GameState.js';

export class AIController {
    constructor(difficulty = 'medium', adjacency, areaCenters) {
        this.difficulty = difficulty;
        this.adjacency = adjacency;       // 传入的邻接表
        this.areaCenters = areaCenters;   // 传入的区域中心点
    }

    getBestMove(gameStateData, playerSide) {
        console.log('【AI 追踪 3】AIController 内部已经开始计算！');
        const game = GameState.fromJSON(gameStateData);
        const enemySide = playerSide === 'blue' ? 'red' : 'blue';
        const enemyBaseId = enemySide === 'red' ? gameStateData.redBaseId : gameStateData.blueBaseId;

        const myNodes = game.getAliveNodesByOwner(playerSide);
        if (myNodes.length === 0) return null;

        const validMoves = [];
        const adjacency = this.adjacency;
        const areaCenters = this.areaCenters;

        // 1. 寻找所有合法的动作 (根据邻接表)
        for (const parentNode of myNodes) {
            if (parentNode.isFrozen) continue;

            // AI 必须遵守“根节点不可分叉”的规则
            if (parentNode.isRoot && parentNode.childrenIds.length > 0) {
                continue; // 跳过已经长过枝条的根节点
            }

            const neighborIds = adjacency[parentNode.areaId] || [];
            for (const targetAreaId of neighborIds) {
                // 简单的合法性检查：判断是否冲突（这里为了简便，复用部分原逻辑）
                // 注意：真实的 canGrow 需要很多限制，这里 AI 采用简化版的合法检查
                let blocked = false;
                const aliveNodes = game.getAliveNodes();
                for (const n of aliveNodes) {
                    if (n.areaId === targetAreaId && n.owner === playerSide) {
                        blocked = true; break;
                    }
                    if (n.areaId === targetAreaId && n.owner === enemySide && n.getDegree() > 3) {
                        blocked = true; break;
                    }
                }
                if (parentNode.isRoot && parentNode.childrenIds.length === 0) {
                    // 简化的根节点距离限制，这里 AI 不做深度 BFS 距离判断，只做基础拦截
                }

                if (!blocked) {
                    const center = areaCenters[targetAreaId - 1];
                    validMoves.push({
                        parentNodeId: parentNode.id,
                        targetAreaId: targetAreaId,
                        x: center[0],
                        y: center[1]
                    });
                }
            }
        }

        if (validMoves.length === 0) return null;

        // 2. 简单的启发式打分 (为了保证 AI 能下棋，去掉了复杂的依赖)
        const scoredMoves = validMoves.map(move => {
            let score = 0;
            if (move.targetAreaId === enemyBaseId) score += 10000;
            if (game.getAliveNodes().some(n => n.areaId === move.targetAreaId && n.owner === enemySide)) score += 600;
            return { ...move, score };
        });

        // 3. 根据难度选择
        if (this.difficulty === 'easy') {
            const topMoves = scoredMoves.sort((a, b) => b.score - a.score).slice(0, 3);
            return topMoves[Math.floor(Math.random() * topMoves.length)];
        } else if (this.difficulty === 'hard') {
            return scoredMoves.reduce((best, current) => current.score > best.score ? current : best);
        } else {
            // medium
            const totalScore = scoredMoves.reduce((sum, m) => sum + Math.max(0, m.score + 100), 0);
            let random = Math.random() * totalScore;
            for (const move of scoredMoves) {
                const weight = Math.max(0, move.score + 100);
                random -= weight;
                if (random <= 0) return move;
            }
            return scoredMoves[0];
        }
    }
}