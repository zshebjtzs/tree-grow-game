// js/ai/AIController.js
import { GameState } from '../game/GameState.js';
import { RuleEngine } from '../game/RuleEngine.js';

export class AIController {
    constructor(difficulty = 'medium', adjacency, areaCenters) {
        this.difficulty = difficulty;
        this.adjacency = adjacency || {};
        this.areaCenters = areaCenters || [];
        this.ruleEngine = new RuleEngine({ adjacency: this.adjacency });
    }

    getBestMove(gameStateData, playerSide) {
        const game = GameState.fromJSON(gameStateData);
        game.currentTurn = playerSide;
        const enemySide = playerSide === 'blue' ? 'red' : 'blue';
        const enemyBaseId = enemySide === 'red' ? gameStateData.redBaseId : gameStateData.blueBaseId;
        const ownBaseId = playerSide === 'red' ? gameStateData.redBaseId : gameStateData.blueBaseId;
        const aliveNodes = game.getAliveNodes();
        const occupied = new Set(aliveNodes.map(node => node.areaId));
        const moves = [];

        for (const parentNode of game.getAliveNodesByOwner(playerSide)) {
            if (parentNode.isFrozen) continue;
            // The root's first branch can span up to two edges. Enumerate the
            // map independently of the root area's direct-neighbor list.
            const isFirstRootBranch = parentNode.isRoot && parentNode.childrenIds.length === 0;
            if (isFirstRootBranch) {
                for (let areaId = 1; areaId <= this.areaCenters.length; areaId++) {
                    this._addIfLegal(moves, game, parentNode, areaId, playerSide, ownBaseId, enemyBaseId, occupied, aliveNodes);
                }
                continue;
            }
            for (const targetAreaId of this.adjacency[parentNode.areaId] || []) {
                this._addIfLegal(moves, game, parentNode, targetAreaId, playerSide, ownBaseId, enemyBaseId, occupied, aliveNodes);
            }
        }

        if (!moves.length) return null;
        const scored = moves.map(move => {
            let score = 0;
            if (move.targetAreaId === enemyBaseId) score += 10000;
            const enemy = aliveNodes.find(node => node.owner === enemySide && node.areaId === move.targetAreaId);
            if (enemy) score += enemy.getDegree() > 3 ? -1000 : 600;
            if (!occupied.has(move.targetAreaId)) score += 50;
            return { ...move, score };
        });

        if (this.difficulty === 'easy') {
            const top = scored.sort((a, b) => b.score - a.score).slice(0, Math.min(3, scored.length));
            return top[Math.floor(Math.random() * top.length)];
        }
        if (this.difficulty === 'hard') {
            return scored.reduce((best, move) => move.score > best.score ? move : best);
        }
        const total = scored.reduce((sum, move) => sum + Math.max(1, move.score + 100), 0);
        let pick = Math.random() * total;
        for (const move of scored) {
            pick -= Math.max(1, move.score + 100);
            if (pick <= 0) return move;
        }
        return scored[0];
    }

    _addIfLegal(moves, game, parentNode, areaId, playerSide, ownBaseId, enemyBaseId, occupied, aliveNodes) {
        if (!this.areaCenters[areaId - 1]) return;
        const result = this.ruleEngine.canGrow(game, parentNode, areaId, { ownBaseId, enemyBaseId });
        if (!result.allowed) return;
        // AI moves onto enemy-occupied cells to invoke combat, but never onto
        // its own occupied cell (except an enemy base if that is the target).
        if (aliveNodes.some(node => node.owner === playerSide && node.areaId === areaId)) return;
        const center = this.areaCenters[areaId - 1];
        moves.push({
            parentNodeId: parentNode.id,
            targetAreaId: areaId,
            x: center[0],
            y: center[1]
        });
    }
}
